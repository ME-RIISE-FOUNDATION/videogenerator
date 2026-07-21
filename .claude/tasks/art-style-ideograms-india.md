# Task: Art-style picker + ideogram headlines + India-themed imagery

**Status:** COMPLETE 2026-07-21.
**Builds on:** [[script-to-video]], [[next-level-effects]]

## What the user flagged

1. Script videos print the ENTIRE script paragraph on screen — too much text.
2. Wants "ideograms" (pictogram icons) used in the videos.
3. Wants an Art-style option (like the screenshot: Photo / Illustration /
   Abstract cards) available on ALL generation tabs.
4. Fetched images should be India-related.

## Design

### 1. Captions → headline + ideogram (Script tab)
- Default changes from full-paragraph captions to a **short headline**: the
  scene's 2–3 keywords title-cased (e.g. "Golden Temple Sunrise") topped by a
  large **ideogram icon** — an emoji matched from a curated keyword→emoji map
  (~120 entries incl. India-specific: temple 🛕, diwali 🪔, yoga 🧘,
  cricket 🏏, monsoon 🌧, spice 🌶 …) with a per-scene fallback set.
  Rendered as an icon-above-label lockup via two drawtext layers: the icon
  uses Segoe UI Emoji (`seguiemj.ttf`, monochrome pictogram outlines — clean
  on video), the label uses the regular font. Missing emoji font → label only.
- New **Captions** option on the Script tab: `Headline + icon (default)` /
  `Full text` (old behavior) / `None`. Narration always still speaks the
  full script — captions are now accents, not subtitles.

### 2. Art-style picker (ALL generation tabs)
Chip-style picker modeled on the screenshot: ✨ Suggested · 📷 Photo ·
🎨 Illustration · 🖼 Artwork · 🌀 Abstract. One component, adaptive meaning:
- **Script tab** — controls WHAT is fetched: maps to the Openverse images
  `category` filter (photograph / illustration / digitized_artwork) plus a
  style keyword ("abstract" adds the keyword, no category). Also nudges the
  color look (Illustration→vibrant, Artwork→cinema, Abstract→warm).
- **Auto tab** — overrides the vibe's color look when not "Suggested"
  (Photo→natural i.e. no grade, Illustration→vibrant, Artwork→cinema,
  Abstract→warm).
- **Studio tab** — same look mapping; gives manual mode its first look
  control. Hint text on each tab says exactly what the choice does there.

### 3. India-themed imagery (Script tab)
- New **Image theme** text field, default **"India"**, appended to every
  scene's image search (e.g. "temple sunrise" → "temple sunrise India").
  Clearable for non-India videos; sent as `imageTheme`.

## Implementation
- `scriptComposer.js` — `buildHeadline(text)` (keywords → Title Case +
  emoji), `fetchSceneImage` gains `style` (category/keyword mapping) and
  `theme` (appended to query).
- `videoProcessor.js` — scene items accept `headline {icon, label}` OR the
  existing `captionFile`; icon drawn with `seguiemj.ttf` when present.
- `server.js` — new fields `artStyle`, `imageTheme`, `captionMode`;
  script branch builds captions per mode and passes style/theme to the
  fetcher; look overrides applied for all three modes.
- Client — new `ArtStylePicker.jsx` chip row on Studio, Auto and Script;
  Script adds Captions radio + Image-theme input (default "India").
- Verify — selftest: headline-scene render (icon+label lockup) offline;
  E2E: script job with artStyle=illustration & theme=India → assert fetch
  queries hit and render completes; client build.

## Work log

