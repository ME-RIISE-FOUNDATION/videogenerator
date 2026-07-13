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

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const PORT = process.env.PORT || 5000;
const UPLOADS_DIR = path.join(__dirname, 'uploads');
const OUTPUT_DIR = path.join(__dirname, 'output');
const AUDIO_DIR = path.join(__dirname, 'public', 'audio');
const MUSIC_CACHE_DIR = path.join(__dirname, 'cache', 'music');

const ALLOWED_EXTS = new Set(['.jpg', '.jpeg', '.png', '.mp4', '.mov']);
const VALID_LAYOUTS = new Set(['portrait', 'landscape']);
const VALID_AUDIO_MODES = new Set(['mute', 'merge']);

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
    upload.array('files')(req, res, (err) => {
      if (err) {
        removeDirQuiet(req.uploadDir);
        return res.status(400).json({ error: err.message });
      }
      next();
    });
  },
  (req, res) => {
    if (!req.files || req.files.length === 0) {
      removeDirQuiet(req.uploadDir);
      return res.status(400).json({ error: 'No files uploaded.' });
    }

    const mode = req.body.mode === 'auto' ? 'auto' : 'manual';
    const vibe = Object.prototype.hasOwnProperty.call(VIBES, req.body.vibe) ? req.body.vibe : 'dynamic';
    const layout = VALID_LAYOUTS.has(req.body.layout) ? req.body.layout : 'landscape';
    const audioMode = VALID_AUDIO_MODES.has(req.body.audioMode) ? req.body.audioMode : 'mute';
    const title = typeof req.body.title === 'string' ? req.body.title.slice(0, 200) : '';
    const musicQuery = typeof req.body.musicQuery === 'string' ? req.body.musicQuery.slice(0, 100) : '';

    const jobId = req.jobId;
    jobs.set(jobId, {
      status: 'queued',
      percent: 0,
      stage: 'Queued',
      url: null,
      error: null,
      warnings: [],
      attribution: null,
    });

    // Respond immediately; render asynchronously.
    res.json({ jobId });

    const orderedFiles = req.files.map((f) => f.path);
    setImmediate(() => runJob(jobId, orderedFiles, { mode, vibe, layout, audioMode, title, musicQuery }));
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
        return {
          jobId,
          fileName,
          url: `/output/${fileName}`,
          createdAt: stat.mtimeMs,
          sizeBytes: stat.size,
          attribution: track
            ? { title: track.title, creator: track.creator, license: track.license, sourceUrl: track.sourceUrl }
            : null,
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
 *   title: string, musicQuery: string}} config Render config.
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
      console.log(
        `[job ${jobId}] auto decisions: layout=${config.layout} ` +
        `(${portraitVotes}P/${landscapeVotes}L), vibe=${config.vibe}, ` +
        `look=${vibe.style.look}, clip cap=${vibe.style.maxClipSeconds}s, ` +
        `xfade=${vibe.style.transitionDuration}s, music="${vibe.musicQuery}"`
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

    broadcast(jobId, 'complete', {
      url: `/output/${result.fileName}`,
      attribution: music ? music.attribution : null,
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
      socket.emit('complete', { url: state.url, attribution: state.attribution });
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
