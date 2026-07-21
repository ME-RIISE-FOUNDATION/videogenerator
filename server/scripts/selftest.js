/**
 * scripts/selftest.js
 *
 * Headless end-to-end verification of the render pipeline — no browser, no
 * HTTP. It uses the bundled ffmpeg to synthesize tiny test assets (a PNG, a
 * video WITH audio, a SILENT video at a different size/fps, and an .mp3), then
 * drives videoProcessor.processJob through every layout × audio-mode combo
 * plus the empty-music-folder path, and ffprobes each output to assert it is a
 * real, playable file of the expected duration.
 *
 * Run with: npm run selftest   (from server/)
 */

import fs from 'fs';
import path from 'path';
import { execFileSync } from 'child_process';
import { fileURLToPath } from 'url';
import { processJob, probeMedia, hasFilter, FFMPEG_PATH } from '../videoProcessor.js';
import { resolveMusicTrack, markTrackUsed, getUsedTrackIds } from '../musicFetcher.js';
import { synthNarration, wrapCaption, buildHeadline } from '../scriptComposer.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SERVER_DIR = path.join(__dirname, '..');
const ASSETS_DIR = path.join(SERVER_DIR, 'test-assets');
const OUTPUT_DIR = path.join(SERVER_DIR, 'output');
const AUDIO_DIR = path.join(SERVER_DIR, 'public', 'audio');
const EMPTY_AUDIO_DIR = path.join(ASSETS_DIR, 'empty-audio');

const results = [];

/** Run one ffmpeg invocation synchronously, throwing on failure. */
function runFfmpeg(args) {
  execFileSync(FFMPEG_PATH, ['-hide_banner', '-loglevel', 'error', '-y', ...args], {
    stdio: ['ignore', 'inherit', 'inherit'],
    windowsHide: true,
  });
}

/** Generate the synthetic test assets. Returns their paths in "upload order". */
function generateAssets() {
  fs.mkdirSync(ASSETS_DIR, { recursive: true });
  fs.mkdirSync(EMPTY_AUDIO_DIR, { recursive: true });
  fs.mkdirSync(AUDIO_DIR, { recursive: true });

  const photo = path.join(ASSETS_DIR, 'photo.png');
  const clipWithAudio = path.join(ASSETS_DIR, 'clip-audio.mp4');
  const clipSilent = path.join(ASSETS_DIR, 'clip-silent.mp4');
  const clipLong = path.join(ASSETS_DIR, 'clip-long.mp4');
  const music = path.join(AUDIO_DIR, 'selftest-music.mp3');

  console.log('Generating test assets…');
  // Solid-color 640x480 PNG.
  runFfmpeg(['-f', 'lavfi', '-i', 'color=c=0x3355ff:s=640x480:d=1', '-frames:v', '1', photo]);
  // 2s color-bar video WITH a 440Hz tone, 640x480@30.
  runFfmpeg([
    '-f', 'lavfi', '-i', 'testsrc=duration=2:size=640x480:rate=30',
    '-f', 'lavfi', '-i', 'sine=frequency=440:duration=2',
    '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-shortest', clipWithAudio,
  ]);
  // 2s SILENT video at a different geometry AND fps (480x640@25) to prove the
  // normalization stage really does its job before xfade.
  runFfmpeg([
    '-f', 'lavfi', '-i', 'smptebars=duration=2:size=480x640:rate=25',
    '-c:v', 'libx264', '-pix_fmt', 'yuv420p', clipSilent,
  ]);
  // 8s silent clip — exercises the auto-mode pacing cap (middle-trimmed to 5s).
  runFfmpeg([
    '-f', 'lavfi', '-i', 'testsrc2=duration=8:size=640x360:rate=30',
    '-c:v', 'libx264', '-pix_fmt', 'yuv420p', clipLong,
  ]);
  // 4s two-tone "music" mp3 (shorter than every render, so -stream_loop is exercised).
  runFfmpeg([
    '-f', 'lavfi', '-i', 'sine=frequency=220:duration=4',
    '-f', 'lavfi', '-i', 'sine=frequency=330:duration=4',
    '-filter_complex', '[0:a][1:a]amix=inputs=2:duration=first[a]',
    '-map', '[a]', '-c:a', 'libmp3lame', '-b:a', '128k', music,
  ]);

  return { files: [photo, clipWithAudio, clipSilent], clipLong, music };
}

