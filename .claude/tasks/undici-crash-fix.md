# Fix: server crash on network hiccup during asset fetch (undici assertion)

## Symptom
Backend process died mid-job with an uncaught error:
```
AssertionError [ERR_ASSERTION]: assert(!this.paused)
  at Parser.finish (node:internal/deps/undici/undici:7380:9)
  at TLSSocket.onHttpSocketEnd (...)
```
Happened during an auto-mode job right after "auto decisions", before the music
line — i.e. during background-music fetch/download. Node v24.17.0.

## Root cause
Known Node/undici bug: when a remote HTTPS server drops the connection while an
undici (built-in `fetch`) response body stream is **paused by backpressure**, the
parser throws `assert(!this.paused)` from an internal socket `end` event. That
throw is **outside** any `await`, so the `try/catch` around the download can't
catch it → `uncaughtException` → whole server dies (killing every in-flight job
and the UI). This is a strong candidate for earlier "Render failed / Failed to
fetch" reports too, since the server would vanish mid-request.

Trigger sites: streamed downloads via
`pipeline(Readable.fromWeb(response.body), createWriteStream(...))` in
`musicFetcher.downloadTrack` and `scriptComposer.fetchSceneImage`.

## Fixes
1. **Process safety net** (`server/server.js`): added `process.on('uncaughtException')`
   and `process.on('unhandledRejection')` handlers that log and keep running.
   Jobs still fail gracefully via their own try/catch; the server no longer dies
   on a transient network error. (pm2 in DEPLOY.md would also auto-restart, but
   now it won't need to.)
2. **Buffer downloads instead of streaming** — replaced the paused-stream
   pipeline with `Buffer.from(await response.arrayBuffer())` + `fs.writeFileSync`:
   - `server/musicFetcher.js` `downloadTrack` (dropped unused `pipeline`/`Readable`
     imports).
   - `server/scriptComposer.js` `fetchSceneImage` (dropped unused imports).
   `arrayBuffer()` consumes the body without pausing, so a dropped connection
   rejects the promise (caught normally) instead of firing the assertion. Assets
   are small (music beds a few MB, images ≤ a few MB) → safe in memory.

## Verification
- Direct calls: image download OK (76 KB), music download OK (~2 MB).
- Full auto job via HTTP API (8 imgs, totalDuration=20): music fetched, rendered
  20.00s, and **server stayed up**; log clean (no AssertionError).

## Status: fixed and verified locally. Ships with the deploy prep in
[[production-deploy]] — the same resilience matters even more on a live server.
