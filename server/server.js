/**
 * server.js
 *
 * Express + Socket.io bootstrap for the highlight-reel generator.
 *
 * Responsibilities:
 *  - POST /api/generate: accept an ordered multipart batch (multer → disk under
 *    uploads/<jobId>/), respond immediately with { jobId }, process async.
 *  - Socket.io rooms keyed by jobId: emits `progress` { percent, stage },
 *    `warning` { message }, `complete` { url }, `error` { message }. A state
 *    snapshot is replayed to any socket that joins late, so the POST → join
 *    race can never lose events.
 *  - Serves rendered videos statically at /output.
 *  - Cleanup: uploads/<jobId>/ is deleted on success; uploads AND any partial
 *    output are deleted on failure.
 */

import express from 'express';
import http from 'http';
import path from 'path';
import fs from 'fs';
import crypto from 'crypto';
import { fileURLToPath } from 'url';
import { Server as SocketIOServer } from 'socket.io';
import multer from 'multer';
import { processJob, probeMedia, hasFilter, FFMPEG_PATH } from './videoProcessor.js';
import { resolveMusicTrack, markTrackUsed, releaseTrackReservation, listUsedTracks } from './musicFetcher.js';
import {
  parseScript,
  extractKeywords,
  fetchSceneImage,
  synthNarration,
  wrapCaption,
  buildHeadline,
  readingDuration,
} from './scriptComposer.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const PORT = process.env.PORT || 5000;
const UPLOADS_DIR = path.join(__dirname, 'uploads');
const OUTPUT_DIR = path.join(__dirname, 'output');
const AUDIO_DIR = path.join(__dirname, 'public', 'audio');
const MUSIC_CACHE_DIR = path.join(__dirname, 'cache', 'music');

const ALLOWED_EXTS = new Set(['.jpg', '.jpeg', '.png', '.mp4', '.mov']);
const VOICE_EXTS = new Set(['.mp3', '.wav', '.m4a', '.aac', '.ogg']);
const VALID_LAYOUTS = new Set(['portrait', 'landscape']);
const VALID_AUDIO_MODES = new Set(['mute', 'merge']);
const VALID_VOICE_MODES = new Set(['voice', 'tts', 'music']);
const VALID_CAPTION_MODES = new Set(['headline', 'full', 'none']);

/**
 * Art-style chip options shared by the Studio, Auto and Script tabs.
 * "suggested" means "don't override anything" — Auto/Script keep their
 * vibe's own look, Studio stays ungraded. Every other value overrides the
 * color look everywhere, and on the Script tab ALSO steers which Openverse
 * image category gets fetched (the same values are reused 1:1 as the
 * `style` param of scriptComposer's fetchSceneImage).
 */
const ART_STYLES = new Set(['suggested', 'photo', 'illustration', 'artwork', 'abstract']);
const ART_STYLE_LOOK = {
  illustration: 'vibrant',
  artwork: 'cinema',
  abstract: 'warm',
  // 'photo' intentionally has no entry — it means "natural", i.e. no grade.
};

/**
 * Apply the shared Art-style chip's color-look override onto a style object,
 * in place. "suggested" leaves whatever look the mode already picked (a
 * vibe's default, or none for Studio); every other value replaces it —
 * including 'photo', which clears any look for an ungraded, natural image.
 *
 * @param {object} style Mutable style object (other fields already set).
 * @param {string} artStyle One of ART_STYLES.
 */
function applyArtStyleLook(style, artStyle) {
  if (artStyle === 'suggested') return;
  style.look = ART_STYLE_LOOK[artStyle]; // undefined for 'photo' → no grade
}

/** Dark gradient pairs cycled through for scenes with no fetched image. */
const SCENE_GRADIENTS = [
  ['0x1b2a4a', '0x0c0f1c'],
  ['0x3a1c47', '0x120a1e'],
  ['0x0f3d3e', '0x071a1b'],
  ['0x4a2c1b', '0x1c0f08'],
  ['0x232526', '0x414345'],
];

