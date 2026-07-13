/**
 * videoProcessor.js
 *
 * All FFmpeg logic for the highlight-reel generator. Builds one dynamic
 * -filter_complex graph that:
 *   1. Normalizes every input (scale → pad → setsar=1 → fps=30 → yuv420p) so
 *      xfade never sees mismatched resolution / SAR / fps (it hard-fails on those).
 *   2. Chains randomized 0.5s xfade transitions across every boundary, in the
 *      exact upload order.
 *   3. Assembles the audio graph for either "mute" (music only) or "merge"
 *      (clip audio crossfaded to match the video timeline, then amixed with
 *      ducked background music).
 *   4. Renders with libx264 / AAC and reports frame-accurate progress.
 *
 * No system FFmpeg required — binaries come from @ffmpeg-installer/ffmpeg and
 * @ffprobe-installer/ffprobe.
 */

import fs from 'fs';
import path from 'path';
import { spawnSync } from 'child_process';
import ffmpeg from 'fluent-ffmpeg';
import ffmpegInstaller from '@ffmpeg-installer/ffmpeg';
import ffprobeInstaller from '@ffprobe-installer/ffprobe';
import ffmpegStatic from 'ffmpeg-static';

/**
 * Check whether a specific ffmpeg binary supports a given filter.
 *
 * @param {string} binPath Absolute path to an ffmpeg executable.
 * @param {string} filterName Filter to look for in `-filters` output.
 * @returns {boolean} True if the filter is listed.
 */
function binaryHasFilter(binPath, filterName) {
  try {
    const result = spawnSync(binPath, ['-hide_banner', '-filters'], {
      encoding: 'utf8',
      windowsHide: true,
    });
    if (result.error || result.status !== 0) return false;
    return new RegExp(`\\s${filterName}\\s`).test(result.stdout || '');
  } catch {
    return false;
  }
}

// Binary selection: prefer @ffmpeg-installer per the fixed stack, but its
// win32-x64 package ships a 2018 build (pre-4.3) WITHOUT the xfade filter that
// the whole transition engine depends on. When that's the case, fall back to
// ffmpeg-static (FFmpeg 6.x) — still fully bundled, no system dependency.
const selectedFfmpeg = (() => {
  if (binaryHasFilter(ffmpegInstaller.path, 'xfade')) return ffmpegInstaller.path;
  if (ffmpegStatic && binaryHasFilter(ffmpegStatic, 'xfade')) {
    console.warn(
      '[videoProcessor] @ffmpeg-installer binary lacks the xfade filter (FFmpeg < 4.3); ' +
      'using the ffmpeg-static binary instead.'
    );
    return ffmpegStatic;
  }
  console.error(
    '[videoProcessor] WARNING: no bundled ffmpeg binary supports xfade — transition renders will fail.'
  );
  return ffmpegInstaller.path;
})();

ffmpeg.setFfmpegPath(selectedFfmpeg);
ffmpeg.setFfprobePath(ffprobeInstaller.path);

/** Absolute path of the selected ffmpeg binary (exported for the self-test). */
export const FFMPEG_PATH = selectedFfmpeg;
/** Absolute path of the bundled ffprobe binary (exported for the self-test). */
export const FFPROBE_PATH = ffprobeInstaller.path;

const FPS = 30;
const IMAGE_DURATION = 3; // seconds each still image is shown
const TITLE_DURATION = 3; // seconds for the optional title slide
const TRANSITION_DURATION = 0.5; // seconds of xfade overlap per boundary
const MUSIC_DUCK_VOLUME = 0.35; // music level under clip audio in merge mode
const VOICE_MUSIC_DUCK = 0.2; // music level under narration (script mode)
const AUDIO_FADE_OUT = 2; // seconds of afade=t=out at the very end

const IMAGE_EXTS = new Set(['.jpg', '.jpeg', '.png']);
const VIDEO_EXTS = new Set(['.mp4', '.mov']);

/** Pool of xfade transition names, one picked at random per boundary. */
const TRANSITIONS = [
  'fade',
  'fadeblack',
  'fadewhite',
  'wipeleft',
  'wiperight',
  'slideleft',
  'slideright',
  'circleopen',
  'circlecrop',
  'smoothup',
  'smoothdown',
];

const LAYOUTS = {
  portrait: { width: 1080, height: 1920 },
  landscape: { width: 1920, height: 1080 },
};

/**
 * Named color-grade chains applied after the xfade chain (auto-mode looks).
 * Each is a list of filter steps, joined into the post-processing chain.
 */
