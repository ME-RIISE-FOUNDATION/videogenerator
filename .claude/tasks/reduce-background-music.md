# Task: Recognize and reduce background music, keep voice

**Status:** COMPLETE 2026-07-22.

## Request

User wanted: if an uploaded video has background music, recognize and remove
it while keeping the person's spoken voice.

## Analysis (presented to user before building)

True "remove music, keep voice" is speech/music source separation — a real,
hard signal-processing problem, not something any FFmpeg filter does (checked
`afftdn`/`anlmdn`/`arnndn` — all are broadband-noise reducers, not music
removers; classic phase-cancellation "vocal removal" goes the wrong direction
and isn't reliable on real recordings). Checked this machine: Python 3.14.6 is
installed, which would allow Spleeter/Demucs, but that Python version is very
new and those tools' TensorFlow/PyTorch dependencies commonly lag behind
supporting the newest Python — a real compatibility risk, not just "pip
install and done." A pure-Node ONNX approach was also considered but has no
existing reference in this codebase and high implementation risk.

Presented three options with honest tradeoffs (FFmpeg heuristic / Python ML
separation / bundled ONNX model) and two scope questions (approach + where it
applies) via AskUserQuestion before writing any code.

**User chose:** FFmpeg heuristic now, scoped to Studio's Merge Audio Levels
mode only (the one existing path that already uses original clip audio).

## Design (implemented as scoped)

New `reduceBackgroundMusic` boolean option on `processJob`, applied per-clip
in merge-mode's audio chain, before `apad`/`atrim`:

```
highpass=f=150,equalizer=f=2200:t=q:w=1.2:g=5,lowpass=f=7500,
agate=threshold=0.03:ratio=6:attack=10:release=200
```

- `highpass=150` — cuts sub-150Hz rumble/bass where music basslines live.
- `equalizer` peak at 2.2kHz — boosts the core speech-presence band.
- `lowpass=7500` — trims high-frequency music content (cymbals etc.).
- `agate` — ducks quiet sustained content between spoken words (won't touch
  music playing at the same time AND volume as speech — no filter can,
  without real separation).

Honestly labeled everywhere (UI checkbox copy, JSDoc, README) as "reduce
background music" / "reduces bleed-through, not full separation" — never
oversold as clean removal.

## Verification

- **Filter design validated empirically before wiring into the app:** built
  a synthetic 110Hz "bass/music" + 1000Hz "voice" tone mix, ran the exact
  candidate filter chain, measured via `ffmpeg astats` — bass dropped ~6.5dB
  relative to voice. Confirmed exact parameter names (`agate`'s
  threshold/ratio/attack/release, `equalizer`'s f/t/w/g) via `-h filter=X`
  before writing code, avoiding another round of syntax trial-and-error.
- **First full-stack E2E attempt was confounded:** ran the toggle on/off via
  the real HTTP API and got the WRONG-direction result (voice dropped more
  than bass). Root-caused it live: Studio's merge mode also auto-fetches a
  real (never-reused) background track via `amix`, so the on/off jobs each
  got a *different* random real track — an artifact of the test, not the
  filter. Re-verified by calling `processJob` directly with no music mixed
  in (matching the selftest's existing empty-audio-dir pattern) — got the
  expected ~7.4dB relative improvement, consistent with the isolated test.
- **Made it a permanent regression guard**, not just an ad hoc check: added
  a `measureBandRmsDb()` helper and a `reduce-background-music` scenario to
  `scripts/selftest.js` that generates the same tone-mix clip, runs
  `processJob` on/off, and asserts the relative improvement exceeds 3dB
  (well below the measured ~7.4dB, so it fails loudly if a future change
  breaks the filter chain). Full suite: 13/13 PASS.
- README updated with an honest "what it does / doesn't do" section.

## Work log

- `videoProcessor.js` — `reduceBackgroundMusic` option + JSDoc; filter chain
  inserted into the existing merge-mode per-clip audio branch.
- `server.js` — parses `reduceBackgroundMusic` form field, gated to
  `mode === 'manual' && audioMode === 'merge'`; threaded through to
  `processJob`; decision log updated.
- Client — `ConfigPanel.jsx` gained a checkbox shown only when Merge Audio
  Levels is selected; `StudioPage.jsx` wired state + FormData.
- `scripts/selftest.js` — `measureBandRmsDb()` + permanent regression
  scenario (13th scenario, all green).