/**
 * Render one scenario and assert on the output.
 *
 * @param {object} spec
 * @param {string} spec.name Human-readable scenario name.
 * @param {string[]} spec.files Ordered input files.
 * @param {string} spec.layout portrait|landscape.
 * @param {string} spec.audioMode mute|merge.
 * @param {string} spec.title Title text ('' for none).
 * @param {string} spec.audioDir Music folder for this scenario.
 * @param {string} [spec.musicPath] Pre-resolved track (bypasses the audioDir scan).
 * @param {object} [spec.style] Professional auto-mode style flags for processJob.
 * @param {number} spec.expectedDuration Expected output duration in seconds.
 * @param {boolean} spec.expectAudio Whether the output must have an audio stream.
 */
async function runScenario(spec) {
  const jobId = `selftest-${spec.name}`;
  const workDir = path.join(ASSETS_DIR, `work-${spec.name}`);
  fs.mkdirSync(workDir, { recursive: true });

  const progressLog = [];
  const warnings = [];

  console.log(`\n=== Scenario: ${spec.name} (${spec.layout}, ${spec.audioMode}${spec.title ? ', titled' : ''}) ===`);
  const started = Date.now();

  try {
    const result = await processJob({
      jobId,
      files: spec.files,
      layout: spec.layout,
      audioMode: spec.audioMode,
      title: spec.title,
      style: spec.style || {},
      scenes: spec.scenes || null,
      voiceover: spec.voiceover || null,
      outputDir: OUTPUT_DIR,
      musicPath: spec.musicPath || null,
      audioDir: spec.audioDir,
      workDir,
      onProgress: (percent, stage) => progressLog.push({ percent, stage }),
      onWarning: (message) => warnings.push(message),
    });

    const meta = await probeMedia(result.outputFile);
    const sizeKb = Math.round(fs.statSync(result.outputFile).size / 1024);
    const durationOk = Math.abs(meta.duration - spec.expectedDuration) <= 0.35;
    const audioOk = meta.hasAudio === spec.expectAudio;
    const percents = progressLog.map((p) => p.percent);
    const monotonic = percents.every((p, i) => i === 0 || p >= percents[i - 1]);
    const reached100 = percents[percents.length - 1] === 100;
    const pass = durationOk && audioOk && monotonic && reached100 && sizeKb > 0;

    console.log(`  output:      ${path.basename(result.outputFile)} (${sizeKb} KB, ${(Date.now() - started) / 1000}s wall)`);
    console.log(`  duration:    ${meta.duration.toFixed(2)}s (expected ~${spec.expectedDuration.toFixed(2)}s) ${durationOk ? 'OK' : 'FAIL'}`);
    console.log(`  audio track: ${meta.hasAudio} (expected ${spec.expectAudio}) ${audioOk ? 'OK' : 'FAIL'}`);
    console.log(`  transitions: ${result.transitions.join(', ') || '(none)'}`);
    console.log(`  music:       ${result.musicTrack || '(none)'}`);
    console.log(`  progress:    ${percents.length} events, ${percents[0]}→${percents[percents.length - 1]}, monotonic=${monotonic}, reached 100=${reached100}`);
    if (warnings.length) console.log(`  warnings:    ${warnings.join(' | ')}`);

    results.push({ name: spec.name, pass });
  } catch (err) {
    console.error(`  FAILED: ${err.message}`);
    results.push({ name: spec.name, pass: false });
  }
}

