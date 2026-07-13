# Task: Script → Video (generate content from a written script)

**Status:** COMPLETE 2026-07-13. Narration is a THREE-way
user option — 🎤 own voice (user uploads a narration recording; scene
durations are distributed over it by word-count weight so the video fits the
voiceover), 🗣️ computer voice (per-scene Windows SAPI TTS as planned), or
🎵 music only (captions + auto-fetched song, reading-time pacing).
**Builds on:** [[auto-video-generator]], [[next-level-effects]], [[internet-music-fetch]]

## Goal

A new **📜 Script to Video** page: paste a script, pick a vibe + orientation,
click once. The app turns the script into a finished, attractive video —
visuals found automatically, captions animated, music fetched (never reused),
optionally narrated aloud.

## Pipeline

1. **Scene parsing** — blank-line-separated paragraphs become scenes (a lone
   short first line becomes the title slide). Scene duration = narration
   length + 0.8s when voiceover is on; otherwise reading time (words ÷ 2.5
   wps, clamped 3.5–8s).
2. **Visuals per scene** — keywords extracted from the scene text (stopwords
   dropped, longest words win) → **Openverse IMAGES API** (same key-free CC
   source as the music) → download → validate. Each image gets the existing
   Ken Burns motion (zoom/pan). **Offline fallback:** an animated dark
   gradient background (`gradients` lavfi source), so script videos work with
   zero network.
3. **Captions** — the scene text, word-wrapped in JS (drawtext doesn't wrap),
   rendered via `textfile=` (escaping already solved), lower-third placement,
   semi-transparent box for readability, alpha fade-in/out per scene.
4. **Narration (3-way option)** —
   - *Own voice*: one uploaded audio file (.mp3/.wav/.m4a) narrates the whole
     video; scene durations are word-count-weighted shares of the narration
     length (+1.5s outro, min 2.5s/scene) so the visuals fit the voice; music
     ducked to 0.2 underneath.
   - *Computer voice*: Windows SAPI TTS via PowerShell (`System.Speech`, no
     install), one WAV per scene, probed duration drives scene length,
     scene tracks joined with the video's acrossfade overlap, music at 0.2.
     TTS failure → warning + music-only, never a dead job.
   - *Music only*: reading-time pacing, captions carry the script.
5. **Assembly** — everything reuses the proven pipeline: vibe looks (grade /
   grain / letterbox / vignette), vibe transitions & speeds, edge fades,
   no-reuse music, progress events, history.
6. **Credits** — fetched images are CC like the music: their attributions are
   returned in the `complete` payload, shown under the player, and written to
   `output/<jobId>.credits.json` so the History page can show them too.

## Implementation

- New `server/scriptComposer.js` — parseScript, keyword extraction,
  fetchSceneImage (Openverse images), synthNarration (PowerShell SAPI),
  returns a `scenes` array.
- `videoProcessor.js` — accepts `scenes` as an alternative to `files`: new
  item type `scene` (image-with-Ken-Burns OR animated gradient, plus caption
  drawtext chain and optional narration input index for the audio graph).
- `server.js` — `mode=script` (files optional when a script is present),
  fields: `script`, `vibe`, `layout`, `voiceover`; stages: "Writing scenes" →
  "Fetching visuals" → "Recording narration" → render. Credits sidecar +
  history join.
- Client — new `ScriptPage.jsx` (#/script tab): title, script textarea, vibe
  cards, layout select, voiceover toggle, then the shared job/status panels.
- Verification — selftest: offline script scenario (gradient fallback) +
  narrated scene (duration ≥ narration, TTS-failure fallback tolerated);
  E2E: real 3-scene script over HTTP → images fetched, captions, narration,
  credits in payload, exact stream checks.

## Out of scope (MVP)
- AI-generated footage, stock VIDEO clips (all good APIs need keys), voice
  cloning / neural TTS, word-level karaoke captions, per-scene manual image
  swap. All possible later.

## Work log

- **`scriptComposer.js`** — parseScript (paragraph scenes, short-first-line
  title, sentence-chunking fallback, 20-scene cap), extractKeywords
  (stopword-filtered, longest-first), fetchSceneImage (Openverse images API,
  ffprobe-validated download, CC attribution), synthNarration (PowerShell
  System.Speech → WAV, text passed via file to dodge quoting), wrapCaption.
- **`videoProcessor.js`** — `scenes` option (item type `scene`: Ken Burns
  image OR animated `gradients` lavfi background + lower-third caption via
  textfile with alpha fade); `voiceover` option: 'file' (single track,
  apad/atrim to total) or 'tts' (per-scene WAV inputs, silence for uncovered
  scenes, acrossfade chain matching video overlap); music ducked to 0.2
  under any narration; input indexes now tracked dynamically.
- **`server.js`** — multer switched to `.fields` (media + one `voice` file,
  extension-validated per field); `mode=script` (files optional, script
  required, voice file required for voiceMode=voice); runJob script branch:
  parse → per-scene TTS (first-failure → music fallback, later failures →
  silent scene warnings) or own-voice duration distribution (word-weighted,
  +1.5s outro, 2.5s floor) → image fetch per scene → captions; credits
  sidecar `output/<jobId>.credits.json`; imageCredits in complete payload,
  snapshot replay, /api/history join, and DELETE cleanup.
- **Client** — new ScriptPage (#/script tab): textarea with scene hints,
  shared VibePicker (extracted; AutoPage refactored to use it), layout
  select, 3-way narration picker with conditional voice-file input;
  imageCredits shown as a <details> list in VideoPreview and History.
- **Verification (all green)**:
  - Selftest 10/10 PASS — new `script-scenes` (gradient + captions, exactly
    7.5s) and `script-tts` (real SAPI narration 3.78s+2.97s, render within
    0.02s of predicted; SAPI-missing machines skip with a pass note).
  - Script E2E over HTTP: TTS job — stages observed (narration 1-3/3,
    visuals 1-3/3), 3 CC images fetched, music ledgered, 17.78s output with
    title slide; own-voice job — uploaded WAV, scenes fitted, 9.51s output;
    both with video+audio streams and DIFFERENT music tracks (no-reuse).
- **README** updated (fourth page, narration modes, credits sidecar).
