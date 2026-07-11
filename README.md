# Highlight Reel Studio

A fully local web app for post-event highlight reels. Upload a mixed batch of
photos and video clips; the app stitches them in **exact upload order**,
**auto-fetches a CC-licensed background music track from the internet**
(Openverse — no API key), injects randomized transitions at every boundary,
and renders the final video on your machine — with live progress streamed to
the browser.

No database, no accounts, no system FFmpeg install required. Rendering is
fully local; only the music search/download touches the network, and it
degrades gracefully offline.

## Stack

| Layer | Choice |
|---|---|
| Frontend | React 18 + Vite 5, Tailwind CSS 3 (PostCSS), socket.io-client |
| Backend | Node.js (ES modules) + Express, multer |
| Realtime | Socket.io (rooms keyed by job id) |
| Video engine | fluent-ffmpeg with bundled binaries (see note below) |
| Persistence | None — filesystem only |

## Setup

```bash
# 1. Install dependencies
cd server && npm install
cd ../client && npm install
```

Background music is fetched automatically (see below) — no setup needed. You
can still drop .mp3 files into `server/public/audio/`; they are used as an
offline fallback.

## Run

```bash
# Terminal 1 — API + render engine on :5000
cd server && npm start

# Terminal 2 — web UI on :5173 (proxies /api, /socket.io, /output to :5000)
cd client && npm run dev
```

Open http://localhost:5173, drag in photos/clips, arrange nothing — **the
queue order is the edit order** (numbered badges) — pick a layout and audio
mode, optionally set a music mood/genre and a title (adds a 3s title slide),
and hit *Generate*. When rendering completes the progress bar is replaced by
an inline player, a download button, and the music credit.

### Background music (auto-fetched)

Music resolution is **online-first** with graceful degradation:

1. **Openverse fetch** — the "background music" field (default *upbeat
   instrumental*) is searched on the Openverse audio API (`category=music`,
   `license_type=commercial`, tracks ≥ 45s). A random result is downloaded to
   `server/cache/music/` and validated with ffprobe. If a niche query matches
   nothing unused, the default query is retried automatically.
2. **Cache** — offline or rate-limited? A downloaded-but-never-used track
   from the cache is picked.
3. **Local files** — any .mp3 in `server/public/audio/`.
4. **Silent** — a warning is emitted and the video renders without music.

### Every video gets music no other video has

Each fetched track is used **at most once, ever**. When a render completes,
its track is recorded in `server/cache/music/used-tracks.json` — the ledger
maps every track (id, title, creator, license, file) to the video (`jobId`)
that used it, and future selection (online search walks deeper result pages
as needed, and the offline cache tier) excludes all ledgered tracks. The .mp3
files themselves are never deleted: `server/cache/music/` is the permanent
audio archive of everything your videos have used. Failed renders don't burn
a track, and concurrent jobs can't grab the same one. Two exceptions, by
design: local files in `server/public/audio/` are user-managed and may
repeat, and a failed fetch with nothing unused left falls back to them (or
silence) rather than ever repeating a fetched track.

Fetched tracks are Creative Commons (mostly CC BY / BY-SA): the app shows
"Music: <title> by <creator> (<license>)" with a source link after rendering,
and the same attribution object is included in the Socket.io `complete` event.
**Credit the artist if you publish the video.**

## Headless self-test

```bash
cd server && npm run selftest
```

Synthesizes tiny test assets with the bundled FFmpeg (a PNG, a video with
audio, a silent video at a different size/fps, an .mp3), then renders five
scenarios (portrait/landscape × mute/merge, plus the empty-music-folder path)
and ffprobes each output to assert duration, audio presence, and monotonic
0→100 progress.

## How it works

- `POST /api/generate` stores files under `server/uploads/<jobId>/` in
  multipart order (never re-sorted), responds immediately with `{ jobId }`,
  and renders asynchronously.
- The client joins Socket.io room `<jobId>` and receives `progress`
  (`{ percent, stage }`), `warning`, `complete` (`{ url }`), and `error`
  events. Late joins get a state snapshot replay, so the POST→subscribe race
  can't lose events.
- One dynamic `-filter_complex` graph per job:
  - every input is normalized (`scale` → `pad` → `setsar=1` → `fps=30` →
    `format=yuv420p`) before any transition — `xfade` hard-fails on mismatched
    resolution/SAR/fps;
  - images run exactly 3s (`-loop 1 -t 3`), video durations come from ffprobe;
  - a random `xfade` transition (0.5s) joins every boundary; offsets are
    computed cumulatively (`offset_n = Σ durations(0..n) − 0.5·(n+1)`);
  - the background track comes from `musicFetcher.js` (online-first chain
    above); **mute mode**: the music track (looped via `-stream_loop -1`,
    trimmed to the final duration, 2s fade-out) is the only audio;
  - **merge mode**: each item contributes an audio segment of its exact length
    (real audio normalized to 44.1kHz stereo, images/silent videos contribute
    `anullsrc` silence), joined with `acrossfade` using the same 0.5s overlap
    as the video so A/V stay aligned, then `amix`ed with music ducked to 0.35;
  - output: `libx264 -preset veryfast -crf 22 -pix_fmt yuv420p
    -movflags +faststart`, AAC 192k, saved as `server/output/<jobId>.mp4`.
- On success the job's upload folder is deleted; on failure the uploads and
  any partial output are deleted and an `error` event fires.

## FFmpeg binary note (intentional deviation)

The spec called for `@ffmpeg-installer/ffmpeg`, but its win32-x64 package
ships a 2018 build (FFmpeg < 4.3) that **lacks the `xfade` filter** the whole
transition engine depends on. The processor therefore probes the installed
binaries at startup: it uses `@ffmpeg-installer`'s binary when it supports
`xfade`, and otherwise falls back to `ffmpeg-static` (FFmpeg 6.x) — still
fully bundled, still zero system dependency. `@ffprobe-installer/ffprobe` is
used for probing as specified. `GET /api/health` reports which binary is
active and whether `xfade` is available.

## Known limitations

- Very short clips (< 1s) shrink the transition overlap (clamped to half the
  shortest item) so `xfade`/`acrossfade` can't be asked to overlap more media
  than exists; a warning is emitted when this happens.
- Job state lives in server memory — restarting the server forgets in-flight
  jobs (files in `output/` survive).
- `.mov` support depends on the codecs inside the container (H.264/HEVC MOVs
  are fine; exotic codecs will be skipped with a warning if ffprobe can't read
  them).
- Uploads are written to disk before validation of *content* (extension is
  validated up front); a corrupt file is skipped at probe time with a warning
  rather than failing the job.
- Title slides need a system font (Arial/Segoe UI on Windows, Arial/Helvetica
  on macOS, DejaVu/Liberation on Linux). With no font found, the slide renders
  black with a warning.
- Music fetching uses Openverse's anonymous API tier — heavy back-to-back
  rendering could hit rate limits, at which point the cache/local/silent
  fallbacks kick in. The music archive in `server/cache/music/` is never
  pruned automatically (it's the permanent record of every video's audio);
  deleting files there is safe but forgets that audio — the ledger entry
  still prevents reuse.
- The unused-track pool for a query is finite (a few hundred for broad
  queries). If you render a very large number of videos with the same query,
  the fetcher pages deeper and eventually falls back to the default query,
  then local files, then silence — it will never repeat a fetched track.