- **Empirical discovery (important, saved real debugging time later):**
  before writing any rendering code, tested drawtext emoji rendering
  directly against the bundled FFmpeg. Confirmed: (1) the regular UI font
  (Arial) has NO glyphs for these symbols at all — renders a blank "tofu"
  box; Segoe UI Emoji renders a clean monochrome outline icon via
  libfreetype. (2) Single-codepoint emoji (🛕 🪔 👪) render perfectly;
  multi-codepoint sequences do NOT compose — a ZWJ family emoji rendered as
  4 overlapping glyphs, and a flag (regional-indicator pair) rendered as the
  literal letters "IN". Decision: EMOJI_MAP restricted to single-codepoint
  entries only (fixed `family` and `india` which originally used unsafe
  sequences); icon layer uses a dedicated emoji-font lookup, never the
  regular UI font.
- **`scriptComposer.js`** — EMOJI_MAP (~120 single-codepoint entries,
  India-aware: temple 🛕, diwali 🪔, monsoon 🌧, cricket 🏏, etc.),
  FALLBACK_ICONS, `buildHeadline(text, sceneIndex)` → {icon, label} (2–3
  keyword Title Case + matched icon, plain-text label needs no filter
  escaping). `fetchSceneImage` takes `style` (photo/illustration/artwork →
  Openverse category, abstract → keyword) and `theme` (appended to query).
  Found via live API testing that a specific 3-4 word scene query + a
  category filter + a theme word often returns ZERO results (e.g.
  "illustration" category + "India" theme = 0/0/15 across three narrowing
  levels) — added a 3-step broadening retry (styled+themed →
  themed-no-category → theme-alone) so a themed image is used whenever one
  exists at all, refactored into a reusable `searchOpenverseImages` helper.
- **`videoProcessor.js`** — EMOJI_FONT_CANDIDATES + `findEmojiFont()`
  (Segoe UI Emoji on Windows); scene items carry `headlineIconFile`/
  `headlineLabelFile` alongside the existing `captionFile` (mutually
  exclusive per scene — full-text caption, headline lockup, or neither).
  Icon+label drawn as two stacked drawtext layers (icon large & centered
  ~h*0.58, label below ~h*0.80, both boxed for readability, same alpha
  fade-in/out timing as before). Missing emoji font degrades to label-only
  with a warning; missing regular font omits all on-screen text.
- **`server.js`** — `ART_STYLES`/`ART_STYLE_LOOK`/`applyArtStyleLook()`
  shared across all 3 modes (Studio, Auto, Script): "suggested" leaves the
  mode's own default, "photo" clears any look (natural), the rest map to
  named grades. New fields `artStyle`, `imageTheme` (default "India"),
  `captionMode` (default "headline") parsed and threaded through; script
  branch builds headline/full/none per scene and passes style+theme into
  `fetchSceneImage`; decision logging extended.
- **Client** — new `ArtStylePicker.jsx` (pill-chip row matching the
  reference screenshot) added to Studio, Auto and Script sidebars, each with
  its own hint text explaining what it does on that page; ScriptPage gained
  a Captions radio group (Headline+icon default / Full text / None) and an
  Image theme text input pre-filled "India". Client builds clean.
- **Verification (all green)**:
  - Selftest 11/11 PASS — added `script-headline`: renders two gradient
    scenes through `buildHeadline()` + the new icon/label drawtext chain,
    fully offline; extracted real video frames afterward and visually
    confirmed clean icon+label lockups ("🛕 Temple Bells Rang", "🪔 Families
    Gathered Celebrate").
  - Full-stack E2E, artStyle=illustration + imageTheme=India +
    captionMode=headline (default): first run legitimately returned 0
    images (the sparsity problem above, observed live) — fixed with the
    broadening retry, re-ran and got 2 real India-themed photos ("Junagadh,
    Girnar Hill, pilgrims climbing the mountain", "Inde India children
    enfant"). Extracted a frame from the real render: confirms a real
    fetched photo + Ken Burns + cinematic letterbox bars + a small
    river/valley icon + the 3-word headline "Pilgrims Gathered River" — NOT
    the full paragraph. Re-ran the full 11-scenario selftest after the
    `fetchSceneImage` refactor — still 11/11.
- **README** updated: Art style chip row documented on all 3 tabs; Script
  page's Captions options, Image theme field and the broadening-search
  behavior documented.
