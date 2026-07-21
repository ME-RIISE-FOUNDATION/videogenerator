/**
 * scriptComposer.js
 *
 * Turns a written script into renderable scenes for the Script → Video mode:
 *   - parseScript:      paragraphs → scenes (+ optional title line)
 *   - extractKeywords:  naive keyword pick per scene for image search
 *   - fetchSceneImage:  key-free Openverse IMAGES API → downloaded CC visual
 *                       (each carries attribution, like the music)
 *   - synthNarration:   Windows SAPI text-to-speech via PowerShell → WAV
 *   - wrapCaption:      JS word-wrap (drawtext renders \n but never wraps)
 *
 * Every network / TTS failure degrades gracefully (null return → caller
 * falls back to gradient backgrounds / music-only narration).
 */

import fs from 'fs';
import path from 'path';
import { execFileSync } from 'child_process';
import { pipeline } from 'stream/promises';
import { Readable } from 'stream';
import { probeMedia } from './videoProcessor.js';

const OPENVERSE_IMAGES_API = 'https://api.openverse.org/v1/images/';
const USER_AGENT = 'highlight-reel-studio/1.0 (local desktop app)';
const SEARCH_TIMEOUT_MS = 8_000;
const DOWNLOAD_TIMEOUT_MS = 30_000;
const MAX_SCENES = 20;
const WORDS_PER_SECOND = 2.5; // reading-speed pacing for music-only mode
const MIN_SCENE_SECONDS = 3.5;
const MAX_SCENE_SECONDS = 8;

const STOPWORDS = new Set([
  'the', 'and', 'for', 'are', 'but', 'not', 'you', 'all', 'any', 'can', 'her',
  'was', 'one', 'our', 'out', 'day', 'get', 'has', 'him', 'his', 'how', 'man',
  'new', 'now', 'old', 'see', 'two', 'way', 'who', 'boy', 'did', 'its', 'let',
  'she', 'too', 'use', 'that', 'with', 'have', 'this', 'will', 'your', 'from',
  'they', 'know', 'want', 'been', 'good', 'much', 'some', 'time', 'very',
  'when', 'come', 'here', 'just', 'like', 'long', 'make', 'many', 'more',
  'only', 'over', 'such', 'take', 'than', 'them', 'well', 'were', 'what',
  'about', 'there', 'their', 'would', 'these', 'other', 'into', 'could',
  'because', 'every', 'always', 'where', 'which', 'while', 'after', 'before',
]);

/**
 * Split a raw script into a title (optional) and scene paragraphs.
 *
 * Rules: blank-line-separated paragraphs are scenes. A short single-line
 * first paragraph (≤ 8 words, ≤ 60 chars) is treated as the video title.
 * A script with no blank lines is chunked into sentence groups of ≤ 25 words.
 * Scene count is capped at 20.
 *
 * @param {string} raw The script text.
 * @returns {{title: string, scenes: Array<{text: string, words: number}>, capped: boolean}}
 */
export function parseScript(raw) {
  const paragraphs = String(raw || '')
    .split(/\r?\n\s*\r?\n/)
    .map((p) => p.replace(/\s+/g, ' ').trim())
    .filter(Boolean);

  let title = '';
  if (
    paragraphs.length > 1 &&
    paragraphs[0].length <= 60 &&
    paragraphs[0].split(' ').length <= 8 &&
    !/[.!?]$/.test(paragraphs[0])
  ) {
    title = paragraphs.shift();
  }

  let sceneTexts = paragraphs;
  if (sceneTexts.length === 1) {
    // No paragraph structure — group sentences into ≤ 25-word chunks.
    const sentences = sceneTexts[0].match(/[^.!?]+[.!?]*/g) || [sceneTexts[0]];
    const chunks = [];
    let current = '';
    for (const sentence of sentences) {
      const candidate = `${current} ${sentence}`.trim();
      if (current && candidate.split(' ').length > 25) {
        chunks.push(current);
        current = sentence.trim();
      } else {
        current = candidate;
      }
    }
    if (current) chunks.push(current);
    sceneTexts = chunks;
  }

  const capped = sceneTexts.length > MAX_SCENES;
  return {
    title,
    capped,
    scenes: sceneTexts.slice(0, MAX_SCENES).map((text) => ({
      text,
      words: text.split(' ').length,
    })),
  };
}

