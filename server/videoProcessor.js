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
 * @param {string[]} options.files       Absolute media paths in upload order.
 * @param {'portrait'|'landscape'} options.layout Output geometry (1080x1920 / 1920x1080).
 * @param {'mute'|'merge'} options.audioMode 'mute' = music only; 'merge' = clip audio + ducked music.
 * @param {string}   options.title       Optional title; non-empty prepends a 3s drawtext slide.
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
    files,
    layout = 'landscape',
    audioMode = 'mute',
    title = '',
    outputDir,
    musicPath: presetMusicPath = null,
    audioDir,
    workDir,
    onProgress = () => {},
    onWarning = () => {},
  } = options;

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
  // Build the ordered item list. Images get a fixed 3s duration; videos are
  // probed for real duration and audio presence. Unreadable videos are skipped
  // with a warning rather than killing the job.
  const items = [];
  for (const filePath of files) {
    const ext = path.extname(filePath).toLowerCase();
    if (IMAGE_EXTS.has(ext)) {
      items.push({ type: 'image', path: filePath, duration: IMAGE_DURATION, hasAudio: false });
    } else if (VIDEO_EXTS.has(ext)) {
      try {
        const meta = await probeMedia(filePath);
        if (!meta.duration || meta.duration < 0.2) {
          throw new Error('no usable duration');
        }
        items.push({ type: 'video', path: filePath, duration: meta.duration, hasAudio: meta.hasAudio });
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
  const T = items.length > 1 ? Math.min(TRANSITION_DURATION, Math.max(0.1, minDuration / 2 - 0.05)) : 0;
  if (items.length > 1 && T < TRANSITION_DURATION) {
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
    } else if (item.type === 'image') {
      // -loop 1 -t 3 turns the still into an exactly-3s video stream.
      command.input(item.path).inputOptions(['-loop', '1', '-t', String(item.duration)]);
    } else {
      command.input(item.path);
    }
  });

  let musicIndex = -1;
  if (musicPath) {
    musicIndex = items.length;
    // -stream_loop -1 repeats the track forever; atrim below cuts it to length.
    command.input(musicPath).inputOptions(['-stream_loop', '-1']);
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
    let chain = `[${i}:v]`;
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
  const chosenTransitions = [];
  let vLabel = 'v0';
  let timeline = items[0].duration;
  for (let i = 1; i < items.length; i++) {
    const transition = pickRandom(TRANSITIONS);
    chosenTransitions.push(transition);
    const offset = (timeline - T).toFixed(3);
    const outLabel = i === items.length - 1 ? 'vout' : `vx${i}`;
    filters.push(
      `[${vLabel}][v${i}]xfade=transition=${transition}:duration=${T}:offset=${offset}[${outLabel}]`
    );
    timeline = timeline + items[i].duration - T;
    vLabel = outLabel;
  }
  if (items.length === 1) {
    filters.push('[v0]null[vout]');
  }

  // ------------------------------------------------------------ audio graph
  const fadeStart = Math.max(0, totalDuration - AUDIO_FADE_OUT).toFixed(3);
  const dur = totalDuration.toFixed(3);
  let hasAudioOut = false;

  // Shared normalization for any audio stream entering the graph.
  const audioNorm = 'aresample=sample_rate=44100:async=1:first_pts=0,aformat=sample_fmts=fltp:channel_layouts=stereo';

  if (audioMode === 'merge') {
    // Per-item audio segments, each EXACTLY as long as its video item:
    //  - real audio: normalize → apad (extend if short) → atrim (cut to length)
    //  - images / silent videos: anullsrc silence of matching duration, so the
    //    audio timeline stays aligned with the video timeline.
    items.forEach((item, i) => {
      const d = item.duration.toFixed(3);
      if (item.hasAudio) {
        filters.push(
          `[${i}:a]${audioNorm},apad,atrim=duration=${d},asetpts=PTS-STARTPTS[a${i}]`
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
        `[${musicIndex}:a]${audioNorm},atrim=duration=${dur},asetpts=PTS-STARTPTS,volume=${MUSIC_DUCK_VOLUME}[amusic]`
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
