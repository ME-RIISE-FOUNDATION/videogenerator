# Deploying Highlight Reel Studio (video.meriise.org)

This app is **not** a static site and **cannot run on Hostinger shared hosting
(hPanel)**. It is a Node.js server that runs **FFmpeg** to render video, with
websockets and long-running jobs. It needs a machine where you control Node +
FFmpeg — a **VPS** (recommended) or a Node/container host.

The server now serves the built frontend itself, so the whole app runs as **one
service on one origin** (UI + `/api` + `/output` + Socket.io all on the same
host). You just run the Node server and point your domain at it.

---

## Recommended: a Linux VPS (Ubuntu 22.04/24.04)

A VPS (e.g. Hostinger KVM VPS, or any Ubuntu VPS) fits this workload best:
persistent disk for uploads/renders, real CPU for FFmpeg, no job time limits.

### 1. Point the domain at the VPS
In your DNS (Hostinger → Domains → DNS), set an **A record**:
`video.meriise.org  →  <your VPS IP>`.
This moves the subdomain off shared hosting onto the VPS. (Allow up to ~an hour
to propagate.)

### 2. Install Node.js 20 LTS + tools (as root)
```bash
apt update && apt install -y git nginx
curl -fsSL https://deb.nodesource.com/setup_20.x | bash -
apt install -y nodejs
npm install -g pm2
# Fonts for the title slide / captions / emoji ideograms:
apt install -y fonts-dejavu fonts-noto-color-emoji
```
FFmpeg does **not** need a system install — it is bundled via `ffmpeg-static`
(a Linux binary ships with the app).

### 3. Get the code and build
```bash
cd /var/www
git clone <your repo url> videogenerator   # or upload the project here
cd videogenerator
cd server && npm install && cd ..
cd client && npm install && npm run build && cd ..
```
`npm run build` creates `client/dist`, which the server auto-detects and serves.

### 4. Run the server with pm2 (keeps it alive + restarts on reboot)
```bash
cd /var/www/videogenerator/server
pm2 start server.js --name videogen
pm2 save
pm2 startup    # run the command it prints, then `pm2 save` again
```
The server listens on port **5000** (override with `PORT=... pm2 start ...`).

### 5. Put nginx in front (HTTPS + big uploads + websockets)
Create `/etc/nginx/sites-available/videogen`:
```nginx
server {
    listen 80;
    server_name video.meriise.org;

    # Large video uploads: nginx's default 1MB body limit would 413 them.
    client_max_body_size 0;        # or a cap like 4g

    # Long uploads/renders shouldn't be cut off.
    proxy_read_timeout  3600s;
    proxy_send_timeout  3600s;
    proxy_request_buffering off;   # stream big uploads straight through

    location / {
        proxy_pass http://127.0.0.1:5000;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }

    # Socket.io needs the websocket upgrade headers.
    location /socket.io/ {
        proxy_pass http://127.0.0.1:5000;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
        proxy_set_header Host $host;
    }
}
```
Enable it and reload:
```bash
ln -s /etc/nginx/sites-available/videogen /etc/nginx/sites-enabled/
nginx -t && systemctl reload nginx
```

### 6. Add HTTPS (free, auto-renewing)
```bash
apt install -y certbot python3-certbot-nginx
certbot --nginx -d video.meriise.org
```

Done — visit `https://video.meriise.org`. Studio and Auto Generate work fully.

### 7. Updating later
```bash
cd /var/www/videogenerator && git pull
cd server && npm install && cd ../client && npm install && npm run build && cd ..
pm2 restart videogen
```

---

## Known limitations on Linux (vs your Windows machine)
- **Computer-voice narration (TTS)** uses Windows' built-in voice (PowerShell
  SAPI). It does **not** run on Linux — Avatar/News/Script modes with "Computer
  voice" fall back to **music-only** automatically (a warning is shown; nothing
  crashes). "My voice" (uploaded narration) still works everywhere.
- **Studio** and **Auto Generate** — the file-upload modes, including your new
  total-length control — work fully on Linux.
- Uploaded/rendered files live under `server/uploads` and `server/output` on the
  VPS disk; size your VPS disk for the videos you expect to keep.

---

## Easier alternative: a managed Node host (Render / Railway / Fly.io)
Workable, with caveats for this workload:
- Use a **Docker** or Node service; run `npm --prefix client install && npm
  --prefix client run build` in the build step, start `node server/server.js`.
- **Disk is usually ephemeral** — rendered videos vanish on redeploy/restart
  unless you attach a persistent volume (and history reads from `server/output`).
- Free tiers **sleep** and give little CPU; FFmpeg encoding will be slow. For a
  real service, a small always-on VPS or a paid instance with a volume is better.

---

## Why not Hostinger shared hosting (hPanel)?
It serves static files and PHP only. It cannot run a persistent Node process,
cannot run FFmpeg, blocks the heavy CPU / long jobs / websockets this app needs.
The 403 you saw was the shared server refusing to serve a folder with no built
`index.html` at its root — but even fixing that would only show a dead UI with a
non-functional "Generate".
