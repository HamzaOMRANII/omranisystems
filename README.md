# omranisystems.com — homepage + access-code gate

One Node app (Express, run by PM2 behind Nginx, like the portfolio and the password manager):

- **Homepage** — the logo, then the app icons (Pass, Chat, AI, IT, Gym).
- **Code gate** — clicking an app asks for its code, then opens the subdomain.
- **Direct-visit protection** — someone who types `pass.omranisystems.com` themselves is sent back to the code screen. The check runs in Nginx on the server, so it cannot be skipped from the browser.

```
omranisystems-web/
├── server.js            homepage, /api/unlock, /gate/verify
├── apps.json            list of apps (id, name, url, protected)
├── .env.example         settings + one hashed code per app
├── scripts/hash-code.js turns a code into a hash for .env
├── public/              index.html, style.css, app.js, favicon.svg
└── deploy/nginx/gate.conf   Nginx snippet that protects a subdomain
```

## How it works

1. A visitor clicks **Pass** and types the code.
2. The server checks the code against the hash in `.env` and sets a signed cookie, `os_gate_pass`, valid for `.omranisystems.com` and all subdomains for 12 hours.
3. The browser goes to `https://pass.omranisystems.com`.
4. On **every** request to that subdomain, Nginx first asks the gate (`/gate/verify?app=pass`):
   - valid cookie → 204 → Nginx serves the password manager;
   - no cookie, expired or forged → 401 → Nginx redirects to `https://omranisystems.com/unlock?app=pass`, which opens the code box.

Each app has its own code and its own cookie: unlocking Pass does not unlock Chat. After 5 wrong codes, that visitor (IP) is blocked for 15 minutes for that app.

---

## 1. Put the code on GitHub

Create a new repository `omranisystems-web` in GitHub Desktop, copy this folder into it, then commit and push. `.env` and `node_modules` are ignored on purpose.

## 2. Install on the VPS

The main site already lives in `/projects/omranisystems` (the blank page). Replace it with this app:

```bash
cd /projects
mv omranisystems omranisystems-old            # keep the blank page, just in case
git clone git@github.com:<your-user>/omranisystems-web.git omranisystems
cd omranisystems
npm install --omit=dev
cp .env.example .env
```

## 3. Set the secret and the codes

```bash
# 1) secret used to sign the cookies — paste the output into GATE_SECRET in .env
node -e "console.log(require('crypto').randomBytes(48).toString('hex'))"

# 2) one hash per app — paste each output after CODE_PASS=, CODE_CHAT=, ...
npm run hash -- 482915
npm run hash -- 730264
npm run hash -- 118733
npm run hash -- 905521

nano .env          # paste the values, Ctrl+O, Enter, Ctrl+X
chmod 600 .env
```

Only the hash is stored, never the code itself. To change a code later, generate a new hash, update `.env` and run `pm2 restart omranisystems`.

## 4. Run it with PM2

Add this entry to `/projects/ecosystem.config.js`, next to portfolio and password-manager:

```js
{ name: "omranisystems", cwd: "/projects/omranisystems", script: "npm", args: "start",
  env: { NODE_ENV: "production" } },
```

```bash
pm2 start /projects/ecosystem.config.js --only omranisystems
pm2 save
curl -I http://127.0.0.1:4000        # 200
```

## 5. Nginx

**5.1 Add the gate snippet**

```bash
cp /projects/omranisystems/deploy/nginx/gate.conf /etc/nginx/snippets/gate.conf
```

**5.2 Main site → the Node app.** In the `server_name omranisystems.com;` block, replace the `root` / `index` / `location` lines with:

```nginx
    location / {
        proxy_pass http://127.0.0.1:4000;
        include snippets/proxy-app.conf;
    }
```

**5.3 Protect each subdomain.** Example for Pass; do the same in every app's server block, changing only the `set $gate_app` value:

```nginx
server {
    listen 443 ssl http2;
    listen [::]:443 ssl http2;
    server_name pass.omranisystems.com;
    include snippets/ssl-cloudflare.conf;

    set $gate_app pass;                 # id from apps.json
    include snippets/gate.conf;

    location / {
        auth_request /__gate;           # ask the gate first
        error_page 401 = @unlock;       # no valid code -> code screen
        proxy_pass http://127.0.0.1:11000;
        include snippets/proxy-app.conf;
    }
}
```

**5.4 Apply**

```bash
nginx -t && systemctl reload nginx
```

## 6. Test

| Test | Expected |
| --- | --- |
| Open https://omranisystems.com | logo + 4 app icons |
| Click **Pass**, wrong code | "Wrong code" |
| Click **Pass**, right code | opens pass.omranisystems.com |
| Private window → type https://pass.omranisystems.com | sent to the code screen for Pass |
| Unlock Pass, then type https://chat.omranisystems.com | asks for the Chat code |

From the server:

```bash
curl -s -o /dev/null -w "%{http_code} %{redirect_url}\n" https://pass.omranisystems.com
# 302 https://omranisystems.com/unlock?app=pass
```

## Add a new app later

1. Cloudflare DNS: add an `A` record for the subdomain → 37.60.240.195, **Proxied**.
2. `apps.json`: add `{ "id": "docs", "name": "Docs", "url": "https://docs.omranisystems.com/", "protected": true }`.
3. `.env`: add `CODE_DOCS=` + `npm run hash -- <code>`.
4. `public/index.html`: copy one `<button class="app">` block, change `data-app`, `data-name`, colors and label.
5. Nginx: new server block with `set $gate_app docs;` as in 5.3.
6. `pm2 restart omranisystems` and `nginx -t && systemctl reload nginx`.

To make an app public (no code), set `"protected": false` in `apps.json` and leave `auth_request` out of its Nginx block.

## Good to know

- The gate is in front of the app, not a replacement for its own login. Keep the password manager's master password.
- The cookie is `HttpOnly`, `Secure`, signed with `GATE_SECRET`. Changing `GATE_SECRET` logs everyone out of every app.
- Visitors' real IPs (for the 5-tries limit) come from the Cloudflare real-IP file already in `/etc/nginx/conf.d/`.
- If an app uses WebSockets, `auth_request` still works: the cookie is checked when the connection opens.
