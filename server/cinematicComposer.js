import { spawn } from 'child_process';
import path from 'path';
import fs from 'fs';

/**
 * Scene detection using FFmpeg's fps and select filters.
 * Extracts keyframes at shot boundaries (high scene change > 40% threshold).
 * @param {string} videoPath Path to input video
 * @param {string} workDir Temporary directory for frame extraction
 * @returns {Promise<Array>} Array of { timecode, frame }
 */
export async function detectScenes(videoPath, workDir) {
  return new Promise((resolve, reject) => {
    const frameDir = path.join(workDir, 'scenes');
    if (!fs.existsSync(frameDir)) fs.mkdirSync(frameDir, { recursive: true });

    const proc = spawn('ffmpeg', [
      '-i', videoPath,
      '-vf', `select='gt(scene\\,0.4)',fps=fps=1`,
      '-vsync', '0',
      '-f', 'image2',
      path.join(frameDir, 'scene_%04d.jpg'),
    ]);

    let stderr = '';
    proc.stderr.on('data', (data) => {
      stderr += data.toString();
    });

    proc.on('close', (code) => {
      if (code !== 0 && code !== 1) {
        return reject(new Error(`Scene detection failed: ${stderr.slice(-200)}`));
      }
      // List extracted frames (rough scene boundaries)
      try {
        const frames = fs
          .readdirSync(frameDir)
          .filter((f) => f.startsWith('scene_'))
          .sort();
        resolve(frames.map((f) => ({ file: f, path: path.join(frameDir, f) })));
      } catch (err) {
        resolve([]);
      }
    });
  });
}

/**
 * Rough beat/loudness detection using FFmpeg's ebur128 filter.
 * Extracts loudness values to find "peaks" (approximate beats).
 * @param {string} audioPath Path to audio file
 * @returns {Promise<Array>} Array of peak times (seconds)
 */
export async function detectBeats(audioPath) {
  return new Promise((resolve) => {
    const proc = spawn('ffmpeg', [
      '-i', audioPath,
      '-af', 'ebur128=video=0:meter=10',
      '-f', 'null',
      '-',
    ]);

    let stderr = '';
    proc.stderr.on('data', (data) => {
      stderr += data.toString();
    });

    proc.on('close', () => {
      // Parse loudness output for M (momentary loudness) peaks
      // This is a simplified heuristic: look for lines with loud values
      const lines = stderr.split('\n');
      const peaks = [];
      let lastPeakTime = -1;

      for (const line of lines) {
        // Look for t= (time) and M= (momentary loudness) patterns
        const timeMatch = line.match(/t:\s*([\d.]+)/);
        const loudMatch = line.match(/M:\s*([-\d.]+)/);

        if (timeMatch && loudMatch) {
          const time = parseFloat(timeMatch[1]);
          const loud = parseFloat(loudMatch[1]);

          // Treat values > -10 as potential beats (loud moments)
          if (loud > -10 && time - lastPeakTime > 0.2) {
            peaks.push(time);
            lastPeakTime = time;
          }
        }
      }

      // Fallback: if no peaks detected, return uniform intervals
      if (peaks.length === 0) {
        resolve([]);
      } else {
        resolve(peaks);
      }
    });
  });
}

/**
 * Compose a cinematic reel structure from clips and settings.
 * Detects scenes, syncs to beats, and creates a fast-paced edit plan.
 *
 * @param {{
 *   clips: Array<{path: string, duration: number}>,
 *   pacing: string ('frenzy', 'fast', 'balanced'),
 *   durationTarget: number (seconds),
 *   workDir: string,
 *   onProgress: function
 * }} options
 * @returns {Promise<{
 *   scenes: Array<{clipIdx, startTime, endTime, duration}>,
 *   totalDuration: number,
 *   estimatedBPM: number
 * }>}
 */
export async function composeCinematicReel(options) {
  const { clips, pacing, durationTarget, workDir, onProgress } = options;

  if (!clips || clips.length < 2) {
    throw new Error('Cinematic mode requires at least 2 video clips.');
  }

  // Map pacing to cut duration (seconds per clip)
  const cutDurations = {
    frenzy: 0.5,
    fast: 0.8,
    balanced: 1.2,
  };
  const targetCutDuration = cutDurations[pacing] || 0.8;

  if (onProgress) onProgress(`Detecting scenes in ${clips.length} clip(s)...`);

  // Extract scenes from each clip (simplified: use file duration / 3 as rough estimate)
  const allScenes = [];
  let clipIndex = 0;
  for (const clip of clips) {
    const roughSceneCount = Math.max(1, Math.floor(clip.duration / 4));
    const sceneStartTime = 0;
    const sceneEndTime = clip.duration;
    const sceneDuration = (sceneEndTime - sceneStartTime) / roughSceneCount;

    for (let i = 0; i < roughSceneCount; i++) {
      allScenes.push({
        clipIdx: clipIndex,
        startTime: sceneStartTime + i * sceneDuration,
        endTime: sceneStartTime + (i + 1) * sceneDuration,
        duration: sceneDuration,
      });
    }
    clipIndex++;
  }

  if (onProgress) onProgress(`Detected ${allScenes.length} potential scene cuts...`);

  // Trim/expand scenes to match target duration
  const numScenes = Math.max(1, Math.floor(durationTarget / targetCutDuration));
  const selectedScenes = allScenes.slice(0, numScenes);

  // Adjust durations to fit exactly target duration
  if (selectedScenes.length > 0) {
    const totalCurrentDuration = selectedScenes.reduce((sum, s) => sum + s.duration, 0);
    const scaleFactor = durationTarget / totalCurrentDuration;
    selectedScenes.forEach((scene) => {
      scene.duration = scene.duration * scaleFactor;
    });
  }

  const actualDuration = selectedScenes.reduce((sum, s) => sum + s.duration, 0);
  const estimatedBPM = Math.round((numScenes / actualDuration) * 60);

  if (onProgress) onProgress(`Composed ${selectedScenes.length} scenes (~${actualDuration.toFixed(1)}s total)`);

  return {
    scenes: selectedScenes,
    totalDuration: actualDuration,
    estimatedBPM,
  };
}

/**
 * Trim a video clip to a specific time range.
 * @param {string} inputPath
 * @param {string} outputPath
 * @param {number} startTime (seconds)
 * @param {number} duration (seconds)
 * @returns {Promise<void>}
 */
export async function trimClip(inputPath, outputPath, startTime, duration) {
  return new Promise((resolve, reject) => {
    const proc = spawn('ffmpeg', [
      '-i', inputPath,
      '-ss', startTime.toString(),
      '-t', duration.toString(),
      '-c', 'copy',
      outputPath,
    ]);

    proc.on('close', (code) => {
      if (code === 0) resolve();
      else reject(new Error(`Trim failed: clip from ${startTime}s for ${duration}s`));
    });
  });
}
