/**
 * musicFetcher.js
 *
 * Resolves a background-music track for a render job, online-first:
 *   1. Fetch a fresh CC-licensed track from the Openverse audio API
 *      (api.openverse.org — no API key required).
 *   2. If the network fails, fall back to a previously downloaded track from
 *      the local cache.
 *   3. Then fall back to user-provided .mp3 files in server/public/audio/.
 *   4. Finally resolve null — the caller renders without music.
 *
 * Downloaded tracks are cached as <openverse-id>.mp3 plus an <id>.json sidecar
 * carrying attribution (most Openverse music is CC BY / BY-SA, which requires
 * credit — the UI displays it).
 *
 * STRICT NO-REUSE: every track consumed by a successful render is recorded in
 * a persistent ledger (used-tracks.json in the cache dir, mapping track →
 * jobId). Selection — both the online search and the offline cache fallback —
 * excludes every ledgered track, so no two videos ever share a background
 * track. The .mp3 files are never deleted: the cache directory is the
 * permanent audio archive for all generated videos. Local files in
 * public/audio/ are user-managed and exempt from the no-reuse rule (they are
 * the last resort before silence).
 */

import fs from 'fs';
import path from 'path';
import { pipeline } from 'stream/promises';
import { Readable } from 'stream';
import { probeMedia, listMusicTracks } from './videoProcessor.js';

const OPENVERSE_API = 'https://api.openverse.org/v1/audio/';
const USER_AGENT = 'highlight-reel-studio/1.0 (local desktop app)';
const SEARCH_TIMEOUT_MS = 10_000;
const DOWNLOAD_TIMEOUT_MS = 60_000;
const MIN_TRACK_MS = 45_000; // skip stingers/jingles; we want background beds
const MAX_DOWNLOAD_ATTEMPTS = 3;
const PAGE_SIZE = 20; // Openverse anonymous-tier page-size cap
const MAX_SEARCH_PAGES = 5; // walk deeper pages when earlier tracks are used up
const TARGET_UNUSED_CANDIDATES = 5; // stop paging once this many unused found
const LEDGER_FILE = 'used-tracks.json';

export const DEFAULT_MUSIC_QUERY = 'upbeat instrumental';

/**
 * In-memory reservations: tracks handed to an in-flight job but not yet
 * ledgered, so two concurrent jobs can never pick the same track. Cleared by
 * markTrackUsed() on success or releaseTrackReservation() on failure.
 */
const reservedIds = new Set();

/**
 * Read the used-tracks ledger (empty array when missing/corrupt).
 *
 * @param {string} cacheDir Cache directory holding the ledger.
 * @returns {Array<object>} Ledger entries.
 */
function loadLedger(cacheDir) {
  try {
    const data = JSON.parse(fs.readFileSync(path.join(cacheDir, LEDGER_FILE), 'utf8'));
    return Array.isArray(data) ? data : [];
  } catch {
    return [];
  }
}

/**
 * Persist the ledger atomically (tmp file + rename).
 *
 * @param {string} cacheDir Cache directory holding the ledger.
 * @param {Array<object>} entries Full ledger contents to write.
 */