const LOOKS = {
  // Punchy social-media pop: more contrast and saturation, slightly lifted.
  vibrant: ['eq=contrast=1.08:saturation=1.22:brightness=0.02'],
  // Film look: crushed a touch, desaturated, teal shadows / orange highlights.
  cinema: [
    'eq=contrast=1.12:saturation=0.95',
    'colorbalance=rs=-0.05:gs=-0.02:bs=0.06:rh=0.05:gh=0.01:bh=-0.05',
  ],
  // Golden-hour warmth: gentle contrast, warm shadows and highlights.
  warm: [
    'eq=contrast=1.05:saturation=1.08:brightness=0.01',
    'colorbalance=rs=0.05:gs=0.01:bs=-0.05:rh=0.03:bh=-0.03',
  ],
};

/** Per-OS candidate font files for the drawtext title slide. */
const FONT_CANDIDATES = {
  win32: [
    'C:/Windows/Fonts/arialbd.ttf',
    'C:/Windows/Fonts/arial.ttf',
    'C:/Windows/Fonts/segoeuib.ttf',
    'C:/Windows/Fonts/segoeui.ttf',
    'C:/Windows/Fonts/calibrib.ttf',
    'C:/Windows/Fonts/calibri.ttf',
  ],
  darwin: [
    '/System/Library/Fonts/Supplemental/Arial Bold.ttf',
    '/System/Library/Fonts/Supplemental/Arial.ttf',
    '/System/Library/Fonts/Helvetica.ttc',
    '/System/Library/Fonts/SFNS.ttf',
  ],
  linux: [
    '/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf',
    '/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf',
    '/usr/share/fonts/truetype/liberation/LiberationSans-Bold.ttf',
    '/usr/share/fonts/truetype/liberation/LiberationSans-Regular.ttf',
    '/usr/share/fonts/TTF/DejaVuSans.ttf',
  ],
};

/**
 * Probe a media file with the bundled ffprobe.
 *
 * @param {string} filePath Absolute path to the media file.
 * @returns {Promise<{duration: number, hasAudio: boolean, width: number, height: number}>}
 *   Resolves with the container duration in seconds (0 if indeterminate),
 *   whether an audio stream exists, and the first video stream's dimensions.
 *   Rejects if ffprobe cannot read the file (corrupt / not media).
 */
export function probeMedia(filePath) {
  return new Promise((resolve, reject) => {
    ffmpeg.ffprobe(filePath, (err, data) => {
      if (err) return reject(new Error(`ffprobe failed: ${err.message}`));
      const videoStream = (data.streams || []).find((s) => s.codec_type === 'video');
      const audioStream = (data.streams || []).find((s) => s.codec_type === 'audio');
      let duration = parseFloat(data.format && data.format.duration);
      if ((!duration || Number.isNaN(duration)) && videoStream) {
        duration = parseFloat(videoStream.duration);
      }
      resolve({
        duration: !duration || Number.isNaN(duration) ? 0 : duration,
        hasAudio: Boolean(audioStream),
        width: videoStream ? videoStream.width : 0,
        height: videoStream ? videoStream.height : 0,
      });
    });
  });
}

/**
 * Check whether the bundled ffmpeg binary supports a given filter (e.g. "xfade",
 * which only exists in FFmpeg >= 4.3). Used once at server startup so a missing
 * filter is a loud, early failure instead of a cryptic render error.
 *
 * @param {string} filterName Filter to look for in `ffmpeg -filters` output.
 * @returns {boolean} True if the filter is listed.
 */
export function hasFilter(filterName) {
  return binaryHasFilter(FFMPEG_PATH, filterName);
}

/**
 * Escape a filesystem path for use inside an ffmpeg filter-graph option value
 * (drawtext fontfile= / textfile=). FFmpeg parses filter args at TWO levels:
 * the graph parser (which honors single quotes and eats one layer of
 * backslashes) and then the filter's own option parser (which splits on
 * unescaped `:`). So a Windows drive-letter colon must be BOTH quoted (to
 * survive the graph parser with its backslash intact) AND `\:`-escaped (so the
 * option parser doesn't split the path at `C:`). A bare `\:` without quotes
 * loses its backslash at the graph level and drawtext misparses the path.
 *
 * @param {string} p Absolute path.
 * @returns {string} Quoted, filter-safe path string.
 */
