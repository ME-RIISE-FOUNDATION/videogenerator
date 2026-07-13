# Task: Next-level effects & editing (per-vibe looks)

**Status:** COMPLETE 2026-07-13 (auto mode only, no manual-Studio look picker).
**Builds on:** [[auto-video-generator]]

## Goal

Auto-generated videos currently share one mild style. Give each vibe a full
editorial identity — motion, transitions, pacing AND a color look — so the
output reads as deliberately edited, not just stitched.

## Per-vibe identity (the core of this task)

| | ⚡ Dynamic | 🎬 Cinematic | 🌊 Chill |
|---|---|---|---|
| Look | **Vibrant**: contrast+, saturation++, slight sharpen | **Cinema**: teal-orange grade (colorbalance), contrast+, desat, film grain, **2.39:1 letterbox bars**, vignette | **Warm**: warm colorbalance, soft contrast, vignette |
| Transitions | punchy: slideleft/right, zoomin, circleopen, squeezeh, fade | elegant: fade, fadeblack, dissolve, fadegrays | soft: fade, dissolve, smoothup/down, hblur |
| Transition speed | fast 0.35s | slow 0.8s | relaxed 0.6s |
| Clip cap | 4s | 6s | 5s |
| Photo motion | zooms + **diagonal/lateral pans** | same, slower feel via longer xfades | same |

## Implementation

### `videoProcessor.js` — new `style` fields (all optional, manual mode untouched)
- `transitionDuration` — per-vibe xfade length (still clamped below half the
  shortest item; all offset math already parameterized on T).
- `kenBurnsPan` — expands photo motion from 2 to 4 variants: zoom-in,
  zoom-out, pan L→R and pan R→L at fixed 1.15 zoom (zoompan x/y driven by
  output-frame number).
- `look` — 'vibrant' | 'cinema' | 'warm': curated eq/colorbalance chains
  applied post-xfade (supersedes the old generic `colorPolish`, which stays
  for back-compat).
- `sharpen` — mild `unsharp` crispness (vibrant).
- `grain` — subtle animated film grain via `noise=alls=5:allf=t` (cinema).
- `letterbox` — 2.39:1-style black bars via two `drawbox` fills (12% of
  height each side on landscape, 7% on portrait); cinema only.
- Post-chain order: look → sharpen → vignette → grain → letterbox → edge
  fades (fades last so bars fade too).

### `server.js`
- `VIBES` table gains transitionDuration/transitionPool/look/sharpen/grain/
  letterbox per the matrix above; `AUTO_STYLE` keeps the shared flags
  (kenBurns, kenBurnsPan, blurFill, edgeFades, musicFadeIn).

### Client
- AutoPage vibe hints updated to describe the looks ("teal-orange film grade,
  grain + letterbox", etc.). No structural UI change.

### Verification
- All xfade names used are in FFmpeg 5.0+ (bundled binary is 6.1.1); a bad
  name would hard-fail the selftest render anyway.
- Selftest `auto-style` scenario updated to the new fields (cinema look,
  grain, letterbox, pan variants, T=0.4 → expected duration 10 − 2×0.4 = 9.2s).
- Full-stack E2E: `mode=auto&vibe=cinematic` → duration must be exactly
  3+2+2+6 − 3×0.8 = 10.6s; output probed for streams/resolution.
- Client build; README + this file updated.

## Out of scope (MVP)
- Beat-synced cuts, LUT files, speed ramps/slow-mo (needs frame interpolation
  to look good), animated text/stickers, per-clip AI highlight selection.

## Work log

- **`videoProcessor.js`** — new style fields exactly per plan:
  `transitionDuration` (feeds the existing clamped-T math), `kenBurnsPan`
  (2 extra zoompan variants: L→R / R→L pans at fixed 1.15 zoom driven by
  `on`), `look` ('vibrant'|'cinema'|'warm' — module-level LOOKS table of
  eq/colorbalance chains; supersedes legacy colorPolish), `sharpen`
  (unsharp 5:5:0.6), `vignette` (angle=PI/6), `grain` (noise=alls=5:allf=t),
  `letterbox` (two drawbox fills: 12% landscape / 7% portrait). Post-chain
  order: grade → sharpen → vignette → grain → bars → edge fades last.
- **`server.js`** — VIBES restructured to carry a full per-vibe `style`
  (pacing, transition set + speed, look, effects); AUTO_STYLE keeps the
  shared flags; decisions log now includes look and xfade speed.
- **Client** — AutoPage vibe hints describe each identity. Build clean.
- **Verification (all green)**:
  - All new xfade names (zoomin, squeezeh, dissolve, fadegrays, hblur,
    smoothdown) confirmed present in the bundled FFmpeg 6.1 enum.
  - Selftest 8/8 PASS — auto-style scenario now runs the FULL stack (cinema
    grade, grain, letterbox, vignette, sharpen, pans, T=0.4) and lands at
    exactly 9.20s (10 − 2×0.4).
  - Cinematic E2E over HTTP: output exactly 10.600s (13 − 3×0.8) at
    1920x1080 with audio; "A Good Dream" by Jesse Keller fetched + ledgered
    (5→6); decisions log shows look=cinema, cap=6s, xfade=0.8s.
- **README** updated with the per-vibe identity matrix.
