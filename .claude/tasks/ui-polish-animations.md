# Task: UI polish + animations

**Status:** COMPLETE 2026-07-13 — "Sleek & premium" direction approved.
**Builds on:** all four pages (Studio / Auto / Script / History)

## Goal

Make the app visually striking and alive: modern glassy dark UI with motion
everywhere it helps — and nowhere it hurts (respects
`prefers-reduced-motion`, zero new dependencies, CSS-only).

## Design upgrades

1. **Living background** — two large blurred color blobs ("aurora") drifting
   slowly behind the content on every page; content sits on glassy cards
   (`backdrop-blur`, translucent borders, soft shadows, `rounded-2xl`).
2. **Header** — gradient logo text with a subtle glow; nav tabs get an
   animated active pill, hover lift, and the page content cross-fades on tab
   switch (`key={route}` + fade-in-up).
3. **Cards & controls** — staggered fade-in-up on page load; hover lift +
   border glow on interactive cards (vibe/narration options get a selected
   ring); buttons: gradient, hover brightness, pressed scale, and a soft
   pulsing glow on the primary Generate buttons while idle.
4. **Upload dropzone** — real drag-over state (highlight + scale + icon
   bounce), thumbnails pop in with a spring, numbered badges scale in,
   remove button micro-interactions.
5. **Progress** — gradient bar with an animated shimmer stripe and a soft
   pulsing status dot; percentage ticks smoothly.
6. **Result** — success card slides in with a ✓ scale-in; history cards get
   hover lift; recent-videos rows slide on hover.
7. **Details** — custom slim scrollbar, selection color, smooth focus rings,
   `prefers-reduced-motion: reduce` disables all decorative motion.

## Implementation

- `tailwind.config.js` — extend with keyframes/animations: `fade-in-up`,
  `pop-in`, `shimmer`, `aurora-a/b`, `glow-pulse`, `bounce-soft`.
- `index.css` — aurora blobs, scrollbar, selection, reduced-motion guard.
- Component class updates across App, UploadQueue, ConfigPanel, VibePicker,
  ProgressBar, VideoPreview, JobStatusPanels, StudioPage, AutoPage,
  ScriptPage, HistoryPage, RecentVideos. No logic changes, no new deps.

## Verification
- `npm run build` clean; dev server HMR check on all four routes; reduced-
  motion query present; no bundle-size jump beyond CSS.

## Work log
- `tailwind.config.js` — 7 keyframes/animations added (fade-in-up, pop-in,
  shimmer, aurora-a/b, glow-pulse, bounce-soft).
- `index.css` — shared `.glass-card` component class (rounded-2xl +
  white/10 border + translucent bg + backdrop-blur + shadow), custom slim
  scrollbar, indigo selection color, `prefers-reduced-motion` kill-switch.
- `App.jsx` — fixed aurora background (two drifting blurred glows), gradient
  headline, glassy nav with gradient active pill, `key={route}` page
  cross-fade; tab labels shortened to fit four tabs.
- Components — all cards on `.glass-card`; UploadQueue gained a real
  drag-over state (highlight/scale/icon bounce) + staggered pop-in
  thumbnails + gradient badges; ProgressBar: ping status dot + gradient bar
  with shimmer stripe; VideoPreview: ✓ pop-in + gradient download button;
  vibe/narration cards: hover lift + selected ring; primary Generate buttons:
  gradient + glow-pulse when ready + press scale; History cards: staggered
  entry + hover lift; RecentVideos rows: hover slide.
- Verified: `npm run build` clean (CSS 29.2 kB / 5.8 kB gzip, no JS logic
  changes), dev server live with HMR. Client-only change — server untouched.
