# Task: Auto-fetch background music from the internet

**Status:** COMPLETE 2026-07-10. Approved with modification: **online-first** —
a fresh internet track always wins over local files; local `public/audio/`
files are a fallback tier, not an override.
**Builds on:** [[highlight-video-editor]] (completed base app)

## Goal

Instead of requiring the user to drop .mp3 files into `server/public/audio/`,
the app automatically fetches a suitable, legally usable music track from the
internet at render time and mixes it into the generated video.

## Source selection (researched live, 2026-07-10)

**Openverse audio API** (`api.openverse.org/v1/audio/`) — chosen because:
- No API key or account required (Jamendo/Pixabay/Freesound all need keys).
- Verified working today: 240 results for "upbeat instrumental",
  `license_type=commercial` filter, direct downloadable mp3 URLs
  (Jamendo-hosted), duration metadata in ms.
- Sample download verified: valid 44.1kHz stereo mp3, ffprobe-readable.
- Tracks are Creative Commons (mostly CC BY / BY-SA) → we must surface
  attribution, which the plan includes.

Risks: anonymous rate limits (fine for a local app; mitigated by caching) and
network dependency (mitigated by cache → local folder → silent fallback chain).

## Design (MVP)

### New module: `server/musicFetcher.js`
- `resolveMusicTrack({ query, audioDir, cacheDir, onWarning, onStage })`
  → `Promise<{ path, attribution } | null>` where `attribution` =
  `{ title, creator, license, sourceUrl }` (null for local files).
- Resolution priority (**online-first**, per review):
  1. **Online fetch**: search Openverse (`q=<query>`, `category=music`,
     `license_type=commercial`, `page_size=20`), keep results with duration
     ≥ 45s (background tracks, not stingers), pick one at random, download to
     `server/cache/music/<openverse-id>.mp3` + `<id>.json` sidecar with
     attribution. Validate with ffprobe (audio stream, duration > 10s) before
     use; delete and try the next candidate on validation failure (up to 3).
     Already-cached candidates are reused without re-downloading.
  2. **Cache fallback**: if the network fails (offline / rate-limited), pick a
     random previously downloaded track from the cache.
  3. **Local user tracks** in `server/public/audio/*.mp3`, picked at random.
  4. **Silent fallback**: warning event, render without music (existing path).
- Timeouts: 10s for the API search, 60s for the download; every failure mode
  degrades gracefully to the next tier.

### `videoProcessor.js` (small change)
- New optional `musicPath` option that bypasses the `audioDir` scan when set.
  `audioDir` scanning stays for backward compatibility (selftest uses it).

### `server.js`
- New optional form field `musicQuery` (trimmed, capped at 100 chars; default
  `"upbeat instrumental"`).
- Job flow: emit `progress` stage "Fetching music" → `resolveMusicTrack(...)`
  → pass `musicPath` to `processJob`. Attribution included in the `complete`
  event payload and the job snapshot (late-join replay keeps working).
- `cache/music/` added to `.gitignore`.

### Client
- **ConfigPanel**: "Background music" text input (default placeholder
  "upbeat instrumental") with helper text: fetched online (CC-licensed via
  Openverse); files in `server/public/audio/` take priority.
- **App**: append `musicQuery` to the FormData; capture attribution from the
  `complete` event.
- **VideoPreview**: attribution line when present — "Music: <title> —
  <creator> (<license>)" linking to the source page (CC BY requires credit).

## Verification plan

1. Unit-ish: run `resolveMusicTrack` directly — online fetch, cache hit
   (second call with network working), and silent fallback (bogus API host).
2. Selftest: add a networked scenario that renders merge-mode with a fetched
   track; auto-skips with a note when offline so the core selftest stays green
   without network.
3. Full-stack E2E re-run: `public/audio/` is empty, so the HTTP path exercises
   the auto-fetch tier; assert `complete` carries attribution and the output
   has an audio stream.
4. README + this file updated.

## Out of scope (deliberately, MVP)

- Genre/mood dropdowns, track preview/selection UI, multiple tracks per video,
  beat-matching, volume UI. All possible later.

## Work log

- **`server/musicFetcher.js`** — implemented as planned (Openverse search →
  atomic .part download + attribution sidecar → ffprobe validation with
  bad-candidate eviction, up to 3 attempts → cache → local → null). One
  addition beyond plan: when a niche query returns zero candidates (observed
  live with "acoustic folk"), it retries with the default query
  "upbeat instrumental" + a warning, instead of dropping straight to silence.
- **`videoProcessor.js`** — added optional `musicPath` (bypasses audioDir
  scan); audioDir fallback retained for selftest/back-compat.
- **`server.js`** — `musicQuery` form field (100-char cap), music resolution
  in `runJob` with "Fetching music" stage event, attribution in `complete`
  payload + job snapshot (late-join replay included), `cache/music/` created
  at startup and gitignored.
- **Client** — ConfigPanel "Background music" input; App sends `musicQuery`,
  stores attribution; VideoPreview shows "Music: <title> by <creator>
  (<license>) — source" credit line. Build clean.
- **Verification (all green)**:
  - Selftest now 6 scenarios: the 5 offline ones still PASS; new networked
    scenario fetched "Ever after" by zero-project (CC BY 3.0) from Openverse,
    cached it, rendered 6.00s merge output with audio — PASS. Skips with a
    pass-note when offline.
  - Full-stack E2E: musicQuery="acoustic folk" → warning + default-query
    fallback → downloaded "Casa Noir" by Quantum Jazz (CC BY-SA 3.0) →
    attribution arrived in `complete` → output 8.5s with video+audio streams,
    HTTP 200, uploads cleaned.
  - Gotcha fixed during verification: a stale server process (git-bash `kill`
    had only terminated the shell wrapper, leaving node.exe holding :5000)
    silently served one E2E run with pre-change code. Killed via taskkill;
    E2E now asserts "listening" appears in the fresh server's own log first.
- **README** updated (auto-fetch flow, attribution obligation, rate-limit and
  cache-pruning notes).