function saveLedger(cacheDir, entries) {
  const file = path.join(cacheDir, LEDGER_FILE);
  const tmp = `${file}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(entries, null, 2), 'utf8');
  fs.renameSync(tmp, file);
}

/**
 * The ids of every track ever consumed by a completed render.
 *
 * @param {string} cacheDir Cache directory holding the ledger.
 * @returns {Set<string>} Used track ids.
 */
export function getUsedTrackIds(cacheDir) {
  return new Set(loadLedger(cacheDir).map((e) => e.id));
}

/**
 * Record a track as consumed by a completed render and release its
 * reservation. Call ONLY after the render succeeded — failed jobs must not
 * burn a track.
 *
 * @param {string} cacheDir Cache directory holding the ledger.
 * @param {{id: string, title?: string, creator?: string, license?: string,
 *   sourceUrl?: string, file: string, jobId: string}} entry Ledger entry
 *   (usedAt timestamp is added here).
 */
export function markTrackUsed(cacheDir, entry) {
  const ledger = loadLedger(cacheDir);
  ledger.push({ ...entry, usedAt: new Date().toISOString() });
  saveLedger(cacheDir, ledger);
  reservedIds.delete(entry.id);
}

/**
 * Release a reservation without ledgering it (job failed — the track stays
 * available for future renders).
 *
 * @param {string|null|undefined} id Track id returned by resolveMusicTrack.
 */
export function releaseTrackReservation(id) {
  if (id) reservedIds.delete(id);
}

/**
 * Format an Openverse license pair for display, e.g. ("by", "3.0") → "CC BY 3.0".
 *
 * @param {string} license Openverse license slug (by, by-sa, cc0, pdm, …).
 * @param {string} version License version string (may be empty).
 * @returns {string} Human-readable license label.
 */
function formatLicense(license, version) {
  const slug = (license || '').toLowerCase();
  if (slug === 'cc0') return `CC0 ${version || '1.0'}`.trim();
  if (slug === 'pdm') return 'Public Domain Mark';
  return `CC ${slug.toUpperCase()} ${version || ''}`.trim();
}

/**
 * In-place Fisher–Yates shuffle (returns the same array for chaining).
 *
 * @param {Array<*>} arr Array to shuffle.
 * @returns {Array<*>} The shuffled array.
 */
function shuffle(arr) {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

/**
 * Search one page of the Openverse audio API for music candidates.
 *
 * @param {string} query Free-text search (mood/genre).
 * @param {number} [page] 1-based result page.
 * @returns {Promise<Array<{id: string, title: string, creator: string,
 *   license: string, url: string, sourceUrl: string}>>} Usable candidates
 *   (direct download URL present, duration ≥ 45s). Throws on network/HTTP
 *   error for page 1; deeper pages treat HTTP errors as "no more results".
 */
async function searchOpenverse(query, page = 1) {
  const params = new URLSearchParams({
    q: query,
    category: 'music',
    license_type: 'commercial',
    page_size: String(PAGE_SIZE),
    page: String(page),
  });
  const response = await fetch(`${OPENVERSE_API}?${params}`, {
    headers: { 'User-Agent': USER_AGENT },
    signal: AbortSignal.timeout(SEARCH_TIMEOUT_MS),
  });
  if (!response.ok) {
    // Past the last page Openverse responds 404; don't fail the whole fetch
    // when we were only probing deeper pages.
    if (page > 1) return [];
    throw new Error(`Openverse search returned HTTP ${response.status}`);
  }
  const data = await response.json();
  return (data.results || [])
    .filter((r) => r.url && (r.duration || 0) >= MIN_TRACK_MS)
    .map((r) => ({
      id: String(r.id),
      title: r.title || 'Untitled',
      creator: r.creator || 'Unknown artist',
      license: formatLicense(r.license, r.license_version),
      url: r.url,
      sourceUrl: r.foreign_landing_url || r.url,
    }));
}

/**
 * Download a candidate track into the cache (atomically, via a .part file)
 * and write its attribution sidecar.
 *
 * @param {object} candidate One entry from searchOpenverse().
 * @param {string} cacheDir Cache directory (created by the caller).
 * @returns {Promise<string>} Path of the cached .mp3. Throws on any failure.
 */
async function downloadTrack(candidate, cacheDir) {
  const finalPath = path.join(cacheDir, `${candidate.id}.mp3`);
  const partPath = `${finalPath}.part`;

  const response = await fetch(candidate.url, {
    headers: { 'User-Agent': USER_AGENT },
    signal: AbortSignal.timeout(DOWNLOAD_TIMEOUT_MS),
    redirect: 'follow',
  });
  if (!response.ok || !response.body) {
    throw new Error(`download returned HTTP ${response.status}`);
  }

  try {
    await pipeline(Readable.fromWeb(response.body), fs.createWriteStream(partPath));
    fs.renameSync(partPath, finalPath);
  } catch (err) {
    try { fs.unlinkSync(partPath); } catch { /* already gone */ }
    throw err;
  }

  fs.writeFileSync(
    `${finalPath}.json`,
    JSON.stringify(
      { title: candidate.title, creator: candidate.creator, license: candidate.license, sourceUrl: candidate.sourceUrl },
      null,
      2
    ),
    'utf8'
  );
  return finalPath;
}

/**
 * Remove a cached track and its sidecar (used when validation fails).
 *
 * @param {string} cacheDir Cache directory.
 * @param {string} id Openverse track id.
 */
function evictCached(cacheDir, id) {
  for (const suffix of ['.mp3', '.mp3.json', '.mp3.part']) {
    try { fs.unlinkSync(path.join(cacheDir, `${id}${suffix}`)); } catch { /* already gone */ }
  }
}

/**
 * Collect online candidates that have never been used, walking result pages
 * until enough are found or the results run out.
 *
 * @param {string} query Free-text search (mood/genre).
 * @param {function(string): boolean} isAvailable id → not used and not reserved.
 * @returns {Promise<Array<object>>} Unused candidates (possibly empty).
 */
async function collectUnusedCandidates(query, isAvailable) {
  const unused = [];
  for (let page = 1; page <= MAX_SEARCH_PAGES; page++) {
    const results = await searchOpenverse(query, page);
    unused.push(...results.filter((r) => isAvailable(r.id)));
    if (unused.length >= TARGET_UNUSED_CANDIDATES || results.length < PAGE_SIZE) break;
  }
  return unused;
}

/**
 * Pick a random downloaded-but-never-used track from the cache (strict
 * no-reuse: ledgered tracks are excluded).
 *
 * @param {string} cacheDir Cache directory.
 * @param {function(string): boolean} isAvailable id → not used and not reserved.
 * @returns {{path: string, id: string, attribution: object|null}|null} An
 *   unused cached track with its sidecar attribution (null attribution if the
 *   sidecar is unreadable), or null when nothing unused remains.
 */
function pickUnusedCachedTrack(cacheDir, isAvailable) {
  if (!fs.existsSync(cacheDir)) return null;
  const mp3s = fs
    .readdirSync(cacheDir)
    .filter((f) => f.endsWith('.mp3'))
    .filter((f) => isAvailable(path.basename(f, '.mp3')));
  if (mp3s.length === 0) return null;
  const chosen = mp3s[Math.floor(Math.random() * mp3s.length)];
  const trackPath = path.join(cacheDir, chosen);
  let attribution = null;
  try {
    attribution = JSON.parse(fs.readFileSync(`${trackPath}.json`, 'utf8'));
  } catch { /* sidecar missing/corrupt — still usable, just uncredited */ }
  return { path: trackPath, id: path.basename(chosen, '.mp3'), attribution };
}

/**
 * Resolve a background-music track, online-first with graceful degradation
 * and STRICT NO-REUSE: any track already consumed by a completed render (per
 * the used-tracks ledger) is never picked again. The returned track is
 * reserved in memory until the caller either marks it used (render succeeded)
 * or releases it (render failed).
 *
 * @param {object} options
 * @param {string} [options.query] Mood/genre search text (default "upbeat instrumental").
 * @param {string} options.audioDir Local user-tracks folder (server/public/audio).
 * @param {string} options.cacheDir Download cache folder (server/cache/music).
 * @param {function(string): void} [options.onWarning] Non-fatal warning callback.
 * @param {function(string): void} [options.onStage] Stage-label callback (e.g. "Fetching music").
 * @returns {Promise<{path: string, id: string|null, attribution: {title: string,
 *   creator: string, license: string, sourceUrl: string}|null}|null>} The
 *   chosen track: `id` is set for fetched/cached tracks (pass it to
 *   markTrackUsed / releaseTrackReservation) and null for local files, which
 *   are exempt from no-reuse; null result → render silent.
 */
export async function resolveMusicTrack({
  query,
  audioDir,
  cacheDir,
  onWarning = () => {},
  onStage = () => {},
}) {
  const q = (query || '').trim() || DEFAULT_MUSIC_QUERY;
  fs.mkdirSync(cacheDir, { recursive: true });
  const usedIds = getUsedTrackIds(cacheDir);
  const isAvailable = (id) => !usedIds.has(id) && !reservedIds.has(id);

  // Tier 1 — fresh fetch from Openverse, excluding every used track.
  try {
    onStage('Fetching music');
    let candidates = await collectUnusedCandidates(q, isAvailable);
    if (candidates.length === 0 && q !== DEFAULT_MUSIC_QUERY) {
      // Niche queries can come up empty (or fully used up) — retry with the
      // default bed-music query rather than dropping straight to silence.
      onWarning(`No unused online tracks matched "${q}" — using "${DEFAULT_MUSIC_QUERY}" instead.`);
      candidates = await collectUnusedCandidates(DEFAULT_MUSIC_QUERY, isAvailable);
    }
    if (candidates.length === 0) {
      throw new Error(`no unused tracks found for "${q}"`);
    }
    let lastError = null;
    for (const candidate of shuffle(candidates).slice(0, MAX_DOWNLOAD_ATTEMPTS)) {
      const cachedPath = path.join(cacheDir, `${candidate.id}.mp3`);
      try {
        if (!fs.existsSync(cachedPath)) {
          await downloadTrack(candidate, cacheDir);
        }
        const meta = await probeMedia(cachedPath);
        if (!meta.hasAudio || meta.duration < 10) {
          throw new Error('downloaded file is not usable audio');
        }
        reservedIds.add(candidate.id);
        return {
          path: cachedPath,
          id: candidate.id,
          attribution: {
            title: candidate.title,
            creator: candidate.creator,
            license: candidate.license,
            sourceUrl: candidate.sourceUrl,
          },
        };
      } catch (err) {
        lastError = err;
        evictCached(cacheDir, candidate.id);
      }
    }
    throw lastError || new Error('all candidate downloads failed');
  } catch (err) {
    onWarning(`Online music fetch failed (${err.message}) — trying local fallbacks.`);
  }

  // Tier 2 — downloaded-but-never-used leftovers in the cache.
  const cached = pickUnusedCachedTrack(cacheDir, isAvailable);
  if (cached) {
    reservedIds.add(cached.id);
    return cached;
  }
  const cachedCount = fs.existsSync(cacheDir)
    ? fs.readdirSync(cacheDir).filter((f) => f.endsWith('.mp3')).length
    : 0;
  if (cachedCount > 0) {
    onWarning(`All ${cachedCount} stored track(s) were already used in earlier videos — strict no-reuse skips them.`);
  }

  // Tier 3 — user-provided local tracks (user-managed, exempt from no-reuse).
  const local = listMusicTracks(audioDir);
  if (local.length > 0) {
    return { path: local[Math.floor(Math.random() * local.length)], id: null, attribution: null };
  }

  // Tier 4 — nothing available.
  return null;
}
