# Production deployment (video.meriise.org)

## Context
User deployed the project to **Hostinger shared hosting (hPanel)** — confirmed
from response headers (`platform: hostinger`, `panel: hpanel`, `Server: hcdn`) —
and got a **403 Forbidden**. Root cause: shared hosting serves static/PHP only;
it can't run this app's Node + FFmpeg backend, and the raw upload had no built
`index.html` at the doc root (so the server refused the directory → 403).

User chose: **get it on a VPS/Node host properly** (plan type they have: unsure).

## Change made (code) — single-origin serving
`server/server.js` now serves the built frontend so the whole app is one service
on one origin (UI + `/api` + `/output` + Socket.io on the same host):
- New `CLIENT_DIST = ../client/dist` constant.
- `app.use(express.static(CLIENT_DIST))` (guarded by `fs.existsSync`, so dev is
  unaffected — Vite still serves the UI there).
- SPA fallback `app.get('*', …)` after the API routes, excluding
  `/api`, `/output`, `/socket.io`, returning `client/dist/index.html`.

Verified locally: after `npm run build` in client, `GET http://localhost:5000/`
serves the app HTML (previously "Cannot GET /"), and `GET /api/health` still
returns JSON. Dev servers (Vite 5173 + backend 5000) still run as before.

## Deliverable
`DEPLOY.md` at repo root — full VPS runbook (Ubuntu + Node 20 + pm2 + nginx +
certbot), including the two things that bit us earlier:
- `client_max_body_size 0` + long proxy timeouts + `proxy_request_buffering off`
  for large video uploads (avoids 413 / dropped uploads).
- websocket upgrade headers for `/socket.io`.
Also documents: FFmpeg is bundled (no system install), fonts to apt-install, the
DNS A-record repoint off shared hosting, and a managed-host alternative.

## Known limitation on Linux
TTS narration uses Windows SAPI (PowerShell) — not available on Linux; Avatar/
News/Script "Computer voice" degrades to music-only automatically. Studio/Auto
(file modes, incl. the new total-length control) work fully.

## Open decisions / next steps for the user
- Get a VPS (Hostinger KVM or similar) OR pick a managed Node host.
- Repoint `video.meriise.org` A record to the new server IP.
- Follow DEPLOY.md.

## Status: code ready; awaiting user's host choice before any server-side steps.
