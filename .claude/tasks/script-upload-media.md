# Task: Upload photos/videos in Script mode

**Status:** COMPLETE 2026-07-22.
**Builds on:** [[script-to-video]], [[art-style-ideograms-india]]

## Request

User wanted an upload option on the Script page — supply your own photos or
video clips, and either use them directly or let the app keep auto-generating
visuals as before ("after we upload or directly make a video").

## Design (implemented as scoped)

- Uploading is entirely **optional** and **additive** to the existing
  auto-fetch pipeline, not a replacement mode. The first uploaded file covers
  scene 1, the second covers scene 2, etc. (same upload-order convention as
  Studio/Auto). Scenes beyond the uploaded count still auto-fetch. Extra
  uploads beyond the scene count are ignored with a warning.
- Uploaded **images** behave exactly like a fetched image: Ken Burns motion,
  same caption/headline overlay.
- Uploaded **videos** are a new scene capability (scenes previously only
  supported stills/gradients). They're middle-trimmed to the vibe's
  `maxClipSeconds` cap (reusing Auto mode's pacing math) and normalized via
  blur-fill/pad exactly like a regular video item — captions/headlines draw
  on top. Their own embedded audio is never used (script mode audio is
  always narration or music, consistent with existing behavior).
- Unreadable/unsupported uploads for a given scene fall through to
  auto-fetch for that scene, with a warning — never a fatal job failure.
- Image credits only include auto-fetched scenes, never uploads (matches how
  local music files are already exempt from attribution).

## Implementation

- `videoProcessor.js` — scene items gained `videoPath`/`videoTrimStart`;
  input registration checks videoPath before imagePath before gradient;
  filter-chain gained a full video-scene branch (blur-fill or pad, trim,
  caption/headline drawn on top) — a genuinely new code path, not just
  parameter threading.
- `server.js` — `SCRIPT_IMAGE_EXTS`/`SCRIPT_VIDEO_EXTS`/
  `DEFAULT_SCENE_CLIP_CAP`; per-scene loop now checks `files[i]` (the
  already-uploaded, already-multer-parsed array) before falling through to
  `fetchSceneImage`; video uploads get probed and capped like Auto mode;
  precise `gradientFallbackCount` tracking (previous "no images" warning
  logic was too coarse — suppressed entirely if ANY scene had an upload,
  even if other scenes silently fell back to gradients; fixed to count
  actual gradient fallbacks).
- Client — `UploadQueue.jsx` gained optional `title`/`orderHint`/`footer`
  props (defaults unchanged, so Studio/Auto are untouched) so ScriptPage
  could reuse it with scene-specific copy instead of duplicating the
  component. `ScriptPage.jsx` wires an upload queue + files state into the
  existing FormData submission.

## Verification (all green)

- Selftest: 12/12 PASS — new `script-uploaded-media` scenario (uploaded
  photo scene + uploaded video scene capped/trimmed from 8s→4s, both with
  headline captions — the video+caption combination was a previously
  untested code path). Frame extraction confirmed a clean caption overlay on
  real (synthetic-test) video content, with the burned-in timecode proving
  the middle-trim math.
- Full-stack E2E over real HTTP/Socket.io: 3-scene script, uploads covering
  only scenes 1–2 (photo + video), scene 3 left to auto-fetch. Server
  decision log confirmed exactly `uploaded=2, fetched=1, gradient=0`; image
  credits count was exactly 1 (only the fetched scene). Frame extraction
  from the real render confirmed scene 1 shows the uploaded photo and scene
  2 shows the uploaded video with a timecode matching the Chill vibe's 5s
  cap trim math (8s clip → trim start 1.5s → visible timecode ~5.3s at
  3.8s into the scene). One test-script assertion (its own stage-tracking
  Set) missed a fast early Socket.io event due to join-timing — a test
  artifact, not a product bug, definitively ruled out via the server's own
  decision log and the rendered frames.
- README updated.
