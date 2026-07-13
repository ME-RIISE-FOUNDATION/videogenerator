# Task: Automatic Video Generator (one-click professional mode)

**Status:** COMPLETE 2026-07-11 (full version, music-only audio).
**Builds on:** [[highlight-video-editor]], [[internet-music-fetch]], [[unique-music-per-video]]

## Goal

A second page — "Auto Generator" — reachable from a button on the main studio.
The user only drops media and clicks Generate. The system decides everything
(layout, pacing, transitions, motion, music, polish) and produces a noticeably
more professional result than the manual studio's defaults.

## What "automatic + professional" means concretely

Server-side decisions when `mode=auto`:

1. **Auto layout** — probe every file's dimensions; majority orientation wins
   (tie → landscape).
2. **Ken Burns motion on photos** — stills are no longer static 3s frames:
   cover-crop to fill the frame (no black bars) + slow `zoompan` (randomly
   zoom-in or zoom-out per photo). This is the single biggest "pro" upgrade.
3. **Blur-fill for videos** — instead of black letterbox bars, mismatched
   clips sit on a blurred, scaled copy of themselves (split → blur background
   cover + sharp foreground overlay). The standard social-media pro look.
4. **Auto pacing** — long clips are trimmed to their MIDDLE segment (more
   likely to contain the action), capped per vibe (4–6s), so the reel keeps
   moving. All duration/offset math uses the capped durations.
5. **Curated transitions** — no random circlecrop/wipes; a weighted pool of
   mostly `fade` with occasional `fadeblack`/`smoothup`/`slideleft`, for a
   consistent editorial style.
6. **Edge polish** — 0.5s fade-in from black, 1s fade-out to black at the end,
   music fades in 1s and out 2s, and a subtle color grade
   (`eq contrast=1.05 saturation=1.12`) on the final stream.
7. **Music** — auto-fetched (existing no-reuse pipeline), original clip audio
   muted (music-only is the professional default), query set by the vibe.
8. **Vibe presets** (the ONLY choice on the auto page):
   - *Dynamic* — "upbeat energetic instrumental", 4s clip cap
   - *Cinematic* — "cinematic orchestral instrumental", 6s clip cap
   - *Chill* — "calm acoustic instrumental", 5s clip cap
9. **Order** — upload order is kept (chronology reads as intentional editing).

## Implementation

### `videoProcessor.js`
- `processJob` gains an optional `style` object:
  `{ kenBurns, blurFill, maxClipSeconds, transitionPool, edgeFades, colorPolish, musicFadeIn }`.
  All default off → manual pipeline byte-for-byte unchanged.
- Image chain (kenBurns): input WITHOUT `-loop` (single frame);
  `scale=2W:2H cover → crop → zoompan (d=90, s=WxH, fps=30, in/out variant) →
  setsar=1 → format`. Duration stays 3s so offset math is untouched.
- Video chain (blurFill): optional middle `trim` first, then
  `split → [bg] scale-cover+crop+boxblur → [fg] scale-decrease →
  overlay centered → setsar=1,fps=30,format`.
- After the xfade chain: optional `fade in/out` + `eq` polish before `[vout]`.
- Merge-mode audio segments honor the same trim window (correctness even
  though auto mode ships with mute).

### `server.js`
- New fields: `mode` (`manual` default | `auto`), `vibe`. When auto: probe
  orientations → layout; force audioMode=mute; vibe → musicQuery + style
  flags passed to `processJob`.

### Client
- Tiny hash router in `App.jsx` (no new deps): `#/auto` renders the new page;
  header nav switches between **Studio** and **Auto Generator**.
- Shared `useRenderJob` hook extracted from App (POST + socket lifecycle) so
  both pages reuse it; new `AutoGenerator.jsx` = dropzone (reuses
  UploadQueue) + vibe picker + Generate + existing Progress/Preview/warnings.

### Verification
- Selftest: new offline auto-style scenario (kenBurns + blurFill + trim cap +
  edge fades on an 8s clip → asserts the capped duration math) — network not
  required.
- Full-stack E2E: POST `mode=auto` with mixed media → complete → ffprobe
  duration/streams; visually inspectable output in `server/output/`.
- Client build; README + this file updated.

## Out of scope (MVP)
- Beat-synced cuts, face-aware cropping, AI highlight detection, per-clip
  volume ducking, react-router. All possible later.

## Work log

- **`videoProcessor.js`** — `style` option implemented exactly as planned
  (kenBurns via 2x cover-crop + zoompan with random in/out expressions on a
  single-frame input; blurFill via split → boxblur cover background + sharp
  overlay; middle-window trim honored in BOTH video and merge-audio chains;
  weighted transitionPool; post-chain fade-in/out + eq grade routed through a
  `vchain` label; optional music afade-in). Manual pipeline unchanged when
  `style` is empty.
- **`server.js`** — `mode`/`vibe` fields; auto mode probes orientation votes
  for layout, forces mute, maps vibe → musicQuery + clip cap, passes
  AUTO_STYLE. Decisions logged per job ("auto decisions: layout=… vibe=…").
- **Client** — hash router in App (#/ Studio, #/auto Auto Generator) with
  header tabs; job lifecycle extracted to `hooks/useRenderJob.js`; shared
  `JobStatusPanels.jsx`; `StudioPage.jsx` (manual, unchanged behavior) and
  new `AutoPage.jsx` (dropzone + 3 vibe cards + one button).
- **Verification (all green)**:
  - Selftest now 8 checks, ALL PASS — new `auto-style` scenario renders
    photo + 2s clip + 8s clip with full style flags at exactly 9.00s,
    proving the cap math (3+2+5 − 2×0.5).
  - Auto-mode E2E over HTTP: "Choosing layout" stage → layout=landscape from
    1P/3L votes → "High hopes" by zero-project fetched + ledgered (jobId
    match) → output 1920x1080, 9.500s exactly (3+2+2+4 − 3×0.5), video+audio,
    HTTP 200.
  - Client build clean; running dev server picked the new page up via HMR.
- **README** updated with the two-page flow and the auto-mode feature list.