/** Keyword → ideogram map for scene headlines (India-aware). */
const EMOJI_MAP = {
  temple: '🛕', mosque: '🕌', church: '⛪', palace: '🏰', fort: '🏯', taj: '🕌',
  diwali: '🪔', festival: '🎉', celebration: '🎊', wedding: '💍', dance: '💃',
  yoga: '🧘', meditation: '🧘', cricket: '🏏', music: '🎵', drum: '🥁',
  mountain: '⛰', mountains: '🏔', himalaya: '🏔', hill: '⛰', peak: '🏔',
  summit: '🏔', valley: '🏞', river: '🏞', ganges: '🌊', lake: '🌊',
  ocean: '🌊', beach: '🏖', island: '🏝', waterfall: '💦', monsoon: '🌧',
  rain: '🌧', storm: '⛈', cloud: '☁', clouds: '☁', sunrise: '🌅',
  sunset: '🌇', morning: '🌄', night: '🌙', star: '⭐', stars: '✨',
  forest: '🌲', tree: '🌳', trees: '🌳', pine: '🌲', jungle: '🌴',
  garden: '🌷', flower: '🌸', flowers: '💐', lotus: '🪷', spring: '🌱',
  summer: '☀', winter: '❄', snow: '❄', desert: '🏜', camel: '🐪',
  tiger: '🐅', elephant: '🐘', peacock: '🦚', bird: '🐦', cow: '🐄',
  monkey: '🐒', fish: '🐟', road: '🛣', journey: '🧭', travel: '✈',
  trip: '🧳', walk: '🚶', hike: '🥾', hiking: '🥾', train: '🚂',
  railway: '🚉', boat: '⛵', ship: '🚢', rickshaw: '🛺', cycle: '🚲',
  market: '🛍', bazaar: '🏪', city: '🏙', village: '🛖', home: '🏡',
  house: '🏠', school: '🏫', office: '🏢', food: '🍛', curry: '🍛',
  spice: '🌶', spices: '🌶', chai: '🍵', tea: '🍵', coffee: '☕',
  sweet: '🍬', mango: '🥭', rice: '🍚', bread: '🫓', dinner: '🍽',
  breakfast: '🍳', family: '👪', friends: '🤝', love: '❤', heart: '❤',
  child: '🧒', children: '🧒', baby: '👶', mother: '🤱', team: '🤝',
  work: '💼', business: '📈', money: '💰', success: '🏆', victory: '🏆',
  award: '🥇', book: '📖', story: '📖', history: '📜', ancient: '🏛',
  culture: '🎭', light: '💡', fire: '🔥', water: '💧', earth: '🌍',
  world: '🌍', india: '🛕', peace: '🕊', dream: '💭', time: '⏳',
  camera: '📷', photo: '📸', video: '🎬', game: '🎮', sport: '⚽',
};

/** Rotating fallback ideograms when no keyword matches. */
const FALLBACK_ICONS = ['✨', '🌟', '🎬', '📍', '💫', '🌅'];

/**
 * Build a short headline overlay for a scene: 2–3 leading keywords in Title
 * Case plus a matched ideogram (emoji) icon. The label is guaranteed to be
 * plain letters/spaces, so it needs no filter-graph escaping.
 *
 * @param {string} text Scene text.
 * @param {number} [sceneIndex] Used to rotate fallback icons.
 * @returns {{icon: string, label: string}} Ideogram + short label.
 */
export function buildHeadline(text, sceneIndex = 0) {
  const all = (text.toLowerCase().match(/[a-z]{4,}/g) || []).filter((w) => !STOPWORDS.has(w));
  const seen = new Set();
  const leading = [];
  for (const word of all) {
    if (!seen.has(word)) {
      seen.add(word);
      leading.push(word);
      if (leading.length === 3) break;
    }
  }
  const label =
    leading.map((w) => w[0].toUpperCase() + w.slice(1)).join(' ') || `Scene ${sceneIndex + 1}`;
  let icon = null;
  for (const word of all) {
    if (EMOJI_MAP[word]) {
      icon = EMOJI_MAP[word];
      break;
    }
  }
  if (!icon) icon = FALLBACK_ICONS[sceneIndex % FALLBACK_ICONS.length];
  return { icon, label };
}