/**
 * Auto-mode vibe presets: the only knob on the Auto Generator page. Each vibe
 * is a full editorial identity — music, pacing, transition set & speed, and a
 * named color look (see videoProcessor's LOOKS).
 */
const VIBES = {
  dynamic: {
    musicQuery: 'upbeat energetic instrumental',
    style: {
      maxClipSeconds: 4,
      transitionDuration: 0.35,
      transitionPool: ['slideleft', 'slideright', 'zoomin', 'circleopen', 'squeezeh', 'fade'],
      look: 'vibrant',
      sharpen: true,
    },
  },
  cinematic: {
    musicQuery: 'cinematic orchestral instrumental',
    style: {
      maxClipSeconds: 6,
      transitionDuration: 0.8,
      transitionPool: ['fade', 'fadeblack', 'dissolve', 'fadegrays'],
      look: 'cinema',
      grain: true,
      letterbox: true,
      vignette: true,
    },
  },
  chill: {
    musicQuery: 'calm acoustic instrumental',
    style: {
      maxClipSeconds: 5,
      transitionDuration: 0.6,
      transitionPool: ['fade', 'dissolve', 'smoothup', 'smoothdown', 'hblur'],
      look: 'warm',
      vignette: true,
    },
  },
};

/**
 * Styling shared by every auto-mode render regardless of vibe (see
 * videoProcessor's style option); vibe-specific fields are merged on top.
 */
const AUTO_STYLE = {
  kenBurns: true,
  kenBurnsPan: true,
  blurFill: true,
  edgeFades: true,
  musicFadeIn: true,
};

for (const dir of [UPLOADS_DIR, OUTPUT_DIR, AUDIO_DIR, MUSIC_CACHE_DIR]) {
  fs.mkdirSync(dir, { recursive: true });
}

const app = express();
const httpServer = http.createServer(app);
const io = new SocketIOServer(httpServer, {
  cors: { origin: '*', methods: ['GET', 'POST'] },
});

/**
 * In-memory job state, keyed by jobId. Holds the latest lifecycle snapshot so
 * a socket that joins after processing began can be brought up to date.
 * @type {Map<string, {status: string, percent: number, stage: string,
 *   url: string|null, error: string|null, warnings: string[],
 *   attribution: object|null}>}
 */
const jobs = new Map();

/**
 * Update a job's snapshot and broadcast an event to its Socket.io room.
 *
 * @param {string} jobId Job identifier / room name.
 * @param {string} event One of progress|warning|complete|error.
 * @param {object} payload Event payload sent to the room.
 */
function broadcast(jobId, event, payload) {
  const state = jobs.get(jobId);
  if (state) {
    if (event === 'progress') {
      state.status = 'processing';
      state.percent = payload.percent;
      state.stage = payload.stage;
    } else if (event === 'warning') {
      state.warnings.push(payload.message);
    } else if (event === 'complete') {
      state.status = 'complete';
      state.percent = 100;
      state.url = payload.url;
      state.attribution = payload.attribution || null;
      state.imageCredits = payload.imageCredits || null;
    } else if (event === 'error') {
      state.status = 'error';
      state.error = payload.message;
    }
  }
  io.to(jobId).emit(event, payload);
}

/**
 * Recursively delete a directory, swallowing errors (cleanup must never throw).
 * @param {string} dir Absolute directory path.
 */
function removeDirQuiet(dir) {
  try {
    fs.rmSync(dir, { recursive: true, force: true });
  } catch (err) {
    console.warn(`Cleanup failed for ${dir}: ${err.message}`);
  }
}

/**
 * Delete a file if it exists, swallowing errors.
 * @param {string} file Absolute file path.
 */
function removeFileQuiet(file) {
  try {
    if (fs.existsSync(file)) fs.unlinkSync(file);
  } catch (err) {
    console.warn(`Cleanup failed for ${file}: ${err.message}`);
  }
}

// ---------------------------------------------------------------- uploads

