# Task: Unique music per video (persistent used-track ledger)

**Status:** COMPLETE 2026-07-10 — strict no-reuse (never repeat a fetched
track; local files then silence when nothing unused is available) and
archive + ledger storage (no per-video audio copies).
**Builds on:** [[internet-music-fetch]] (online-first music, completed)

## Goal

Every generated video must get a background track that has **never been used
in a previous render**. To enforce that across server restarts, every used
track is stored permanently and recorded in a ledger mapping track → video.

## Design (MVP)

### Persistent ledger — `server/cache/music/used-tracks.json`
- Array of entries:
  `{ id, title, creator, license, sourceUrl, file, jobId, usedAt }`.
- Written atomically (tmp + rename). Loaded on demand; the set of used `id`s
  drives all no-reuse filtering. The .mp3 files in `cache/music/` are never
  deleted — that folder is the permanent audio archive, and the ledger tells
  you exactly which video each file scored.

### `musicFetcher.js` changes
- `searchOpenverse(query, page)` — add pagination. Selection walks up to 5
  pages (20 results each; the anonymous-tier page cap) collecting candidates
  whose `id` is NOT in the used set, stopping early once it has enough.
- If the user's query yields zero **unused** candidates, retry with the
  default query (existing behavior, now used-filtered too).
- Tier 2 (offline cache fallback) now only picks cached tracks that are
  **not in the ledger** (downloaded-but-never-used leftovers).
- Tier 3 (local `public/audio/` files) stays reuse-allowed: those are
  user-managed and better than silence — documented as such.
- In-memory `reserved` set guards two concurrent jobs from picking the same
  track; a reservation is released on job failure.
- New export `markTrackUsed(cacheDir, entry)` — appends to the ledger.
  Called by the server **only after a successful render**, so a failed job
  doesn't burn a track.
- Resolved result gains the track `id` so the server can mark it.

### `server.js` changes
- After `processJob` succeeds and `complete` is broadcast: call
  `markTrackUsed` with the track + `jobId`.
- On failure: release the reservation (no ledger write).

### Verification
- Selftest: networked scenario extended — resolve twice with the same query,
  assert the two track ids differ, assert the ledger contains the first entry
  after marking it used. Offline-skip behavior preserved.
- Full-stack E2E: two consecutive HTTP renders with the same music query →
  assert different attributions/tracks and a 2-entry ledger.

## Open decision (asked at review)
- Offline + every cached track already used: strict (fall to local files /
  silence) vs. permit reuse as a last resort.
- Whether to ALSO copy the track next to each video (`output/<jobId>-music.mp3`)
  with a UI download link, or keep the archive in `cache/music/` + ledger only.

## Work log

- **`musicFetcher.js`** — added persistent ledger (`used-tracks.json`, atomic
  tmp+rename writes) with `getUsedTrackIds` / `markTrackUsed` /
  `releaseTrackReservation` exports and an in-memory reservation set for
  concurrent jobs. `searchOpenverse` gained pagination (404 past the last
  page is treated as end-of-results); `collectUnusedCandidates` walks up to 5
  pages until 5 unused candidates are found. Tier 2 now only picks
  downloaded-but-never-used cache files; a clear warning distinguishes
  "everything stored was already used" from "cache is empty". Resolved
  results carry the track `id` (null for local files, which stay exempt).
- **`server.js`** — `markTrackUsed` after a successful render (attribution +
  file + jobId), `releaseTrackReservation` on failure so failed jobs don't
  burn tracks.
- **Verification (all green)**:
  - Selftest: 7 checks PASS — the 6 prior ones plus `no-reuse-ledger`
    (fetched "Une journée calme" by Boudu, ledgered it, second resolve
    returned a different track).
  - Two-render full-stack E2E with the SAME query: job A got "Sun and
    Friends", job B got "Diving" (both Ton in Ton, CC BY 3.0) — tracks
    distinct, ledger grew 0→2 with both jobIds and distinct ids, both mp3s
    archived on disk.
- **README** updated (no-reuse guarantee, ledger/archive semantics, finite
  unused-pool limitation).