/**
 * Reading-time duration for a scene (music-only narration mode).
 *
 * @param {number} words Word count of the scene.
 * @returns {number} Seconds, clamped to 3.5–8.
 */
export function readingDuration(words) {
  return Math.min(MAX_SCENE_SECONDS, Math.max(MIN_SCENE_SECONDS, words / WORDS_PER_SECOND));
}

/**
 * Pick up to three search keywords from scene text: stopwords out, longest
 * distinct words win, original casing dropped.
 *
 * @param {string} text Scene text.
 * @returns {string} Space-joined keyword query (never empty for real text).
 */
export function extractKeywords(text) {
  const words = (text.toLowerCase().match(/[a-z]{4,}/g) || []).filter((w) => !STOPWORDS.has(w));
  const unique = [...new Set(words)].sort((a, b) => b.length - a.length).slice(0, 3);
  if (unique.length > 0) return unique.join(' ');
  return (text.toLowerCase().match(/[a-z]+/g) || ['abstract']).slice(0, 3).join(' ');
}

const STYLE_CATEGORIES = {
  photo: 'photograph',
  illustration: 'illustration',
  artwork: 'digitized_artwork',
};

/**
 * Search one Openverse images query/category combination.
 *
 * @param {string} q Query string.
 * @param {string|null} category Openverse category filter, or null for none.
 * @returns {Promise<Array<object>>} Candidates with a usable `url` (empty on
 *   no results or any request failure — never throws).
 */
async function searchOpenverseImages(q, category) {
  try {
    const params = new URLSearchParams({ q, license_type: 'commercial', page_size: '20' });
    if (category) params.set('category', category);
    const response = await fetch(`${OPENVERSE_IMAGES_API}?${params}`, {
      headers: { 'User-Agent': USER_AGENT },
      signal: AbortSignal.timeout(SEARCH_TIMEOUT_MS),
    });
    if (!response.ok) return [];
    const data = await response.json();
    return (data.results || []).filter((r) => r.url);
  } catch {
    return [];
  }
}

/**
 * Fetch one CC-licensed image for a scene from the Openverse images API and
 * download it next to the job's uploads.
 *
 * A specific scene query ("temple bells rang") combined with both a style
 * category AND a theme keyword narrows the result pool fast — often to zero,
 * observed live even for a common theme like "India". Rather than fall back
 * to a gradient background on the very first empty search, this broadens the
 * query in three steps until something comes back: the full themed+styled
 * query, then the same query WITHOUT the category filter (style categories
 * are the most likely to starve results), then the theme alone (guaranteed
 * broad, still on-theme). The style/category is still honored whenever it
 * actually has matches — this only kicks in on genuine sparsity.
 *
 * @param {object} options
 * @param {string} options.query Keyword query.
 * @param {string} options.destDir Directory for the downloaded image.
 * @param {number} options.index Scene index (used in the filename).
 * @param {string} [options.style] Art style: photo|illustration|artwork map to
 *   Openverse's category filter; abstract appends a keyword; suggested = none.
 * @param {string} [options.theme] Theme appended to every query (e.g. "India").
 * @returns {Promise<{path: string, attribution: {title: string, creator: string,
 *   license: string, sourceUrl: string}}|null>} Image + credit, or null when
 *   every broadened attempt still comes up empty (caller falls back to a
 *   gradient background).
 */
