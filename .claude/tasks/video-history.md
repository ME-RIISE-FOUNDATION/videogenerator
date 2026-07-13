# Task: Video history (browse every generated video)

**Status:** COMPLETE 2026-07-13 — "Both": full History tab AND a compact
recent-videos panel in the sidebar of the Studio and Auto pages.
**Builds on:** [[auto-video-generator]], [[unique-music-per-video]]

## Goal

Every generated video is kept and browsable inside the app: play it again,
download it, see when it was made and which music it used, and optionally
delete it. No new storage is needed — `server/output/` already keeps every
render forever (filename = jobId), and the music ledger already maps jobId →
track/attribution. This feature surfaces that.

## Design (MVP)

### Server
- `GET /api/history` — scan `output/*.mp4`, join each file's jobId against the
  used-tracks ledger for music attribution, return newest-first:
  `{ videos: [{ jobId, fileName, url, createdAt, sizeBytes, attribution }] }`.
  (`musicFetcher.js` exports a small `listUsedTracks(cacheDir)` for the join.)
- `DELETE /api/history/:jobId` — jobId validated against `^[A-Za-z0-9-]+$`
  (no path traversal), deletes only `output/<jobId>.mp4`. The music archive
  and ledger are untouched — a used track stays used even if its video is
  deleted.

### Client
- New **History** view (placement per review question): video cards, newest
  first — inline `<video controls preload="metadata">`, date, size, music
  credit with source link, Download button, Delete button (with confirm).
  Empty state + Refresh. Fetched on mount, so a just-finished render appears
  as soon as you open it.
- Tab added to the header nav router (`#/history`).

### Verification
- E2E: after a render, `GET /api/history` contains the new jobId with correct
  attribution; `DELETE` removes exactly that file and a re-GET confirms;
  traversal attempt (`..%2F` style id) rejected.
- Client build; README + this file updated.

## Out of scope (MVP)
- Thumbnails/poster extraction, pagination, search, renaming, persistence of
  job settings (layout/vibe) — the filesystem doesn't record those today.

## Work log

- **Server** — `GET /api/history` (output-dir scan + ledger join via new
  `listUsedTracks` export, newest first) and `DELETE /api/history/:jobId`
  (strict `^[A-Za-z0-9-]+$` id check; ledger deliberately untouched so a
  deleted video's track stays consumed).
- **Client** — `hooks/useHistory.js` (fetch/refresh/remove);
  `HistoryPage.jsx` (card grid: inline player, date, size, music credit with
  source link, Download, Delete-with-confirm, empty state, Refresh);
  `RecentVideos.jsx` compact sidebar panel (last 4, play/download,
  "View all →"), re-fetching when the page's render completes
  (`refreshKey={job.resultUrl}`); third `📼 History` tab in the hash router.
- **Verification (all green)** — live API test on the running server:
  18 videos listed with correct music joins (including the user's own 88 MB
  render); delete roundtrip removed exactly the target and re-GET confirmed;
  `..%2F..%2Fserver.js` traversal attempt → HTTP 400; endpoint reachable
  through the Vite proxy; client build clean.
- **README** updated (three-page flow, delete-vs-ledger semantics).
