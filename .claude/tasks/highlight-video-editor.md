# Task: Automated Event Highlight Video Editor (MERN minus Mongo)

**Status:** In progress — started 2026-07-10
**Mode note:** The task prompt explicitly instructs "Wait for nothing; proceed immediately after showing it," and this session is non-interactive, so the plan is documented here and execution proceeds without a review gate.

## Goal

Fully local web app: upload a mixed batch of photos/videos, stitch in exact upload
order with randomized 0.5s xfade transitions, overlay a random background music
loop, render with libx264, stream live progress to the browser via Socket.io.

## Fixed stack

- Client: React 18 + Vite 5, Tailwind CSS 3.x (PostCSS), socket.io-client
- Server: Node ESM + Express, multer, socket.io, fluent-ffmpeg,
  @ffmpeg-installer/ffmpeg, @ffprobe-installer/ffprobe
- No database — filesystem only.

## Directory tree

```
project-root/
├── .gitignore
├── README.md
├── client/
│   ├── index.html
│   ├── package.json
│   ├── vite.config.js          # proxy /api, /socket.io (ws), /output → :5000
│   ├── tailwind.config.js
│   ├── postcss.config.js
│   └── src/
│       ├── main.jsx
│       ├── index.css
│       ├── App.jsx
│       └── components/
│           ├── UploadQueue.jsx
│           ├── ConfigPanel.jsx
│           ├── ProgressBar.jsx
│           └── VideoPreview.jsx
└── server/
    ├── package.json
    ├── server.js               # Express + Socket.io bootstrap, job lifecycle
    ├── videoProcessor.js       # all FFmpeg logic (probe, graph build, render)
    ├── scripts/selftest.js     # headless E2E: generates assets, renders 5 combos
    ├── uploads/                # transient, per-jobId subfolders (gitignored)
    ├── output/                 # rendered videos, served at /output (gitignored)
    └── public/audio/           # user drops loopable .mp3 tracks here
```

## Build order & tasks

1. [ ] Scaffold dirs, `.gitignore`, both `package.json`s; `npm install` both (background, parallel).
2. [ ] `server/videoProcessor.js` — probe → normalize → xfade chain → audio graph → render.
3. [ ] `server/server.js` — multer (order-preserving, ext whitelist), `/api/generate`, Socket.io rooms with state replay on `join`, static `/output`, cleanup on success/failure.
4. [ ] Client: Vite/Tailwind config + 4 components + App state machine (idle → processing → done/error with retry).
5. [ ] Verify: server boots + `/api/health`; `npm run build` in client.
6. [ ] Check the bundled ffmpeg actually has `xfade` (added in FFmpeg 4.3 — the @ffmpeg-installer Windows binary may be older; if missing, swap binary provider and document).
7. [ ] Selftest: generate 1 png + 1 video-with-audio + 1 silent video + 1 mp3 via the bundled ffmpeg; render portrait/landscape × mute/merge + empty-audio-dir case; ffprobe outputs to assert duration/streams; confirm progress climbs.
8. [ ] README.md; final report; update this file with as-built notes.

## Key design decisions (and why)

- **Order preservation:** multer receives files in multipart stream order, which is
  FormData append order. Files are additionally saved with a `0000_` index prefix,
  and processing uses `req.files` array order — never re-sorted.
- **xfade offset math:** for boundary *n* (0-based, joining item *n+1*):
  `offset_n = Σ durations(items 0..n) − T·(n+1)` where T = 0.5s. Implemented
  incrementally: keep a running `timeline`; each boundary's offset is
  `timeline − T`, then `timeline += d[next] − T`.
- **Transition-duration clamp:** T is clamped to `min(0.5, minItemDuration/2 − 0.05)`
  so a sub-second clip can't make xfade/acrossfade fail; normally stays 0.5.
- **Audio/video alignment in merge mode:** clip audio segments (real audio via
  `apad`+`atrim`, or `anullsrc` for images/silent videos) are joined with
  `acrossfade=d=T` — same overlap as video xfade — so the audio timeline exactly
  matches the visual timeline (no cumulative drift), then `amix`ed with the music
  ducked to 0.35 (post-`volume=2` compensates amix's per-input halving, which is
  used instead of `normalize=0` for older-ffmpeg compatibility).
- **Title text:** written to a `title.txt` and injected via `drawtext=textfile=`
  instead of `text=` — sidesteps the entire quote/colon/backslash escaping minefield;
  only the file *paths* need `\:` escaping. Font resolved from a per-OS candidate list.
- **Late-join race:** server keeps a per-job state snapshot and replays it when a
  socket `join`s, so a client that subscribes after processing started still syncs.
- **Progress:** totalFrames = finalDuration × 30; percent = clamp(frames/total, 0, 99)
  until the file is finalized, then 100.

## Work log (append as tasks complete)

- **Scaffold + installs** — tree created; `npm install` clean in both `client/`
  (React 18.3, Vite 5.4, Tailwind 3.4) and `server/` (Express 4, socket.io 4,
  fluent-ffmpeg 2.1, multer 1.4-lts). Node 24.17 / npm 11.13.
- **xfade discovery (important)** — `@ffmpeg-installer/win32-x64` ships FFmpeg
  N-92722 (2018, pre-4.3) which has NO `xfade` filter. Added `ffmpeg-static`
  (FFmpeg 6.1.1) as a runtime fallback: `videoProcessor.js` probes both
  binaries at startup and picks the first with `xfade`, logging the fallback.
  ffprobe still comes from `@ffprobe-installer` as specced.
- **videoProcessor.js** — implemented as planned (normalize → xfade chain →
  mode-dependent audio graph → libx264/AAC). One real bug found & fixed during
  self-test: drawtext `fontfile=`/`textfile=` paths were only `\:`-escaped,
  but the graph parser consumes that backslash before the option parser runs,
  so `C:` split the path (symptom: "Both text and text file provided" from
  shorthand misparsing). Fix: single-quote the path AND `\:`-escape the colon
  (two-level escaping) — `escapeFilterPath()` documents this.
- **server.js** — order-preserving multer storage (0000_ index prefix +
  req.files array order), `/api/generate`, per-job Socket.io rooms with
  snapshot replay on late `join`, `/output` static, success/failure cleanup,
  `/api/health` reporting active binary + xfade support.
- **Client** — 4 components + App state machine (idle → uploading →
  processing → done | error with retry); `npm run build` passes clean.
- **Verification (all green)**:
  - `scripts/selftest.js`: 5 headless scenarios (landscape+merge+title,
    portrait+merge, landscape+mute, portrait+mute, empty-audio+mute) ALL PASS —
    exact expected durations (6.00s / 8.50s), correct audio-stream presence,
    monotonic 0→100 progress, randomized transitions per run.
  - Full-stack E2E: real multipart POST → socket events observed climbing
    0→100 → `complete` → `GET /output/<id>.mp4` HTTP 200 `video/mp4` →
    uploads/<jobId> auto-deleted. Hostile title text (colons/quotes/backslash)
    rendered correctly via the textfile= approach.
  - Vite proxy: `curl :5173/api/health` reaches the API through the dev server.
- **Docs** — README.md with setup/usage/self-test/architecture/limitations,
  including the ffmpeg-static deviation rationale.

**Status: COMPLETE** — all acceptance criteria verified 2026-07-10.