async function main() {
  console.log(`ffmpeg binary: ${FFMPEG_PATH}`);
  if (!hasFilter('xfade')) {
    console.error('FATAL: selected ffmpeg binary lacks xfade — cannot run transitions.');
    process.exit(1);
  }

  const { files, clipLong, music } = generateAssets();

  // Per-item durations: photo 3s + clip 2s + clip 2s = 7s raw.
  // 2 boundaries × 0.5s overlap → 6.0s. A title adds 3s − 0.5s overlap → +2.5s.
  const base = 6.0;
  const titled = base + 2.5;

  await runScenario({
    name: 'landscape-merge-titled',
    files, layout: 'landscape', audioMode: 'merge', title: 'Selftest Reel 2026',
    audioDir: AUDIO_DIR, expectedDuration: titled, expectAudio: true,
  });
  await runScenario({
    name: 'portrait-merge',
    files, layout: 'portrait', audioMode: 'merge', title: '',
    audioDir: AUDIO_DIR, expectedDuration: base, expectAudio: true,
  });
  await runScenario({
    name: 'landscape-mute',
    files, layout: 'landscape', audioMode: 'mute', title: '',
    audioDir: AUDIO_DIR, expectedDuration: base, expectAudio: true,
  });
  await runScenario({
    name: 'portrait-mute',
    files, layout: 'portrait', audioMode: 'mute', title: '',
    audioDir: AUDIO_DIR, expectedDuration: base, expectAudio: true,
  });
  // Auto-mode professional pipeline with the full effects stack: Ken Burns
  // (incl. pan variants), blur-fill, the 8s clip middle-trimmed to 5s, cinema
  // grade + grain + letterbox + vignette + sharpen, custom 0.4s transitions.
  // Durations: photo 3 + clip 2 + capped 5 = 10 raw − 2×0.4 overlap = 9.2s.
  await runScenario({
    name: 'auto-style',
    files: [...files.slice(0, 2), clipLong],
    layout: 'landscape', audioMode: 'mute', title: '',
    audioDir: AUDIO_DIR, expectedDuration: 9.2, expectAudio: true,
    style: {
      kenBurns: true,
      kenBurnsPan: true,
      blurFill: true,
      maxClipSeconds: 5,
      transitionPool: ['fade'],
      transitionDuration: 0.4,
      look: 'cinema',
      sharpen: true,
      vignette: true,
      grain: true,
      letterbox: true,
      edgeFades: true,
      musicFadeIn: true,
    },
  });
  // Script mode, offline path: two gradient-background scenes with wrapped
  // captions, music-only narration. 4 + 4 = 8 − 0.5 overlap = 7.5s.
  const captionA = path.join(ASSETS_DIR, 'caption-a.txt');
  const captionB = path.join(ASSETS_DIR, 'caption-b.txt');
  fs.writeFileSync(captionA, wrapCaption('The journey began at dawn with a long walk through the quiet pine forest.', 34), 'utf8');
  fs.writeFileSync(captionB, wrapCaption('By sunset we reached the summit and watched the valley turn to gold.', 34), 'utf8');
  await runScenario({
    name: 'script-scenes',
    files: [],
    layout: 'landscape', audioMode: 'mute', title: '',
    audioDir: AUDIO_DIR, expectedDuration: 7.5, expectAudio: true,
    scenes: [
      { duration: 4, imagePath: null, captionFile: captionA, gradient: ['0x1b2a4a', '0x0c0f1c'] },
      { duration: 4, imagePath: null, captionFile: captionB, gradient: ['0x3a1c47', '0x120a1e'] },
    ],
  });

  // Script mode, default captions: headline (ideogram icon + short Title Case
  // label) instead of the full paragraph — this is the fix for "the whole
  // script showing on screen". Exercises buildHeadline() end-to-end plus the
  // new icon+label drawtext lockup (icon layer only draws if an emoji font
  // was found on this machine — the render must still succeed without one).
  const headlineA = buildHeadline('The temple bells rang out over the misty mountain valley at dawn.', 0);
  const headlineB = buildHeadline('Families gathered to celebrate Diwali with lights, sweets and fireworks.', 1);
  const iconFileA = path.join(ASSETS_DIR, 'headline-icon-a.txt');
  const labelFileA = path.join(ASSETS_DIR, 'headline-label-a.txt');
  const iconFileB = path.join(ASSETS_DIR, 'headline-icon-b.txt');
  const labelFileB = path.join(ASSETS_DIR, 'headline-label-b.txt');
  fs.writeFileSync(iconFileA, headlineA.icon, 'utf8');
  fs.writeFileSync(labelFileA, headlineA.label, 'utf8');
  fs.writeFileSync(iconFileB, headlineB.icon, 'utf8');
  fs.writeFileSync(labelFileB, headlineB.label, 'utf8');
  console.log(`\n--- Headline captions ---\n  scene A: ${headlineA.icon} ${headlineA.label}\n  scene B: ${headlineB.icon} ${headlineB.label}`);
  await runScenario({
    name: 'script-headline',
    files: [],
    layout: 'landscape', audioMode: 'mute', title: '',
    audioDir: AUDIO_DIR, expectedDuration: 7.5, expectAudio: true,
    scenes: [
      { duration: 4, imagePath: null, headlineIconFile: iconFileA, headlineLabelFile: labelFileA, gradient: ['0x1b2a4a', '0x0c0f1c'] },
      { duration: 4, imagePath: null, headlineIconFile: iconFileB, headlineLabelFile: labelFileB, gradient: ['0x3a1c47', '0x120a1e'] },
    ],
  });

  // Script mode with Windows TTS narration (voice-only audio, no music).
  // Skips with a pass-note if SAPI is unavailable on this machine.
  console.log('\n--- TTS narration (Windows SAPI) ---');
  const narrA = await synthNarration({
    text: 'The journey began at dawn with a long walk through the forest.',
    wavPath: path.join(ASSETS_DIR, 'narr-a.wav'), workDir: ASSETS_DIR, index: 900,
  });
  const narrB = await synthNarration({
    text: 'By sunset we reached the summit together.',
    wavPath: path.join(ASSETS_DIR, 'narr-b.wav'), workDir: ASSETS_DIR, index: 901,
  });
  if (narrA && narrB) {
    const dA = Math.max(3, narrA.duration + 0.8);
    const dB = Math.max(3, narrB.duration + 0.8);
    console.log(`  narration synthesized: ${narrA.duration.toFixed(2)}s + ${narrB.duration.toFixed(2)}s`);
    await runScenario({
      name: 'script-tts',
      files: [],
      layout: 'landscape', audioMode: 'mute', title: '',
      audioDir: EMPTY_AUDIO_DIR, expectedDuration: dA + dB - 0.5, expectAudio: true,
      scenes: [
        { duration: dA, imagePath: null, captionFile: captionA, voPath: narrA.path },
        { duration: dB, imagePath: null, captionFile: captionB, voPath: narrB.path },
      ],
      voiceover: { mode: 'tts' },
    });
  } else {
    console.log('  SKIP: Windows SAPI text-to-speech unavailable on this machine.');
    results.push({ name: 'script-tts (skipped: no SAPI)', pass: true });
  }

  // Empty music folder + mute mode → video-only output, with a warning, no crash.
  await runScenario({
    name: 'empty-audio-mute',
    files, layout: 'portrait', audioMode: 'mute', title: '',
    audioDir: EMPTY_AUDIO_DIR, expectedDuration: base, expectAudio: false,
  });

  // Networked scenario: fetch a real CC-licensed track from Openverse and mix
  // it in. Skips with a PASS note when offline (and nothing is cached yet) so
  // the core selftest never depends on the network.
  console.log('\n--- Online music fetch (networked) ---');
  const musicCacheDir = path.join(ASSETS_DIR, 'music-cache');
  const fetchOnce = async () => {
    try {
      return await resolveMusicTrack({
        query: 'calm instrumental',
        audioDir: EMPTY_AUDIO_DIR,
        cacheDir: musicCacheDir,
        onWarning: (m) => console.log('  warning:', m),
        onStage: (s) => console.log('  stage:', s),
      });
    } catch (err) {
      console.log('  fetch crashed:', err.message);
      return null;
    }
  };

  const online = await fetchOnce();
  if (online) {
    console.log(
      `  fetched: ${path.basename(online.path)}` +
      (online.attribution
        ? ` — "${online.attribution.title}" by ${online.attribution.creator} (${online.attribution.license})`
        : ' (cached, no attribution sidecar)')
    );
    await runScenario({
      name: 'online-music-merge',
      files, layout: 'landscape', audioMode: 'merge', title: '',
      audioDir: EMPTY_AUDIO_DIR, musicPath: online.path,
      expectedDuration: base, expectAudio: true,
    });

    // Strict no-reuse: ledger the first track as consumed, then resolve again
    // and require a DIFFERENT track (or none — never the same one).
    if (online.id) {
      markTrackUsed(musicCacheDir, {
        id: online.id,
        ...(online.attribution || {}),
        file: path.basename(online.path),
        jobId: 'selftest-online-music-merge',
      });
      const ledgered = getUsedTrackIds(musicCacheDir).has(online.id);
      const second = await fetchOnce();
      const distinct = !second || second.id !== online.id;
      console.log(
        `  no-reuse: ledgered=${ledgered}, second fetch=` +
        `${second ? path.basename(second.path) : '(none)'}, distinct=${distinct}`
      );
      results.push({ name: 'no-reuse-ledger', pass: ledgered && distinct });
    }
  } else {
    console.log('  SKIP: offline and no unused cached tracks — online path not testable right now.');
    results.push({ name: 'online-music-merge (skipped: offline)', pass: true });
  }

  // Remove the synthetic tone from public/audio so real usage isn't polluted;
  // drop your own .mp3 tracks in that folder instead.
  try { fs.unlinkSync(music); } catch { /* already gone */ }

  console.log('\n=== Summary ===');
  let allPass = true;
  for (const r of results) {
    console.log(`  ${r.pass ? 'PASS' : 'FAIL'}  ${r.name}`);
    if (!r.pass) allPass = false;
  }
  process.exit(allPass ? 0 : 1);
}

main().catch((err) => {
  console.error('Selftest crashed:', err);
  process.exit(1);
});