/**
 * Pre-multer middleware: mint the jobId and its upload folder so multer's
 * storage engine has a destination, and seed the per-request file counter used
 * to prefix filenames with their upload index.
 */
function createJobContext(req, res, next) {
  req.jobId = crypto.randomUUID();
  req.uploadDir = path.join(UPLOADS_DIR, req.jobId);
  req.fileIndex = 0;
  fs.mkdirSync(req.uploadDir, { recursive: true });
  next();
}

const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, req.uploadDir),
  filename: (req, file, cb) => {
    // Multer receives files in multipart-stream order, which is exactly the
    // client's FormData append order — the upload order. The 0000_ prefix
    // bakes that order into the filename; processing additionally uses the
    // req.files array order directly (never re-sorted by name or mtime).
    const index = String(req.fileIndex++).padStart(4, '0');
    const safeName = file.originalname.replace(/[^a-zA-Z0-9._-]/g, '_');
    cb(null, `${index}_${safeName}`);
  },
});

const upload = multer({
  storage,
  fileFilter: (req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase();
    if (file.fieldname === 'voice') {
      if (!VOICE_EXTS.has(ext)) {
        return cb(new Error(`Unsupported voice file "${ext}". Allowed: .mp3 .wav .m4a .aac .ogg`));
      }
      return cb(null, true);
    }
    if (!ALLOWED_EXTS.has(ext)) {
      return cb(new Error(`Unsupported file type "${ext}" (${file.originalname}). Allowed: .jpg .jpeg .png .mp4 .mov`));
    }
    cb(null, true);
  },
});

// ------------------------------------------------------------------ routes

app.get('/api/health', (req, res) => {
  res.json({ ok: true, ffmpeg: FFMPEG_PATH, xfade: hasFilter('xfade') });
});

app.post(
  '/api/generate',
  createJobContext,
  (req, res, next) => {
    upload.fields([{ name: 'files', maxCount: 500 }, { name: 'voice', maxCount: 1 }])(req, res, (err) => {
      if (err) {
        removeDirQuiet(req.uploadDir);
        return res.status(400).json({ error: err.message });
      }
      next();
    });
  },
  (req, res) => {
    const mediaFiles = (req.files && req.files.files) || [];
    const voiceFile = req.files && req.files.voice ? req.files.voice[0] : null;

    const mode = req.body.mode === 'auto' ? 'auto' : req.body.mode === 'script' ? 'script' : 'manual';
    const vibe = Object.prototype.hasOwnProperty.call(VIBES, req.body.vibe) ? req.body.vibe : 'dynamic';
    const layout = VALID_LAYOUTS.has(req.body.layout) ? req.body.layout : 'landscape';
    const audioMode = VALID_AUDIO_MODES.has(req.body.audioMode) ? req.body.audioMode : 'mute';
    const title = typeof req.body.title === 'string' ? req.body.title.slice(0, 200) : '';
    const musicQuery = typeof req.body.musicQuery === 'string' ? req.body.musicQuery.slice(0, 100) : '';
    const script = typeof req.body.script === 'string' ? req.body.script.slice(0, 8000) : '';
    const voiceMode = VALID_VOICE_MODES.has(req.body.voiceMode) ? req.body.voiceMode : 'music';
    const artStyle = ART_STYLES.has(req.body.artStyle) ? req.body.artStyle : 'suggested';
    const imageTheme = typeof req.body.imageTheme === 'string' ? req.body.imageTheme.slice(0, 100) : 'India';
    const captionMode = VALID_CAPTION_MODES.has(req.body.captionMode) ? req.body.captionMode : 'headline';

    if (mode === 'script') {
      if (!script.trim()) {
        removeDirQuiet(req.uploadDir);
        return res.status(400).json({ error: 'The script is empty.' });
      }
      if (voiceMode === 'voice' && !voiceFile) {
        removeDirQuiet(req.uploadDir);
        return res.status(400).json({ error: 'Narration is set to "my voice" but no voice file was uploaded.' });
      }
    } else if (mediaFiles.length === 0) {
      removeDirQuiet(req.uploadDir);
      return res.status(400).json({ error: 'No files uploaded.' });
    }

    const jobId = req.jobId;
    jobs.set(jobId, {
      status: 'queued',
      percent: 0,
      stage: 'Queued',
      url: null,
      error: null,
      warnings: [],
      attribution: null,
      imageCredits: null,
    });

    // Respond immediately; render asynchronously.
    res.json({ jobId });

    const orderedFiles = mediaFiles.map((f) => f.path);
    setImmediate(() =>
      runJob(jobId, orderedFiles, {
        mode,
        vibe,
        layout,
        audioMode,
        title,
        musicQuery,
        script,
        voiceMode,
        voicePath: voiceFile ? voiceFile.path : null,
        artStyle,
        imageTheme,
        captionMode,
      })
    );
  }
);