function escapeFilterPath(p) {
  const escaped = p
    .replace(/\\/g, '/')
    .replace(/'/g, "'\\''") // close quote, escaped literal ', reopen quote
    .replace(/:/g, '\\:');
  return `'${escaped}'`;
}

/**
 * Resolve the first available system font for drawtext, per platform.
 *
 * @returns {string|null} Absolute font path, or null when nothing usable exists.
 */
function findFontFile() {
  const candidates = FONT_CANDIDATES[process.platform] || FONT_CANDIDATES.linux;
  for (const candidate of candidates) {
    if (fs.existsSync(candidate)) return candidate;
  }
  return null;
}

/**
 * Pick a uniformly random element from an array.
 *
 * @param {Array<*>} arr Non-empty array.
 * @returns {*} A random element.
 */
function pickRandom(arr) {
  return arr[Math.floor(Math.random() * arr.length)];
}

/**
 * List the .mp3 tracks available in the background-music folder.
 *
 * @param {string} audioDir Directory to scan (server/public/audio).
 * @returns {string[]} Absolute paths of .mp3 files (empty when none / no dir).
 */
export function listMusicTracks(audioDir) {
  if (!audioDir || !fs.existsSync(audioDir)) return [];
  return fs
    .readdirSync(audioDir)
    .filter((f) => f.toLowerCase().endsWith('.mp3'))
    .map((f) => path.join(audioDir, f));
}

/**
 * Render one highlight-reel job.
 *
 * Inputs are stitched in the EXACT array order given — never re-sorted. Images
 * run exactly 3s; video durations come from ffprobe. A corrupt/unreadable video
 * is skipped with a warning instead of failing the whole job.
 *
 * @param {object} options
 * @param {string}   options.jobId       Unique job id; output becomes `<outputDir>/<jobId>.mp4`.
 * @param {string[]} [options.files]     Absolute media paths in upload order.
 * @param {Array<object>} [options.scenes] Script-mode alternative to `files`:
 *   each `{ duration, imagePath|null, captionFile|null, voPath|null, gradient? }`
 *   becomes an animated scene (Ken Burns image or animated gradient) with an
 *   optional lower-third caption and optional per-scene narration WAV.
 * @param {object}   [options.voiceover] Narration config for scenes:
 *   `{ mode: 'file', path }` — one uploaded track narrates the whole video;
 *   `{ mode: 'tts' }` — per-scene WAVs from scenes[].voPath. Either way the
 *   background music is ducked to 0.2 under the voice.
 * @param {'portrait'|'landscape'} options.layout Output geometry (1080x1920 / 1920x1080).
 * @param {'mute'|'merge'} options.audioMode 'mute' = music only; 'merge' = clip audio + ducked music.
 * @param {string}   options.title       Optional title; non-empty prepends a 3s drawtext slide.
 * @param {object}   [options.style]     Professional "auto mode" styling, all off by default:
 *   {boolean} kenBurns        — photos get cover-crop + slow zoompan motion instead of static pad.
 *   {boolean} kenBurnsPan     — adds lateral pan variants (L→R / R→L) to the photo-motion pool.
 *   {boolean} blurFill        — videos sit on a blurred scaled copy of themselves instead of black bars.
 *   {number}  maxClipSeconds  — cap each video at this length, trimming to its MIDDLE segment.
 *   {string[]} transitionPool — override the transition pool (weight by repetition).
 *   {number}  transitionDuration — override the 0.5s xfade length (still clamped vs. shortest item).
 *   {string}  look            — named color grade: 'vibrant' | 'cinema' | 'warm' (supersedes colorPolish).
 *   {boolean} sharpen         — mild unsharp crispness pass.
 *   {boolean} vignette        — subtle darkened corners.
 *   {boolean} grain           — subtle animated film grain.
 *   {boolean} letterbox       — cinematic black bars (12% of height each side landscape, 7% portrait).
 *   {boolean} edgeFades       — 0.5s fade-in from black and 1s fade-out to black on the final video.
 *   {boolean} colorPolish     — legacy subtle eq grade; ignored when `look` is set.
 *   {boolean} musicFadeIn     — 1s afade-in on the background music.
 * @param {string}   options.outputDir   Directory for the rendered mp4 (must exist).
 * @param {string}   [options.musicPath] Pre-resolved background track (e.g. from
 *   musicFetcher). When set, the audioDir scan is skipped entirely.
 * @param {string}   options.audioDir    Folder scanned for .mp3 background tracks
 *   (fallback when musicPath is not provided).
 * @param {string}   options.workDir     Scratch dir for the title textfile (the job's upload folder).
 * @param {function(number, string): void} [options.onProgress] (percent 0-100, stage label).
 * @param {function(string): void} [options.onWarning] Non-fatal warning callback.
 * @returns {Promise<{outputFile: string, fileName: string, duration: number,
 *   transitions: string[], musicTrack: string|null, warnings: string[]}>}
 *   Resolves when the mp4 is fully written and non-empty; rejects on any fatal
 *   FFmpeg error (with the tail of stderr in the message for debuggability).
 */
export async function processJob(options) {
  const {
    jobId,
    files = [],
    scenes = null,
    voiceover = null,
    layout = 'landscape',
    audioMode = 'mute',
    title = '',
    style = {},
    outputDir,
    musicPath: presetMusicPath = null,
    audioDir,
    workDir,
    onProgress = () => {},
    onWarning = () => {},
  } = options;

  const kenBurns = Boolean(style.kenBurns);
  const kenBurnsPan = Boolean(style.kenBurnsPan);
  const blurFill = Boolean(style.blurFill);
  const maxClipSeconds = style.maxClipSeconds > 0 ? style.maxClipSeconds : null;
  const transitionPool =
    Array.isArray(style.transitionPool) && style.transitionPool.length > 0
      ? style.transitionPool
      : TRANSITIONS;
  const baseTransition = style.transitionDuration > 0 ? style.transitionDuration : TRANSITION_DURATION;
  const look = typeof style.look === 'string' && LOOKS[style.look] ? style.look : null;
  const sharpen = Boolean(style.sharpen);
  const vignetteFx = Boolean(style.vignette);
  const grainFx = Boolean(style.grain);
  const letterbox = Boolean(style.letterbox);
  const edgeFades = Boolean(style.edgeFades);
  const colorPolish = Boolean(style.colorPolish);
  const musicFadeIn = Boolean(style.musicFadeIn);

  const warnings = [];
  const warn = (message) => {
    warnings.push(message);
    onWarning(message);
  };

  const dims = LAYOUTS[layout];
  if (!dims) throw new Error(`Unknown layout "${layout}" (expected portrait|landscape)`);
  const { width: W, height: H } = dims;

  onProgress(0, 'Analyzing media');

  // ---------------------------------------------------------------- probing
  // Build the ordered item list. Script mode supplies pre-built scenes;
  // otherwise images get a fixed 3s duration and videos are probed for real
  // duration and audio presence. Unreadable videos are skipped with a warning
  // rather than killing the job.
  const items = [];
  const useScenes = Array.isArray(scenes) && scenes.length > 0;
  if (useScenes) {
    for (const scene of scenes) {
      items.push({
        type: 'scene',
        duration: scene.duration,
        hasAudio: false,
        imagePath: scene.imagePath || null,
        captionFile: scene.captionFile || null,
        voPath: scene.voPath || null,
        voIndex: -1,
        gradient: Array.isArray(scene.gradient) ? scene.gradient : ['0x1b2a4a', '0x0c0f1c'],
      });
    }
  }
  for (const filePath of useScenes ? [] : files) {
    const ext = path.extname(filePath).toLowerCase();
    if (IMAGE_EXTS.has(ext)) {
      items.push({ type: 'image', path: filePath, duration: IMAGE_DURATION, hasAudio: false });
    } else if (VIDEO_EXTS.has(ext)) {
      try {
        const meta = await probeMedia(filePath);
        if (!meta.duration || meta.duration < 0.2) {
          throw new Error('no usable duration');
        }
        // Auto pacing: cap long clips, keeping the MIDDLE window (more likely
        // to hold the action than the first N seconds). All timeline math
        // below uses the capped duration.
        let duration = meta.duration;
        let trimStart = 0;
        if (maxClipSeconds && meta.duration > maxClipSeconds) {
          trimStart = (meta.duration - maxClipSeconds) / 2;
          duration = maxClipSeconds;
        }
        items.push({ type: 'video', path: filePath, duration, trimStart, hasAudio: meta.hasAudio });
      } catch (err) {
        warn(`Skipped unreadable video "${path.basename(filePath)}" (${err.message})`);
      }
    } else {
      warn(`Skipped unsupported file "${path.basename(filePath)}"`);
    }
  }

  if (items.length === 0) {
    throw new Error('No usable media files — every input was unreadable or unsupported.');
  }

  // ------------------------------------------------------------ title slide
  // The title becomes item 0: a 3s lavfi color=black source with centered
  // drawtext. The text goes through a textfile= (not text=) so user input never
  // needs filter-graph escaping — only the two file PATHS do.
  if (title && title.trim()) {
    const fontFile = findFontFile();
    let textFile = null;
    if (fontFile) {
      textFile = path.join(workDir, 'title.txt');
      fs.writeFileSync(textFile, title.trim(), 'utf8');
    } else {
      warn('No system font found — title slide will be blank black.');
    }
    items.unshift({ type: 'title', duration: TITLE_DURATION, hasAudio: false, fontFile, textFile });
  }

  // ------------------------------------------------------- timeline geometry
  // Transition duration T is normally 0.5s, but is clamped below half of the
  // shortest item so xfade/acrossfade can never be asked to overlap more media
  // than an item actually has (both filters hard-fail in that case).
  const minDuration = Math.min(...items.map((i) => i.duration));
  const T = items.length > 1 ? Math.min(baseTransition, Math.max(0.1, minDuration / 2 - 0.05)) : 0;
  if (items.length > 1 && T < baseTransition) {
    warn(`Transition length reduced to ${T.toFixed(2)}s because the shortest item is only ${minDuration.toFixed(2)}s.`);
  }

  // Final visual duration: each of the (N-1) boundaries overlaps T seconds.
  const totalDuration = items.reduce((sum, i) => sum + i.duration, 0) - T * (items.length - 1);

  // ---------------------------------------------------------- music pick
  // A pre-resolved track (musicFetcher's online-first pipeline) wins; the
  // audioDir scan remains as the direct-call fallback (selftest, legacy).
  let musicPath = presetMusicPath;
  if (!musicPath) {
    const tracks = listMusicTracks(audioDir);
    musicPath = tracks.length > 0 ? pickRandom(tracks) : null;
  }
  if (!musicPath) {
    warn('No background music available — rendering without music.');
  }

  onProgress(0, 'Building filter graph');

  // ------------------------------------------------------------- ffmpeg cmd
  const command = ffmpeg();

  items.forEach((item) => {
    if (item.type === 'title') {
      // Synthesized black slide; already at target size and fps.
      command.input(`color=c=black:s=${W}x${H}:r=${FPS}:d=${item.duration}`).inputFormat('lavfi');
    } else if (item.type === 'scene') {
      if (item.imagePath) {
        // Single frame in — zoompan below animates it.
        command.input(item.imagePath);
      } else {
        // Offline fallback: subtly animated dark gradient background.
        command
          .input(
            `gradients=s=${W}x${H}:c0=${item.gradient[0]}:c1=${item.gradient[1]}` +
            `:speed=0.02:r=${FPS}:d=${item.duration.toFixed(3)}`
          )
          .inputFormat('lavfi');
      }
    } else if (item.type === 'image') {
      if (kenBurns) {
        // Single frame in — zoompan below duplicates it into an animated clip.
        command.input(item.path);
      } else {
        // -loop 1 -t 3 turns the still into an exactly-3s video stream.
        command.input(item.path).inputOptions(['-loop', '1', '-t', String(item.duration)]);
      }
    } else {
      command.input(item.path);
    }
  });

  // Inputs after the visual items: narration (whole-video file OR per-scene
  // TTS WAVs), then music — indexes tracked dynamically.
  let inputCount = items.length;
  let voiceIndex = -1;
  if (voiceover && voiceover.mode === 'file' && voiceover.path) {
    voiceIndex = inputCount++;
    command.input(voiceover.path);
  } else if (voiceover && voiceover.mode === 'tts') {
    items.forEach((item) => {
      if (item.voPath) {
        item.voIndex = inputCount++;
        command.input(item.voPath);
      }
    });
  }

  let musicIndex = -1;
  if (musicPath) {
    musicIndex = inputCount++;
    // -stream_loop -1 repeats the track forever; atrim below cuts it to length.
    command.input(musicPath).inputOptions(['-stream_loop', '-1']);
  }

  // Captions need a system font; without one the video still renders.
  const captionFont = useScenes ? findFontFile() : null;
  if (useScenes && !captionFont && items.some((it) => it.captionFile)) {
    warn('No system font found — captions will be omitted.');
  }

  const filters = [];

  // --------------------------------------------------- video normalization
  // Every stream is forced to identical W×H / SAR 1 / 30fps / yuv420p BEFORE
  // any xfade. xfade errors out on mismatched resolution, SAR or fps, so this
  // normalization is non-negotiable for arbitrary user uploads.
  const normalizeChain =
    `scale=${W}:${H}:force_original_aspect_ratio=decrease,` +
    `pad=${W}:${H}:(ow-iw)/2:(oh-ih)/2:black,setsar=1,fps=${FPS},format=yuv420p`;

  items.forEach((item, i) => {
    if (item.type === 'scene') {
      // Lower-third caption: wrapped text via textfile= (no escaping issues),
      // readable box, alpha fade in/out over the scene.
      let caption = '';
      if (item.captionFile && captionFont) {
        const capSize = Math.round(Math.min(W, H) / 18);
        const fadeOutAt = Math.max(0.6, item.duration - 0.6).toFixed(3);
        caption =
          `drawtext=fontfile=${escapeFilterPath(captionFont)}` +
          `:textfile=${escapeFilterPath(item.captionFile)}` +
          `:fontcolor=white:fontsize=${capSize}:line_spacing=10` +
          `:box=1:boxcolor=black@0.45:boxborderw=18` +
          `:x=(w-text_w)/2:y=h-text_h-h*0.10` +
          `:alpha='if(lt(t,0.6),t/0.6,if(gt(t,${fadeOutAt}),(${item.duration.toFixed(3)}-t)/0.6,1))',`;
      }
      if (item.imagePath) {
        const frames = Math.round(item.duration * FPS);
        const centered = `x='iw/2-(iw/zoom/2)':y='ih/2-(ih/zoom/2)'`;
        const motions = [
          `z='min(zoom+0.0012,1.15)':${centered}`,
          `z='if(lte(on,1),1.15,max(zoom-0.0012,1.001))':${centered}`,
          `z='1.15':x='(iw-iw/zoom)*on/${Math.max(1, frames - 1)}':y='ih/2-(ih/zoom/2)'`,
          `z='1.15':x='(iw-iw/zoom)*(1-on/${Math.max(1, frames - 1)})':y='ih/2-(ih/zoom/2)'`,
        ];
        filters.push(
          `[${i}:v]scale=${W * 2}:${H * 2}:force_original_aspect_ratio=increase,` +
          `crop=${W * 2}:${H * 2},` +
          `zoompan=${pickRandom(motions)}:d=${frames}:s=${W}x${H}:fps=${FPS},` +
          `${caption}setsar=1,format=yuv420p[v${i}]`
        );
      } else {
        // Gradient source is already W×H at the right fps.
        filters.push(`[${i}:v]${caption}setsar=1,format=yuv420p[v${i}]`);
      }
      return;
    }

    if (item.type === 'image' && kenBurns) {
      // Ken Burns: cover-crop to fill the frame (no bars), then a slow zoompan
      // (random in/out per photo). The single input frame is duplicated into
      // d = duration×fps output frames, so the item is still exactly 3s.
      const frames = Math.round(item.duration * FPS);
      const centered = `x='iw/2-(iw/zoom/2)':y='ih/2-(ih/zoom/2)'`;
      // Motion pool: slow push-in, pull-out, and (when kenBurnsPan) lateral
      // pans at a fixed 1.15 zoom driven by the output frame number `on`.
      const motions = [
        `z='min(zoom+0.0012,1.15)':${centered}`,
        `z='if(lte(on,1),1.15,max(zoom-0.0012,1.001))':${centered}`,
      ];
      if (kenBurnsPan) {
        motions.push(
          `z='1.15':x='(iw-iw/zoom)*on/${frames - 1}':y='ih/2-(ih/zoom/2)'`,
          `z='1.15':x='(iw-iw/zoom)*(1-on/${frames - 1})':y='ih/2-(ih/zoom/2)'`
        );
      }
      filters.push(
        `[${i}:v]scale=${W * 2}:${H * 2}:force_original_aspect_ratio=increase,` +
        `crop=${W * 2}:${H * 2},` +
        `zoompan=${pickRandom(motions)}` +
        `:d=${frames}:s=${W}x${H}:fps=${FPS},setsar=1,format=yuv420p[v${i}]`
      );
      return;
    }

    // Middle-window trim for capped clips (auto pacing).
    const trimPrefix =
      item.type === 'video' && item.trimStart > 0
        ? `trim=start=${item.trimStart.toFixed(3)}:duration=${item.duration.toFixed(3)},setpts=PTS-STARTPTS,`
        : '';

    if (item.type === 'video' && blurFill) {
      // Blur-fill: aspect-mismatched clips sit on a blurred, cover-cropped
      // copy of themselves instead of black bars.
      filters.push(`[${i}:v]${trimPrefix}split=2[bg${i}][fg${i}]`);
      filters.push(
        `[bg${i}]scale=${W}:${H}:force_original_aspect_ratio=increase,` +
        `crop=${W}:${H},boxblur=20:2[bgb${i}]`
      );
      filters.push(`[fg${i}]scale=${W}:${H}:force_original_aspect_ratio=decrease[fgs${i}]`);
      filters.push(
        `[bgb${i}][fgs${i}]overlay=(W-w)/2:(H-h)/2,setsar=1,fps=${FPS},format=yuv420p[v${i}]`
      );
      return;
    }

    let chain = `[${i}:v]${trimPrefix}`;
    if (item.type === 'title' && item.textFile && item.fontFile) {
      const fontSize = Math.round(Math.min(W, H) / 12);
      chain +=
        `drawtext=fontfile=${escapeFilterPath(item.fontFile)}` +
        `:textfile=${escapeFilterPath(item.textFile)}` +
        `:fontcolor=white:fontsize=${fontSize}:x=(w-text_w)/2:y=(h-text_h)/2,`;
    }
    chain += `${normalizeChain}[v${i}]`;
    filters.push(chain);
  });

  // ------------------------------------------------------------ xfade chain
  // Chained xfades. For boundary n (0-based, joining item n+1 onto the chain):
  //
  //   offset_n = (sum of durations of items 0..n) − T·(n+1)
  //
  // because after n prior transitions the accumulated stream is already T·n
  // shorter than the raw sum, and the new fade must start T before that
  // accumulated stream ends. Implemented incrementally: `timeline` holds the
  // accumulated (post-overlap) duration; each boundary fires at timeline − T,
  // then timeline grows by (next item duration − T).
  // Post-chain polish (auto mode) between the xfade chain's output and
  // [vout]. Order matters: grade → sharpen → vignette → grain → letterbox
  // bars → edge fades LAST (so the fade covers the bars too).
  const postOps = [];
  if (look) {
    postOps.push(...LOOKS[look]);
  } else if (colorPolish) {
    postOps.push('eq=contrast=1.05:saturation=1.12');
  }
  if (sharpen) {
    postOps.push('unsharp=5:5:0.6:5:5:0.0');
  }
  if (vignetteFx) {
    postOps.push('vignette=angle=PI/6');
  }
  if (grainFx) {
    postOps.push('noise=alls=5:allf=t');
  }
  if (letterbox) {
    // 2.39:1-style bars: 12% of frame height per side on landscape, a
    // lighter 7% on portrait (which is taller than any film ratio anyway).
    const barH = Math.round(H * (W > H ? 0.12 : 0.07));
    postOps.push(`drawbox=x=0:y=0:w=${W}:h=${barH}:color=black:t=fill`);
    postOps.push(`drawbox=x=0:y=${H - barH}:w=${W}:h=${barH}:color=black:t=fill`);
  }
  if (edgeFades) {
    postOps.push('fade=t=in:st=0:d=0.5');
    postOps.push(`fade=t=out:st=${Math.max(0, totalDuration - 1).toFixed(3)}:d=1`);
  }
  const chainOut = postOps.length > 0 ? 'vchain' : 'vout';

  const chosenTransitions = [];
  let vLabel = 'v0';
  let timeline = items[0].duration;
  for (let i = 1; i < items.length; i++) {
    const transition = pickRandom(transitionPool);
    chosenTransitions.push(transition);
    const offset = (timeline - T).toFixed(3);
    const outLabel = i === items.length - 1 ? chainOut : `vx${i}`;
    filters.push(
      `[${vLabel}][v${i}]xfade=transition=${transition}:duration=${T}:offset=${offset}[${outLabel}]`
    );
    timeline = timeline + items[i].duration - T;
    vLabel = outLabel;
  }
  if (items.length === 1) {
    filters.push(`[v0]null[${chainOut}]`);
  }
  if (postOps.length > 0) {
    filters.push(`[${chainOut}]${postOps.join(',')}[vout]`);
  }

  // ------------------------------------------------------------ audio graph
  const fadeStart = Math.max(0, totalDuration - AUDIO_FADE_OUT).toFixed(3);
  const dur = totalDuration.toFixed(3);
  let hasAudioOut = false;

  // Shared normalization for any audio stream entering the graph.
  const audioNorm = 'aresample=sample_rate=44100:async=1:first_pts=0,aformat=sample_fmts=fltp:channel_layouts=stereo';

  const activeVoice =
    voiceover && ((voiceover.mode === 'file' && voiceIndex >= 0) || voiceover.mode === 'tts');

  if (activeVoice) {
    // ---------------------------------------------------- narration modes
    let voiceLabel = null;
    if (voiceover.mode === 'file') {
      // One uploaded track narrates the whole video; scene durations were
      // already sized to fit it, so just normalize/pad/trim to total length.
      filters.push(
        `[${voiceIndex}:a]${audioNorm},apad,atrim=duration=${dur},asetpts=PTS-STARTPTS[avoice]`
      );
      voiceLabel = 'avoice';
    } else {
      // Per-scene TTS WAVs: segments of exactly each scene's duration
      // (silence for scenes without narration), joined with the same
      // acrossfade overlap as the video so A/V stay aligned.
      items.forEach((item, i) => {
        const d = item.duration.toFixed(3);
        if (item.voIndex >= 0) {
          filters.push(
            `[${item.voIndex}:a]${audioNorm},apad,atrim=duration=${d},asetpts=PTS-STARTPTS[a${i}]`
          );
        } else {
          filters.push(
            `anullsrc=channel_layout=stereo:sample_rate=44100,atrim=duration=${d},asetpts=PTS-STARTPTS[a${i}]`
          );
        }
      });
      let aLabel = 'a0';
      for (let i = 1; i < items.length; i++) {
        const outLabel = i === items.length - 1 ? 'avoice' : `ax${i}`;
        filters.push(`[${aLabel}][a${i}]acrossfade=d=${T}:c1=tri:c2=tri[${outLabel}]`);
        aLabel = outLabel;
      }
      if (items.length === 1) {
        filters.push('[a0]anull[avoice]');
      }
      voiceLabel = 'avoice';
    }

    if (musicPath) {
      // Music sits well under the voice (0.2); amix halves both, volume=2
      // restores voice to 1.0 and leaves music at the intended duck level.
      filters.push(
        `[${musicIndex}:a]${audioNorm},atrim=duration=${dur},asetpts=PTS-STARTPTS,` +
        `${musicFadeIn ? 'afade=t=in:st=0:d=1,' : ''}volume=${VOICE_MUSIC_DUCK}[amusic]`
      );
      filters.push(
        `[${voiceLabel}][amusic]amix=inputs=2:duration=first:dropout_transition=3,volume=2,` +
        `afade=t=out:st=${fadeStart}:d=${AUDIO_FADE_OUT}[aout]`
      );
    } else {
      filters.push(`[${voiceLabel}]afade=t=out:st=${fadeStart}:d=${AUDIO_FADE_OUT}[aout]`);
    }
    hasAudioOut = true;
  } else if (audioMode === 'merge') {
    // Per-item audio segments, each EXACTLY as long as its video item:
    //  - real audio: normalize → apad (extend if short) → atrim (cut to length)
    //  - images / silent videos: anullsrc silence of matching duration, so the
    //    audio timeline stays aligned with the video timeline.
    items.forEach((item, i) => {
      const d = item.duration.toFixed(3);
      if (item.hasAudio) {
        // Mirror the video's middle-window trim so A/V segments line up.
        const aTrimPrefix =
          item.trimStart > 0
            ? `atrim=start=${item.trimStart.toFixed(3)}:duration=${d},asetpts=PTS-STARTPTS,`
            : '';
        filters.push(
          `[${i}:a]${aTrimPrefix}${audioNorm},apad,atrim=duration=${d},asetpts=PTS-STARTPTS[a${i}]`
        );
      } else {
        filters.push(
          `anullsrc=channel_layout=stereo:sample_rate=44100,atrim=duration=${d},asetpts=PTS-STARTPTS[a${i}]`
        );
      }
    });

    // acrossfade with the SAME overlap T as the video xfades, so total audio
    // length equals total video length (no cumulative A/V drift).
    let aLabel = 'a0';
    for (let i = 1; i < items.length; i++) {
      const outLabel = i === items.length - 1 ? 'aclips' : `ax${i}`;
      filters.push(`[${aLabel}][a${i}]acrossfade=d=${T}:c1=tri:c2=tri[${outLabel}]`);
      aLabel = outLabel;
    }
    if (items.length === 1) {
      filters.push('[a0]anull[aclips]');
    }

    if (musicPath) {
      // Music ducked to 0.35 then amixed. amix halves each of its 2 inputs
      // (older ffmpeg has no normalize=0 option), so volume=2 afterwards
      // restores clip audio to 1.0 and leaves music at the intended 0.35.
      filters.push(
        `[${musicIndex}:a]${audioNorm},atrim=duration=${dur},asetpts=PTS-STARTPTS,` +
        `${musicFadeIn ? 'afade=t=in:st=0:d=1,' : ''}volume=${MUSIC_DUCK_VOLUME}[amusic]`
      );
      filters.push(
        `[aclips][amusic]amix=inputs=2:duration=first:dropout_transition=3,volume=2,` +
        `afade=t=out:st=${fadeStart}:d=${AUDIO_FADE_OUT}[aout]`
      );
    } else {
      filters.push(`[aclips]afade=t=out:st=${fadeStart}:d=${AUDIO_FADE_OUT}[aout]`);
    }
    hasAudioOut = true;
  } else {
    // Mute mode: the background track is the sole audio stream. With no music
    // available the output is simply video-only.
    if (musicPath) {
      filters.push(
        `[${musicIndex}:a]${audioNorm},atrim=duration=${dur},asetpts=PTS-STARTPTS,` +
        `${musicFadeIn ? 'afade=t=in:st=0:d=1,' : ''}` +
        `afade=t=out:st=${fadeStart}:d=${AUDIO_FADE_OUT}[aout]`
      );
      hasAudioOut = true;
    }
  }

  // ---------------------------------------------------------------- output
  const outputFile = path.join(outputDir, `${jobId}.mp4`);
  const outputOptions = [
    '-map', '[vout]',
    ...(hasAudioOut ? ['-map', '[aout]'] : []),
    '-c:v', 'libx264',
    '-preset', 'veryfast',
    '-crf', '22',
    '-pix_fmt', 'yuv420p',
    '-movflags', '+faststart',
    ...(hasAudioOut ? ['-c:a', 'aac', '-b:a', '192k', '-ar', '44100'] : []),
    // Hard stop at the computed duration — belt-and-braces against the looped
    // music input ever extending the file.
    '-t', dur,
  ];

  const totalFrames = Math.max(1, Math.round(totalDuration * FPS));

  await new Promise((resolve, reject) => {
    command
      .complexFilter(filters)
      .outputOptions(outputOptions)
      .output(outputFile)
      .on('start', (commandLine) => {
        console.log(`[job ${jobId}] ffmpeg started:\n${commandLine}`);
        onProgress(0, 'Rendering');
      })
      .on('progress', (progress) => {
        const frames = progress.frames || 0;
        // Clamp to 99 until the container is finalized (faststart remux etc.).
        const percent = Math.max(0, Math.min(99, Math.floor((frames / totalFrames) * 100)));
        onProgress(percent, 'Rendering');
      })
      .on('end', () => resolve())
      .on('error', (err, stdout, stderr) => {
        const tail = (stderr || '').split('\n').slice(-12).join('\n');
        reject(new Error(`FFmpeg failed: ${err.message}\n--- stderr tail ---\n${tail}`));
      })
      .run();
  });

  if (!fs.existsSync(outputFile) || fs.statSync(outputFile).size === 0) {
    throw new Error('FFmpeg reported success but the output file is missing or empty.');
  }

  onProgress(100, 'Complete');

  return {
    outputFile,
    fileName: `${jobId}.mp4`,
    duration: totalDuration,
    transitions: chosenTransitions,
    musicTrack: musicPath ? path.basename(musicPath) : null,
    warnings,
  };
}