export async function fetchSceneImage({ query, destDir, index, style = 'suggested', theme = '' }) {
  const themedQuery = theme && theme.trim() ? `${query} ${theme.trim()}` : query;
  const styledQuery = style === 'abstract' ? `${themedQuery} abstract` : themedQuery;
  const category = STYLE_CATEGORIES[style] || null;

  const attempts = [{ q: styledQuery, category }];
  if (category) attempts.push({ q: styledQuery, category: null });
  if (theme && theme.trim()) attempts.push({ q: theme.trim(), category: null });

  let candidates = [];
  for (const attempt of attempts) {
    candidates = await searchOpenverseImages(attempt.q, attempt.category);
    if (candidates.length > 0) break;
  }
  if (candidates.length === 0) return null;

  try {
    const pick = candidates[Math.floor(Math.random() * candidates.length)];

    const ext = /\.(png|webp)(\?|$)/i.test(pick.url) ? '.png' : '.jpg';
    const imagePath = path.join(destDir, `scene-${index}${ext}`);
    const download = await fetch(pick.url, {
      headers: { 'User-Agent': USER_AGENT },
      signal: AbortSignal.timeout(DOWNLOAD_TIMEOUT_MS),
      redirect: 'follow',
    });
    if (!download.ok || !download.body) throw new Error(`download HTTP ${download.status}`);
    await pipeline(Readable.fromWeb(download.body), fs.createWriteStream(imagePath));

    // ffprobe doubles as an "is this really an image" validator.
    const meta = await probeMedia(imagePath);
    if (!meta.width || !meta.height) throw new Error('not a decodable image');

    const licenseSlug = (pick.license || '').toLowerCase();
    const license =
      licenseSlug === 'cc0' ? `CC0 ${pick.license_version || '1.0'}`.trim()
        : licenseSlug === 'pdm' ? 'Public Domain Mark'
        : `CC ${licenseSlug.toUpperCase()} ${pick.license_version || ''}`.trim();
    return {
      path: imagePath,
      attribution: {
        title: pick.title || 'Untitled image',
        creator: pick.creator || 'Unknown artist',
        license,
        sourceUrl: pick.foreign_landing_url || pick.url,
      },
    };
  } catch {
    return null;
  }
}

/**
 * Synthesize narration for one scene with the built-in Windows voice
 * (System.Speech via PowerShell — no install, fully offline).
 *
 * @param {object} options
 * @param {string} options.text Scene text to speak.
 * @param {string} options.wavPath Output WAV path.
 * @param {string} options.workDir Directory for the intermediate text file.
 * @param {number} options.index Scene index (names the text file).
 * @returns {Promise<{path: string, duration: number}|null>} The WAV and its
 *   probed duration, or null when TTS is unavailable/failed.
 */
export async function synthNarration({ text, wavPath, workDir, index }) {
  try {
    const textFile = path.join(workDir, `narration-${index}.txt`);
    fs.writeFileSync(textFile, text, 'utf8');
    const psScript =
      "Add-Type -AssemblyName System.Speech; " +
      `$t = [System.IO.File]::ReadAllText('${textFile.replace(/'/g, "''")}', [System.Text.Encoding]::UTF8); ` +
      '$s = New-Object System.Speech.Synthesis.SpeechSynthesizer; ' +
      '$s.Rate = 0; ' +
      `$s.SetOutputToWaveFile('${wavPath.replace(/'/g, "''")}'); ` +
      '$s.Speak($t); $s.Dispose()';
    execFileSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', psScript], {
      stdio: 'ignore',
      windowsHide: true,
      timeout: 120_000,
    });
    const meta = await probeMedia(wavPath);
    if (!meta.hasAudio || !meta.duration || meta.duration < 0.3) {
      throw new Error('empty narration');
    }
    return { path: wavPath, duration: meta.duration };
  } catch {
    return null;
  }
}

/**
 * Word-wrap caption text for drawtext (which renders \n but cannot wrap).
 *
 * @param {string} text Scene text.
 * @param {number} maxChars Characters per line (~34 landscape, ~24 portrait).
 * @returns {string} Wrapped text with \n line breaks.
 */
export function wrapCaption(text, maxChars) {
  const words = text.split(' ');
  const lines = [];
  let line = '';
  for (const word of words) {
    const candidate = line ? `${line} ${word}` : word;
    if (line && candidate.length > maxChars) {
      lines.push(line);
      line = word;
    } else {
      line = candidate;
    }
  }
  if (line) lines.push(line);
  return lines.join('\n');
}