app.use('/output', express.static(OUTPUT_DIR));

// ----------------------------------------------------------------- history

app.get('/api/history', (req, res) => {
  try {
    // Join each output file (filename = jobId) against the music ledger so
    // every history card can show which track it used.
    const ledgerByJob = new Map();
    for (const entry of listUsedTracks(MUSIC_CACHE_DIR)) {
      ledgerByJob.set(entry.jobId, entry);
    }
    const videos = fs
      .readdirSync(OUTPUT_DIR)
      .filter((f) => f.endsWith('.mp4'))
      .map((fileName) => {
        const stat = fs.statSync(path.join(OUTPUT_DIR, fileName));
        const jobId = fileName.slice(0, -4);
        const track = ledgerByJob.get(jobId) || null;
        // Script-mode renders carry a credits sidecar with their CC images.
        let imageCredits = null;
        try {
          const sidecar = path.join(OUTPUT_DIR, `${jobId}.credits.json`);
          if (fs.existsSync(sidecar)) {
            const credits = JSON.parse(fs.readFileSync(sidecar, 'utf8'));
            if (Array.isArray(credits.images) && credits.images.length > 0) imageCredits = credits.images;
          }
        } catch { /* unreadable sidecar — omit credits */ }
        return {
          jobId,
          fileName,
          url: `/output/${fileName}`,
          createdAt: stat.mtimeMs,
          sizeBytes: stat.size,
          attribution: track
            ? { title: track.title, creator: track.creator, license: track.license, sourceUrl: track.sourceUrl }
            : null,
          imageCredits,
        };
      })
      .sort((a, b) => b.createdAt - a.createdAt);
    res.json({ videos });
  } catch (err) {
    res.status(500).json({ error: `Could not read history: ${err.message}` });
  }
});

app.delete('/api/history/:jobId', (req, res) => {
  const { jobId } = req.params;
  // Strict id shape — no separators means no path traversal.
  if (!/^[A-Za-z0-9-]+$/.test(jobId)) {
    return res.status(400).json({ error: 'Invalid job id.' });
  }
  const file = path.join(OUTPUT_DIR, `${jobId}.mp4`);
  if (!fs.existsSync(file)) {
    return res.status(404).json({ error: 'Video not found.' });
  }
  try {
    fs.unlinkSync(file);
    removeFileQuiet(path.join(OUTPUT_DIR, `${jobId}.credits.json`));
    // The music ledger is deliberately untouched: a used track stays used
    // even after its video is deleted (strict no-reuse guarantee).
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: `Delete failed: ${err.message}` });
  }
});

// -------------------------------------------------------------- job runner

/**
 * Execute one render job end-to-end: process, emit lifecycle events, clean up.
 *
 * @param {string} jobId Job identifier.
 * @param {string[]} files Absolute media paths in upload order.
 * @param {{mode: string, vibe: string, layout: string, audioMode: string,
 *   title: string, musicQuery: string, artStyle: string, imageTheme: string,
 *   captionMode: string}} config Render config.
 */
