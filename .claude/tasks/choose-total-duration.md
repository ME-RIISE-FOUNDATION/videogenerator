# Choose total video time (Studio + Auto Generate)

## Goal
Let the user pick the **total length of the finished video** in Studio (manual)
and Auto Generate modes. The renderer then paces the uploaded media to hit that
target as closely as physically possible.

Today:
- **Studio/manual**: every image = fixed 3s, every video = its native length. Total
  length is whatever the media happens to add up to — the user has no control.
- **Auto**: same, except videos are middle-trimmed to the vibe's `maxClipSeconds`
  cap (dynamic 4s / cinematic 6s / chill 5s). Still no total-length control.

Avatar mode **already** has this exact control (the 15/30/45/60 + custom "Video
Duration" picker) and the server already parses `targetDuration`/`customDuration`
— it's simply never applied to Studio/Auto. This task extends the same idea to
those two tabs.

## Design decisions

### Default = "Auto" (unchanged behavior)
The new control defaults to **Auto (fit to content)**, which is exactly today's
behavior. Only when the user picks a concrete length does the pacing logic kick
in — so nothing changes for anyone who ignores it.

### How the target is met (the pacing algorithm)
The chosen length `Ttot` is the **media** length. A title slide (if any) is 3s
**added on top** — so a 30s target with a title renders ~33s total. The title is
therefore excluded from the budget entirely.

Given the media items (title excluded) and target `Ttot`:

1. Set aside any **title slide** — it keeps its fixed 3s and is not part of the fit.
2. Budget the media items. Because each of the (M−1) transitions between media
   items overlaps `T` seconds, their durations must SUM to
   `S = Ttot + T·(M−1)` (M = media item count) to land on `Ttot` after overlaps.
   (If a title is present it adds one more boundary of `T`; that overlap is the
   only sub-second effect of the title on the media portion and is ignored.)
3. `slot = S / (media item count)`.
4. **Videos** (bounded — can shrink but not stretch past native length):
   set each to `min(nativeDuration, max(MIN_ITEM, slot))`, middle-trimming when
   native is longer (reusing the existing `trimStart` mechanism).
5. **Images / gradients** (freely settable): split the *leftover* budget
   `S − sum(videoDurations)` evenly among them, floored at `MIN_ITEM`.

Why this shape:
- All photos, or a photo/video mix → images absorb the slack → **exact** hit.
- All videos, each ≥ slot → every clip trimmed to slot → **exact** hit.
- All videos where some are shorter than slot → we can't stretch a clip without
  slow-mo, so the total **undershoots**; we emit a warning saying the media is
  shorter than the requested length. (Honest physical limit, not a bug.)
- Target too short for the item count (`slot` would fall below `MIN_ITEM`) →
  clamp every item to `MIN_ITEM` and warn the length was raised to fit N clips.

`MIN_ITEM = 1.5s`. `T` for the budget uses the mode's base transition duration
(0.5 Studio / vibe value Auto); sub-second drift only occurs when clips get so
short that `T` is auto-clamped, which is acceptable for an MVP.

### Interaction with Auto's per-vibe clip cap
When a total length is set in Auto, the fitter recomputes durations from each
clip's **native** length, so it supersedes the vibe's `maxClipSeconds` cap (they'd
otherwise fight). To do that cleanly, video items will always record their native
duration.

## Implementation

### Server — `server/videoProcessor.js`
1. Accept a new option `totalDuration` (number, default `0` = off) in `processJob`.
2. On each **video** item, store `nativeDuration` (the probed length before any
   `maxClipSeconds` cap) so the fitter has the true upper bound. (Scene items with
   `videoPath` already carry their own duration; record native there too.)
3. Add a helper `fitItemsToTotalDuration(items, totalDuration, T, warn)` that runs
   the algorithm above, mutating each item's `duration` / `trimStart` in place.
4. Call it right after `items` is assembled and the title slide is prepended,
   **before** the timeline geometry (`minDuration`, `T`, `totalDuration`) is
   computed — so all existing offset/xfade/audio math just works off the new
   durations. (`T` for the fit budget = `baseTransition`; the real clamped `T` is
   still computed afterward exactly as today.)

### Server — `server/server.js`
5. Parse an optional `totalDuration` for **manual** and **auto** modes:
   `const totalDuration = clampInt(req.body.totalDuration, 5, 600) || 0;`
   (0/blank = Auto). Add it to the `runJob` config and pass
   `totalDuration: config.totalDuration` into the `processJob({...})` call. Leave
   avatar/news/script/cinematic untouched (they size scenes by narration).

### Client — new shared component `client/src/components/DurationControl.jsx`
6. A compact control matching the Avatar picker: an **Auto** chip plus preset
   chips **15s · 30s · 45s · 60s**, plus a "Custom (15–300s)" number input.
   Default selection = **Auto**. `value` is a string of seconds, or `''` for Auto.
   Emits the chosen seconds (or `''`).

### Client — `client/src/components/StudioPage.jsx`
7. Add `totalDuration` state (default `''` = Auto), render `<DurationControl>` in
   the config column, and `formData.append('totalDuration', totalDuration)` in
   `handleGenerate`.

### Client — `client/src/components/AutoPage.jsx`
8. Same: `totalDuration` state + `<DurationControl>` in the settings card +
   append to `formData`.

(Avatar page keeps its own picker; optional future refactor to reuse
`DurationControl` is out of scope for this MVP.)

## Verification
- Studio, 4 photos, target 20s → output video stream ≈ 20.0s (exact).
- Studio, 2 photos + 1 long video, target 30s → ≈ 30.0s (images absorb slack).
- Auto, mixed media, target 15s vs 60s → measurably different, ~correct totals.
- All-short-videos + large target → undershoots with the warning shown.
- Leaving the control on **Auto** → byte-for-byte same pacing as before.
- Verify each by probing the rendered mp4's video-stream duration
  (`ffprobe … -show_entries format=duration`) and confirming the video stream
  frame count matches (no frozen-frame regression).

## Out of scope (MVP)
- Slow-motion / freeze-frame to stretch short clips to an exact target.
- Per-item manual timing.
- Refactoring the Avatar duration picker onto the shared component.

## Progress log
- **DONE** (approved: presets 15/30/45/60 + custom; title added on top).
- Server `videoProcessor.js`:
  - `processJob` now accepts `totalDuration` (destructured as `targetTotalSeconds`,
    default 0 = off) — renamed to avoid colliding with the existing local
    `totalDuration` timeline variable.
  - Video items now record `nativeDuration` (probed length before any cap) so the
    fitter knows each clip's true upper bound.
  - New module helper `fitItemsToTotalDuration(items, target, baseTransition, warn)`
    (+ `MIN_FIT_ITEM = 1.5s`): sizes videos to `min(native, slot)` with middle-trim,
    then spreads the leftover budget across images for an exact hit; warns on the
    all-videos undershoot case and on too-short targets.
  - Called right after the title slide is prepended, before timeline geometry.
- Server `server.js`: parses `totalDuration` (15–300, else 0) and passes it into
  `processJob` only for `manual`/`auto` modes (scene modes stay narration-paced).
- Client: new `DurationControl.jsx` (Auto + 15/30/45/60 chips + custom 15–300),
  wired into `StudioPage.jsx` and `AutoPage.jsx` (state + FormData field + UI).
- Verified by direct `processJob` renders (probed with ffprobe):
  - 4 imgs → 30s target = **30.00s** (900 pkts); 3 imgs → 15s = **15.00s**;
    2 imgs + 8s video → 20s = **20.00s** (images absorbed slack).
  - Default/off unchanged (3 imgs = 8.00s).
  - Undershoot: two 8s videos, 60s target → 15.47s **+ warning**.
  - Frame counts = 30fps × duration everywhere (no frozen-frame regression).
- Backend restarted; Vite HMR picked up both pages; `/api/health` OK.