async function runJob(jobId, files, config) {
  const uploadDir = path.join(UPLOADS_DIR, jobId);
  const outputFile = path.join(OUTPUT_DIR, `${jobId}.mp4`);
  console.log(
    `[job ${jobId}] starting: ${files.length} file(s), mode=${config.mode}, layout=${config.layout}, ` +
    `audioMode=${config.audioMode}, title=${config.title ? JSON.stringify(config.title) : '(none)'}, ` +
    `musicQuery=${config.musicQuery ? JSON.stringify(config.musicQuery) : '(default)'}`
  );

  let music = null;
  try {
    let style = {};
    if (config.mode === 'auto') {
      // Auto mode: the system decides everything. Layout = majority
      // orientation of the uploaded media; audio = music only; music query
      // and pacing come from the vibe preset.
      broadcast(jobId, 'progress', { percent: 0, stage: 'Choosing layout' });
      let portraitVotes = 0;
      let landscapeVotes = 0;
      for (const file of files) {
        try {
          const meta = await probeMedia(file);
          if (meta.height > meta.width) portraitVotes++;
          else if (meta.width > 0) landscapeVotes++;
        } catch { /* unreadable file — the processor will warn and skip it */ }
      }
      const vibe = VIBES[config.vibe];
      config.layout = portraitVotes > landscapeVotes ? 'portrait' : 'landscape';
      config.audioMode = 'mute';
      config.musicQuery = vibe.musicQuery;
      style = { ...AUTO_STYLE, ...vibe.style };
      applyArtStyleLook(style, config.artStyle);
      console.log(
        `[job ${jobId}] auto decisions: layout=${config.layout} ` +
        `(${portraitVotes}P/${landscapeVotes}L), vibe=${config.vibe}, ` +
        `look=${style.look || 'none'} (artStyle=${config.artStyle}), ` +
        `clip cap=${vibe.style.maxClipSeconds}s, xfade=${vibe.style.transitionDuration}s, ` +
        `music="${vibe.musicQuery}"`
      );
    } else if (config.mode === 'manual') {
      // Studio gets no automatic effects, but the shared Art-style chip still
      // lets a manual render opt into one of the named color grades.
      applyArtStyleLook(style, config.artStyle);
    }

    // Script mode: the written script becomes scenes with fetched visuals,
    // captions, and (optionally) narration.
    let scenesConfig = null;
    let voiceoverOpt = null;
    const imageCredits = [];
    if (config.mode === 'script') {
      broadcast(jobId, 'progress', { percent: 0, stage: 'Writing scenes' });
      const parsed = parseScript(config.script);
      if (parsed.scenes.length === 0) throw new Error('The script has no usable text.');
      if (parsed.capped) {
        broadcast(jobId, 'warning', { message: 'Long script — trimmed to the first 20 scenes.' });
      }
      if (!config.title && parsed.title) config.title = parsed.title;

      const vibe = VIBES[config.vibe];
      config.audioMode = 'mute';
      config.musicQuery = vibe.musicQuery;
      style = { ...AUTO_STYLE, ...vibe.style };
      applyArtStyleLook(style, config.artStyle);

      // Narration decides scene durations.
      let voiceMode = config.voiceMode;
      const sceneMeta = parsed.scenes.map((s) => ({
        ...s,
        duration: readingDuration(s.words),
        voPath: null,
      }));
      if (voiceMode === 'tts') {
        for (let i = 0; i < sceneMeta.length; i++) {
          broadcast(jobId, 'progress', { percent: 0, stage: `Recording narration (${i + 1}/${sceneMeta.length})` });
          const wav = await synthNarration({
            text: sceneMeta[i].text,
            wavPath: path.join(uploadDir, `narration-${i}.wav`),
            workDir: uploadDir,
            index: i,
          });
          if (wav) {
            sceneMeta[i].voPath = wav.path;
            sceneMeta[i].duration = Math.max(3, wav.duration + 0.8);
          } else if (i === 0) {
            broadcast(jobId, 'warning', { message: 'Text-to-speech unavailable — continuing with music only.' });
            voiceMode = 'music';
            break;
          } else {
            broadcast(jobId, 'warning', { message: `Narration failed for scene ${i + 1} — it will be silent.` });
          }
        }
        if (voiceMode === 'tts') voiceoverOpt = { mode: 'tts' };
      } else if (voiceMode === 'voice') {
        // One uploaded track narrates everything: distribute its length over
        // the scenes by word-count weight (+1.5s outro), so visuals fit the voice.
        const meta = await probeMedia(config.voicePath);
        if (!meta.hasAudio || !meta.duration) {
          throw new Error('The uploaded voice file is not readable audio.');
        }
        const totalWords = sceneMeta.reduce((sum, s) => sum + s.words, 0) || 1;
        const tApprox = style.transitionDuration || 0.5;
        const target = meta.duration + 1.5 + tApprox * (sceneMeta.length - 1);
        sceneMeta.forEach((s) => {
          s.duration = Math.max(2.5, (s.words / totalWords) * target);
        });
        voiceoverOpt = { mode: 'file', path: config.voicePath };
      }

      // Visuals + on-screen text per scene. Captions are NOT the full script
      // by default — that was too much text on screen. The default is a
      // short headline (2–3 keywords, Title Case) under a large ideogram
      // icon; "full" restores the old full-paragraph lower third; "none"
      // renders the visual alone. Narration (any mode) always speaks the
      // complete scene text regardless of what's shown on screen.
      const wrapChars = config.layout === 'portrait' ? 24 : 34;
      scenesConfig = [];
      for (let i = 0; i < sceneMeta.length; i++) {
        broadcast(jobId, 'progress', { percent: 0, stage: `Fetching visuals (${i + 1}/${sceneMeta.length})` });
        const image = await fetchSceneImage({
          query: extractKeywords(sceneMeta[i].text),
          destDir: uploadDir,
          index: i,
          style: config.artStyle,
          theme: config.imageTheme,
        });
        if (image) imageCredits.push(image.attribution);

        let captionFile = null;
        let headlineIconFile = null;
        let headlineLabelFile = null;
        if (config.captionMode === 'full') {
          captionFile = path.join(uploadDir, `caption-${i}.txt`);
          fs.writeFileSync(captionFile, wrapCaption(sceneMeta[i].text, wrapChars), 'utf8');
        } else if (config.captionMode === 'headline') {
          const headline = buildHeadline(sceneMeta[i].text, i);
          headlineIconFile = path.join(uploadDir, `headline-icon-${i}.txt`);
          headlineLabelFile = path.join(uploadDir, `headline-label-${i}.txt`);
          fs.writeFileSync(headlineIconFile, headline.icon, 'utf8');
          fs.writeFileSync(headlineLabelFile, headline.label, 'utf8');
        }
        // captionMode === 'none' leaves all three null — the scene renders
        // as a pure visual with no on-screen text.

        scenesConfig.push({
          duration: sceneMeta[i].duration,
          imagePath: image ? image.path : null,
          captionFile,
          headlineIconFile,
          headlineLabelFile,
          voPath: sceneMeta[i].voPath,
          gradient: SCENE_GRADIENTS[i % SCENE_GRADIENTS.length],
        });
      }
      if (imageCredits.length === 0) {
        broadcast(jobId, 'warning', { message: 'No online images found — using animated gradient backgrounds.' });
      }
      console.log(
        `[job ${jobId}] script decisions: scenes=${scenesConfig.length}, narration=${voiceMode}, ` +
        `images=${imageCredits.length}, layout=${config.layout}, vibe=${config.vibe}, ` +
        `look=${style.look || 'none'} (artStyle=${config.artStyle}), theme=${JSON.stringify(config.imageTheme)}, ` +
        `captions=${config.captionMode}` +
        (config.title ? `, title=${JSON.stringify(config.title)}` : '')
      );
    }
    // Online-first music resolution (Openverse → cache → local folder → none),
    // strict no-reuse: only tracks never consumed by a finished video.
    music = await resolveMusicTrack({
      query: config.musicQuery,
      audioDir: AUDIO_DIR,
      cacheDir: MUSIC_CACHE_DIR,
      onWarning: (message) => broadcast(jobId, 'warning', { message }),
      onStage: (stage) => broadcast(jobId, 'progress', { percent: 0, stage }),
    });
    if (music) {
      console.log(
        `[job ${jobId}] music: ${path.basename(music.path)}` +
        (music.attribution ? ` ("${music.attribution.title}" by ${music.attribution.creator}, ${music.attribution.license})` : ' (local file)')
      );
    }

    const result = await processJob({
      jobId,
      files,
      scenes: scenesConfig,
      voiceover: voiceoverOpt,
      layout: config.layout,
      audioMode: config.audioMode,
      title: config.title,
      style,
      outputDir: OUTPUT_DIR,
      musicPath: music ? music.path : null,
      audioDir: AUDIO_DIR,
      workDir: uploadDir,
      onProgress: (percent, stage) => broadcast(jobId, 'progress', { percent, stage }),
      onWarning: (message) => broadcast(jobId, 'warning', { message }),
    });

    // Script mode: persist the CC credits next to the video so History can
    // show them after this process forgets the job.
    if (config.mode === 'script') {
      try {
        fs.writeFileSync(
          path.join(OUTPUT_DIR, `${jobId}.credits.json`),
          JSON.stringify({ music: music ? music.attribution : null, images: imageCredits }, null, 2),
          'utf8'
        );
      } catch (err) {
        console.warn(`[job ${jobId}] could not write credits sidecar: ${err.message}`);
      }
    }

    broadcast(jobId, 'complete', {
      url: `/output/${result.fileName}`,
      attribution: music ? music.attribution : null,
      imageCredits: imageCredits.length > 0 ? imageCredits : null,
    });

    // The render consumed this track — ledger it so no future video reuses it.
    // Local public/audio files (id=null) are user-managed and exempt.
    if (music && music.id) {
      markTrackUsed(MUSIC_CACHE_DIR, {
        id: music.id,
        ...(music.attribution || {}),
        file: path.basename(music.path),
        jobId,
      });
    }
    console.log(
      `[job ${jobId}] complete: ${result.fileName} (${result.duration.toFixed(2)}s, ` +
      `transitions: ${result.transitions.join(', ') || 'none'}, music: ${result.musicTrack || 'none'})`
    );
    removeDirQuiet(uploadDir);
  } catch (err) {
    console.error(`[job ${jobId}] failed:`, err.message);
    broadcast(jobId, 'error', { message: err.message });
    // A failed render must not burn the track — release it for future jobs.
    if (music && music.id) releaseTrackReservation(music.id);
    removeDirQuiet(uploadDir);
    removeFileQuiet(outputFile);
  }
}

// --------------------------------------------------------------- socket.io

io.on('connection', (socket) => {
  socket.on('join', (jobId) => {
    if (typeof jobId !== 'string') return;
    socket.join(jobId);
    // Replay the latest snapshot so a late join never misses the outcome.
    const state = jobs.get(jobId);
    if (!state) return;
    for (const message of state.warnings) {
      socket.emit('warning', { message });
    }
    if (state.status === 'complete') {
      socket.emit('complete', { url: state.url, attribution: state.attribution, imageCredits: state.imageCredits });
    } else if (state.status === 'error') {
      socket.emit('error', { message: state.error });
    } else {
      socket.emit('progress', { percent: state.percent, stage: state.stage });
    }
  });
});

httpServer.listen(PORT, () => {
  console.log(`Highlight-reel server listening on http://localhost:${PORT}`);
  console.log(`ffmpeg binary: ${FFMPEG_PATH}`);
  if (!hasFilter('xfade')) {
    console.error('WARNING: selected ffmpeg binary lacks xfade — renders with transitions will fail.');
  }
});
