# UIXProtocol

A lightweight reverse proxy with multi-user authentication and an optional Gemini-powered AI helper. Single Node process, single port, no frameworks.

> Ukrainian version: [README.md](README.md)

## Simple start

Four commands and you're up:

```bash
git clone <url>
npm install
npm run create-admin -- admin "your_password"
npm run start
```

Open `http://localhost:3000/admin`, sign in as `admin`, create users. Each user then visits `http://localhost:3000/` (login form) or `http://localhost:3000/<their_id>/` directly.

Requires Node.js 20+ and `npm`. The `users.db` SQLite file is created automatically in the project root on first run. The `db-secret.key` encryption key (32 bytes, gitignored) is generated at the same time — **back it up**: without it the encrypted DB fields are unrecoverable. For production, supply the key via the `UIX_DB_KEY` env var (32 bytes hex or base64) instead of the file.

## Features

- Transparent HTTP/HTTPS proxy that rewrites absolute URLs in HTML/JS responses
- Multiple users — each with their own `target_url` rendered inside an iframe
- Full credentials login (name + password) plus quick-login by the first character of the password
- Admin panel: user CRUD, grant admin rights, manage API keys
- User dashboard: change target URL, change password, add/remove Gemini API keys
- Google Gemini integration via the official `@google/genai` SDK: iframe screenshot → short test answer
- **Custom prompts** with one active prompt — stored per-user in the DB
- **Model switching**: enable/disable models in settings; cycle the active model with `Alt+C`. Requests go **only to the active model** (no fallback to other enabled models, to avoid burning quota on reserves)
- **File attachments**: any file type (PDF, images, text, audio, video, …) is stored in the DB and automatically forwarded to Gemini as context alongside the screenshot (Files API + `createPartFromUri`)
- **Gemini answer appearance variants** (Alt+V) — several named style presets (font/color/background), cycled in order
- **Appearance customisation** (font / size / color / background) for the Gemini answer, the `S` button, and the active state of the `Д` button — stored in the DB (`user_appearance` table)
- **Friend help** (Alt+F or the `Д` button) — connect a helper by name; the screenshot is sent to them, and their reply appears where the Gemini answer would. Real-time via SSE
- **Auto-accept friend requests** — a helper can set a list of names or `'*'` in `appearance.friendAutoAccept`; matching requests automatically become `active` without manual confirmation
- **User search** (`GET /me/friends/users?q=`) — for picking a helper from a list, up to 60 results with an `isOnline` flag
- **Troll mode** — admin enables it for a specific user via `PUT /users/:id/troll-mode`; shown in the `GET /users` list
- **Online status** — `isOnline` flag returned in `GET /users` (admin) and user search; online = an active SSE connection exists
- **IP rotation via laptops** — the central server can forward outbound requests to the target through one of several laptop relays (sticky per userId); the target sees the laptop's IP, not the central server's
- `Alt+G/H/M/C/F/V` keyboard shortcuts and mouse-wheel control with `Ctrl`/`Alt` modifier
- **Onboarding guide** (🤖) — an 8-step walkthrough of the main features (`S` button, Alt shortcuts, friend mode, archive, settings). Shown once on first login by default; re-enable in `Settings → Appearance → "Show onboarding guide"`
- Invisible 44×44 click zone in the top-right corner that toggles the menu
- Tab title and favicon automatically synced with the proxied site
- Responsive layout for mobile (top-bar, admin panel, user table)
- Isolated "preview" mode for unauthenticated visitors via direct link `/_p/<id>/...`

## Architecture

Code under `scripts/` is split into folders by concern. Multi-file folders expose an `index.ts` barrel (`db/`, `gemini/`), so `from '../db'` imports work as a single entry point.

```
scripts/
├── server/   server.ts (entry point), proxy.ts, static.ts,
│             relay-pool.ts (health check), websocket.ts, stream-rewrite.ts
├── api/      router.ts, helpers.ts, auth.ts, me.ts, files.ts, questions.ts,
│             admin-users.ts, friends.ts (SSE), diag.ts
├── db/       index.ts, connection.ts, crypto.ts, cipher.ts, users.ts, files.ts,
│             questions.ts, appearance.ts, errors.ts, friends.ts, migrate.ts
├── gemini/   index.ts, cache.ts, parser.ts
├── auth/     session.ts
├── shared/   constants.ts, types.ts
└── tools/    create-admin.ts, build-html.ts, decrypt.ts,
              laptop-proxy.ts (relay on a laptop, port as CLI argument)
```

### Server

**HTTP / routing:**
| File | Purpose |
| --- | --- |
| [scripts/server/server.ts](scripts/server/server.ts) | Entry: `http.createServer` + route dispatcher |
| [scripts/server/static.ts](scripts/server/static.ts) | `serveFile`, `safeJsPath` — local-file streaming |
| [scripts/server/proxy.ts](scripts/server/proxy.ts) | `performProxy`, `proxyForUser`, `proxyHandle` — reverse proxy and preview mode. Relay requests have a 10 s timeout |
| [scripts/server/relay-pool.ts](scripts/server/relay-pool.ts) | `initRelayPool`, `pickRelay`, `reportRelayFailure` — health check every 10 s, fast re-check on relay recovery, exponential backoff recovery |
| [scripts/server/websocket.ts](scripts/server/websocket.ts) | WebSocket upgrade, session validation, TLS/TCP tunnel |
| [scripts/server/stream-rewrite.ts](scripts/server/stream-rewrite.ts) | `HostStripStream` — streaming host replacement in JS responses |

**REST API (`/_uix/api/*`):**
| File | Purpose |
| --- | --- |
| [scripts/api/router.ts](scripts/api/router.ts) | Dispatcher: tries each handler group in order |
| [scripts/api/helpers.ts](scripts/api/helpers.ts) | `readJson`, `sendJson`, `getCurrentUser`, `requireAuth` |
| [scripts/api/auth.ts](scripts/api/auth.ts) | login / logout / `/_uix/api/me` / `/_uix/api/config` / `/_uix/api/users/by-name` |
| [scripts/api/me.ts](scripts/api/me.ts) | User settings: URL, keys, password, prompts, models |
| [scripts/api/files.ts](scripts/api/files.ts) | `/_uix/api/me/files/*` (CRUD/status/preload) + `/_uix/api/gemini/solve` |
| [scripts/api/questions.ts](scripts/api/questions.ts) | Question archive: list, add, edit, share |
| [scripts/api/admin-users.ts](scripts/api/admin-users.ts) | Admin CRUD over users |

**Database (`better-sqlite3`):**
| File | Purpose |
| --- | --- |
| [scripts/db/index.ts](scripts/db/index.ts) | Barrel: re-export from `users`, `files`, `appearance`, `questions` |
| [scripts/db/connection.ts](scripts/db/connection.ts) | DB open, schema, runtime `ALTER TABLE` migrations |
| [scripts/db/crypto.ts](scripts/db/crypto.ts) | scrypt password hashing + `safeParseArray` |
| [scripts/db/cipher.ts](scripts/db/cipher.ts) | Reversible field/BLOB encryption (AES-256-GCM): `encrypt`/`decrypt`, `encryptBuffer`/`decryptBuffer` |
| [scripts/db/users.ts](scripts/db/users.ts) | CRUD over `users` + `verify*` + `touchUserLastSeen` |
| [scripts/db/files.ts](scripts/db/files.ts) | CRUD over `user_files`, IDs reused (same as `users`) |
| [scripts/db/questions.ts](scripts/db/questions.ts) | CRUD over `user_questions` + `shareQuestions` |
| [scripts/db/appearance.ts](scripts/db/appearance.ts) | `getAppearance`/`setAppearance` for `user_appearance` (one JSON blob per user) |
| [scripts/db/migrate.ts](scripts/db/migrate.ts) | Standalone migration runner: `npm run migrate` — reads `migrations/*.ts\|.js`, tracks applied in `migrations_applied` |

**Gemini (via `@google/genai`):**
| File | Purpose |
| --- | --- |
| [scripts/gemini/index.ts](scripts/gemini/index.ts) | `solveWithGemini`, `preloadFiles`, `callOnce` — orchestration |
| [scripts/gemini/cache.ts](scripts/gemini/cache.ts) | In-memory cache `<apiKey>::<fileId>` → uploaded URI |
| [scripts/gemini/parser.ts](scripts/gemini/parser.ts) | `parseResultText` — short-answer extraction |

**Other:**
| File | Purpose |
| --- | --- |
| [scripts/auth/session.ts](scripts/auth/session.ts) | In-memory sessions, `uix_session` HttpOnly cookie |
| [scripts/shared/constants/gemini.ts](scripts/shared/constants/gemini.ts) | `KNOWN_MODELS`, `DEFAULT_PROMPT_TEXT`, `STRUCTURED_SUFFIX`, `QDATA_RE`, timeouts |
| [scripts/shared/constants/proxy-scripts.ts](scripts/shared/constants/proxy-scripts.ts) | Injected scripts: `KEEP_ACTIVE_SCRIPT` (visibility/focus spoof + idle jitter), `CROSS_ORIGIN_PROXY_SCRIPT` (rewrite fetch/XHR), `IP_DIAG_SCRIPT`, `TURNSTILE_STUB_SCRIPT` |
| [scripts/shared/types.ts](scripts/shared/types.ts) | `User`, `UserFile`, `SolveOptions`, `ProxyOpts`, … |
| [scripts/tools/build-html.ts](scripts/tools/build-html.ts) | Builds [pages/](pages) → [public/](public) (posthtml-include + expressions) |
| [scripts/tools/create-admin.ts](scripts/tools/create-admin.ts) | CLI to create the first admin |
| [scripts/tools/decrypt.ts](scripts/tools/decrypt.ts) | Manual decryption CLI (`npm run decrypt`) |
| [scripts/tools/laptop-proxy.ts](scripts/tools/laptop-proxy.ts) | Relay on a laptop. Port is the first CLI argument or `8787` by default (`npm run start:laptop-proxy -- 8788`) |
| [environments/environment.ts](environments/environment.ts) | Config: port, default target, session TTL, iframe permissions, `forwardProxies` |

### Client (no frameworks)

JS and HTML for each page are split by concern — the entry file imports submodules via ES modules.

| Page | HTML | Logic |
| ------------------- | ---------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------- |
| Generic login | [pages/login.html](pages/login.html) → `public/login.html` | [public/js/login.js](public/js/login.js) |
| User dashboard | [pages/user.html](pages/user.html) → `public/user.html` | [public/js/user.js](public/js/user.js) (+ `user-appearance`, `user-gemini`, `user-files-status`, `user-settings`) |
| Admin login | [pages/admin-login.html](pages/admin-login.html) → `public/admin-login.html` | [public/js/admin-login.js](public/js/admin-login.js) |
| Admin panel | [pages/admin.html](pages/admin.html) → `public/admin.html` | [public/js/admin.js](public/js/admin.js) (+ `admin-users.js`) |
| Styles | [styles/style.scss](styles/style.scss) → `public/style.css` | — |
| HTTP wrapper | — | [public/js/http.js](public/js/http.js) — `api(path, opts)` |

`user.js` module breakdown:

- [public/js/user.js](public/js/user.js) — entry, `enterAuthed`, `installFavicon`, `installShortcuts`, `initLogin`, `initModelToast`, `shortModel`
- [public/js/user-appearance.js](public/js/user-appearance.js) — `APPEARANCE_DEFAULTS`, `loadAppearance` (in-memory cache), `fetchAppearance`/`saveAppearance` (via `GET/PUT /_uix/api/me/appearance`), `applyAppearance`, `hexToRgba`
- [public/js/user-gemini.js](public/js/user-gemini.js) — `initGemini` (iframe screenshot + Gemini call via `html2canvas`)
- [public/js/user-files-status.js](public/js/user-files-status.js) — `initFilesStatus` (file-status badge + warm-up button)
- [public/js/user-settings.js](public/js/user-settings.js) — `initSettings` (tabbed modal: general, prompts, models, files, appearance)

`admin.js` is split into:

- [public/js/admin.js](public/js/admin.js) — entry, admin guard, form, `setEdit`
- [public/js/admin-users.js](public/js/admin-users.js) — `setupUsers({ tbody, errEl, fieldId, setEdit })` → `{ refresh }`, table render, `removeUser`

### Asset pipeline

HTML and CSS sources live outside `public/` and compile into it:

- **HTML**: `pages/*.html` with includes (`<include src="partials/...">`) → `public/*.html` via [scripts/tools/build-html.ts](scripts/tools/build-html.ts) (`posthtml` + `posthtml-include` + `posthtml-expressions`).
- **CSS**: `styles/style.scss` (with `@use 'base'`, `'login'`, `'user'`, `'gemini'`, `'modal'`, `'admin'`, `'responsive'`) → `public/style.css` via `sass`.
- **JS**: served as-is from `public/js/` — no bundler, plain ES modules.

`npm run build:assets` runs both stages; `npm run dev` does that plus `tsx server.ts`. Watch mode: `npm run build:html:watch` / `npm run build:css:watch` (only needed when actively editing HTML/SCSS).

### Server routes

- `/` — login form (name + password); authenticated users are redirected to `/<id>/`
- `/<id>/` — user workspace (iframe + menu) or password form for that specific user
- `/admin` — admin panel (login form, then user-management UI)
- `/_p/<id>/...` — preview proxy for unauthenticated visitors (target cookies are dropped, a `uix_preview` cookie is set)
- `/style.css` (+ `/style.css.map`) and `/favicon.ico` — static assets from `public/`
- `/js/*` — client modules from `public/js/`
- `/_uix/api/*` — REST (see below)
- everything else — fallback proxy (for absolute paths inside proxied HTML)

## Multi-laptop / IP rotation via forward-relay

The central server can forward outbound requests to the target through laptop relays so the **target sees the laptop's IP**, not the central server's. Useful to avoid the "all students come from one IP" situation.

### Architecture

```
Browser ──► central server (myapp.com)
                │
                │  proxy.ts picks a sticky laptop by userId
                │  outbound HTTP request with X-Relay-Url = target
                ▼
        local relay endpoint on the laptop (cloudflared / SSH tunnel)
                │
                │  laptop-proxy.ts reads X-Relay-Url,
                │  re-requests the target from its own network
                ▼
        target (sees the laptop's IP)
```

Sticky selection: `forwardProxies[userId % forwardProxies.length]` — one user always routes through the same laptop; otherwise the target would notice IP "jumps" within a single session and might invalidate cookies.

### On the laptop — start the relay

```bash
# 1) Clone the repo and install dependencies
git clone <repo>; npm install

# 2) Start relay + SSH tunnel in one command (port 8787 by default)
npm run start:relay

# If a different port is needed (e.g. second laptop)
RELAY_PORT=8788 npm run start:relay
```

The `start:relay` command simultaneously opens an SSH reverse tunnel to `root@178.105.54.231` and starts `laptop-proxy.ts` on the specified port. The tunnel is configured with keepalive (`ServerAliveInterval=10`, `ServerAliveCountMax=3`) and `ExitOnForwardFailure=yes` — if the port on the server is already in use, SSH exits immediately with an error instead of silently failing.

The `laptop-proxy.ts` port can also be passed as an argument without `start:relay`:

```bash
npx tsx scripts/tools/laptop-proxy.ts 8788
```

Now the port needs to be made accessible to the central server. There are three options:

#### Option A: SSH reverse tunnel (built into `start:relay`)

`npm run start:relay` already does this automatically. To open the tunnel manually:

```bash
ssh -R 8787:localhost:8787 \
  -o ServerAliveInterval=10 -o ServerAliveCountMax=3 \
  -o ExitOnForwardFailure=yes \
  root@178.105.54.231
```

From the central server's perspective the relay lives on `localhost:8787`. In `environments/environment.ts`:

```ts
forwardProxies: ['http://localhost:8787'],
```

For automatic reconnection after a drop — `autossh`:

```bash
autossh -M 0 -N -o ServerAliveInterval=10 -o ServerAliveCountMax=3 \
  -o ExitOnForwardFailure=yes \
  -R 8787:localhost:8787 root@178.105.54.231
```

`apt install autossh` (Debian/Ubuntu) or `brew install autossh` (macOS).

#### Option B: cloudflared tunnel (HTTPS, no SSH)

```bash
cloudflared tunnel --url http://localhost:8787
# you'll get https://random-name.trycloudflare.com
```

In `forwardProxies` write the full URL:

```ts
forwardProxies: ['https://random-name.trycloudflare.com'],
```

Pros: HTTPS, auto-reconnect. Cons: domain is random (a named tunnel bound to a domain is needed for a persistent URL).

#### Option C: ngrok

```bash
ngrok http 8787
# https://abc.ngrok.io
```

Free tier — HTTPS only, URL changes on restart.

### Multiple laptops = rotation across users

```ts
forwardProxies: [
  'http://localhost:8787',                  // laptop A via SSH-R
  'https://abc.trycloudflare.com',          // laptop B via cloudflared
  'https://xyz.trycloudflare.com',          // laptop C
],
```

- userId=1 → laptop B (1 % 3 = 1)
- userId=2 → laptop C (2 % 3 = 2)
- userId=3 → laptop A (3 % 3 = 0)
- userId=4 → laptop B again …

A user stays on "their" laptop between sessions, so target cookies remain intact.

### How to verify the relay is actually working

Open a proxied page → DevTools → Console. There should be 3 `[UIX-IP]` lines:

```
[UIX-IP] browser → outside (real client IP):     X.X.X.X         ← student's IP
[UIX-IP] central server → outside (direct):      Y.Y.Y.Y         ← VPS IP (bypassing relay)
[UIX-IP] via laptop relay → outside:             Z.Z.Z.Z         ← laptop's IP ✓
```

The third line is what the target sees. If it shows the central server's IP — the relay is not working (tunnel down / wrong secret / `forwardProxies` empty). If it shows the laptop's IP — everything is fine.

Implementation: [scripts/api/diag.ts](scripts/api/diag.ts) `probeViaRelay`, called from the `IP_DIAG_SCRIPT` in [scripts/server/proxy.ts](scripts/server/proxy.ts).

### Relay security

The relay listens on `0.0.0.0` — anyone who can reach the port can use the laptop as an open proxy. Tunnel through SSH (the port opens only on `localhost` of the server — not reachable externally) or restrict access via a firewall. Cloudflared and ngrok have their own authentication layer.

## Friend help (friend-help)

User A can get real-time help from user B: A presses the `S` button / `Alt+G`, the screenshot flies to B in a chat modal, B types a reply — A sees it in the same place as the Gemini answer. Real-time transport — Server-Sent Events.

### Flow

1. **A → request**: Settings → "Friends" tab → type B's name → "Request". A `friend_connections` record with `status='pending'` is created in the DB. An SSE `request` event is sent to B. **If B has configured `appearance.friendAutoAccept`** (a list of names or `'*'`) — A's request automatically becomes `active`, and an SSE `accepted` event is sent to both without manual confirmation.
2. **B → accept** (without auto-accept): sees a toast "help request from A" + a row "Accept / Decline" appears in their own "Friends" panel. Accept → `status='active'`. An SSE `accepted` event is sent to A.
3. **A → friend mode**: `Alt+F` (or click the `Д` button next to `S`) → toast "mode: FRIEND (<B's name>)", the `Д` button highlights blue.
4. **A → sends screenshot**: presses `S` / `Alt+G` / `Ctrl+wheel-up` → iframe screenshot → `POST /_uix/api/me/friends/screenshot` → an SSE `screenshot` event (with the base64 image) is sent to B. A sees "waiting for reply…" in `#geminiResult`.
5. **B → reply**: the "Friend help" modal opens automatically with the image. B types text → "Send" / `Ctrl+Enter` → `POST /_uix/api/me/friends/reply`. An SSE `reply` event is sent to A and contains `helperModel` (B's active model or `null`).
6. **A → sees the reply**: the text appears in `#geminiResult` just like a normal Gemini answer.

### Limitations

- **1 active helper per asker**. If `asAsker` already has an active connection, new requests return 400.
- **The screenshot is not stored in the DB** — it only travels over SSE. If B is offline when the screenshot is sent → A gets `409 helper is offline`.
- **Multiple tabs in B** — both receive the event (the SSE registry stores an array of `ServerResponse` per userId), so the modal opens in both. Not critical.
- **Keepalive 25 s** in SSE — to prevent cloudflared / SSH tunnels from killing idle connections. EventSource on the front-end auto-reconnects, plus a manual retry after 5 s on `onerror`.
- **last_seen** is force-updated (`force=true`) on SSE stream disconnect, if the user has no remaining active subscriptions.

### Files

- [scripts/db/friends.ts](scripts/db/friends.ts) — `requestFriendship`, `acceptFriendship`, `removeFriendship`, `getActiveHelperFor`, `listMyFriends`
- [scripts/api/friends.ts](scripts/api/friends.ts) — HTTP endpoints + in-memory SSE registry (`subscribers: Map<userId, ServerResponse[]>`)
- [public/js/user-friends.js](public/js/user-friends.js) — front-end orchestrator: SSE handler, settings panel, chat modal, sticky mode
- [public/js/user-screenshot.js](public/js/user-screenshot.js) — shared screenshot capture function used by both Gemini and friend
- [pages/partials/user/modal-friend-chat.html](pages/partials/user/modal-friend-chat.html) — modal on B's side
- [pages/partials/user/modal-settings/friends.html](pages/partials/user/modal-settings/friends.html) — "Friends" tab + how-to instructions

## Server modules — key functions

### `server/` — `server.ts` + `static.ts` + `proxy.ts`

- `serveFile(res, file)` ([static.ts](scripts/server/static.ts)) — streams a local file with `Cache-Control: no-store`; MIME picked by extension.
- `safeJsPath(reqPath)` ([static.ts](scripts/server/static.ts)) — normalises a `/js/*` path and blocks path traversal outside `public/js/`.
- `rewriteUrls(text, targetHost)` ([proxy.ts](scripts/server/proxy.ts)) — strips `https://<targetHost>` and `http://<targetHost>` from response bodies so all absolute links stay within our origin.
- `performProxy(req, res, targetRaw, pathOnly, opts)` ([proxy.ts](scripts/server/proxy.ts)) — performs the upstream http(s) request, rewrites `Set-Cookie` (drops `Domain`, `Secure`, forces `SameSite=Lax`), strips `X-Frame-Options` / `Content-Security-Policy` / `Strict-Transport-Security` / `Feature-Policy`, injects its own `Permissions-Policy` from `iframePermissions`. For `text/html` and `application/javascript` it buffers the body and runs `rewriteUrls`. Options (`ProxyOpts` from [types.ts](scripts/shared/types.ts)):
  - `sendCookies: false` — do not forward client cookies to the target
  - `stripSetCookie: true` — drop `Set-Cookie` from the upstream response (preview mode)
  - `setPreviewCookie: <userId>` — set `uix_preview=<userId>` cookie (HttpOnly, Lax)
- `proxyForUser(req, res, userId, reqPath, preview)` ([proxy.ts](scripts/server/proxy.ts)) — picks the user's `target_url` (or `defaultTarget`) and calls `performProxy`.
- `proxyHandle(req, res)` ([proxy.ts](scripts/server/proxy.ts)) — request-owner resolution order:
  1. Session (`uix_session`) → proxy for the session user
  2. `Referer` starts with `/_p/<id>/` → preview for that `id`
  3. Cookie `uix_preview` → preview for that `id`
  4. Otherwise → `403`
- `server.ts` itself is just `http.createServer` plus a flat chain of `if`s sieving `/_uix/api/*`, `/favicon.ico`, `/style.css`, `/js/*`, `/_p/<id>/`, `/admin`, `/<id>/`, and `/`. Anything else falls into `proxyHandle`.

### `api/` — `router.ts` (dispatcher) + the other route groups

`handleApi(req, res)` returns `true` if the request was handled as `/_uix/api/*`, otherwise `false` and control falls back to the `server/server.ts` router. The dispatcher itself is tiny: it tries `handleAuth` → `handleMe` → `handleFiles` → `handleQuestions` → `handleAdminUsers` and the first one to return `true` wins. Otherwise — `404`.

Bodies are read via `readJson<T>()` ([helpers.ts](scripts/api/helpers.ts)) with a 1 MB limit (30 MB for `POST /_uix/api/me/files`, 15 MB for `/_uix/api/gemini/solve` because of the base64 image). Errors serialise to `{ error: "..." }` via `sendJson(res, status, body)`.

`requireAuth(req, res)` (shared by `api-me`/`api-files`) returns the `User` or `null`, having already replied `401`. [admin-users.ts](scripts/api/admin-users.ts) layers on `requireAdmin(req, res)`, which also checks `isAdmin`.

### `db/` — `index.ts` + `connection.ts` + `crypto.ts` + `cipher.ts` + `users.ts` + `files.ts` + `questions.ts`

`db/index.ts` is a re-export of `users`, `files`, `appearance`, `questions`, so `from '../db'` imports work as a single entry point.

- `hashPassword(password)` / `verifyHash(password, stored)` ([crypto.ts](scripts/db/crypto.ts)) — scrypt (`node:crypto`), 16-byte salt, 64-byte key, format `scrypt$<salt-hex>$<hash-hex>`. Verification uses `crypto.timingSafeEqual`. **One-way** — password only.
- `encrypt(s)`/`decrypt(s)` and `encryptBuffer(b)`/`decryptBuffer(b)` ([cipher.ts](scripts/db/cipher.ts)) — **reversible** AES-256-GCM encryption for sensitive columns and BLOBs. The key comes from the `UIX_DB_KEY` env var (32 bytes hex/base64) or the `db-secret.key` file (auto-generated, `chmod 600`, gitignored). Text format is `enc:v1:<base64(iv|tag|ciphertext)>`, binary uses a `UIX\x01` magic header. Both are migration-safe: a value without the prefix/magic is returned **as-is** (legacy plaintext reads without error), and `encrypt*` is idempotent (won't re-wrap already-encrypted data).
- `firstChar(s)` ([crypto.ts](scripts/db/crypto.ts)) — `[...s][0]`, so it correctly handles Unicode codepoints (emoji, etc.).
- `createUser` / `updateUser` / `getUserById` / `getUserByName` / `listUsers` / `deleteUser` ([users.ts](scripts/db/users.ts)) — CRUD over `users`. `password_first` is written alongside `password_hash`. `updateUser` also accepts `prompts`, `activePromptId`, `enabledModels`, `activeModel`. On create, the smallest free `id` is chosen (`nextUserId()`) to reuse gaps after deletions.
- `touchUserLastSeen(userId, now?, force?)` ([users.ts](scripts/db/users.ts)) — updates `last_seen` at most once every 30 s (in-memory cache); `force=true` bypasses the limit. Called on every `getCurrentUser` (via `helpers.ts`) and on SSE stream disconnect (if no subscriptions remain).
- `listUserFiles(userId)` / `getUserFile` / `getUserFiles(userId)` / `addUserFile(userId, name, mime, data)` / `deleteUserFile(userId, fileId)` ([files.ts](scripts/db/files.ts)) — CRUD for attached files (type is not restricted: PDF, images, text, audio, video). `addUserFile` runs in a transaction and picks the smallest free `id` via `nextFileId()` — same approach as users — so deleted file IDs are reused.
- `verifyPasswordById` / `verifyPasswordByName` ([users.ts](scripts/db/users.ts)) — full password verification; on success calls `backfillFirstChar` if the column is empty.
- `verifyFirstCharById` ([users.ts](scripts/db/users.ts)) — compares one character against `password_first` (no hashing). Only works once the column is populated.
- The schema, `PRAGMA journal_mode = WAL`, and every `ALTER TABLE ADD COLUMN` migration (including `last_seen`) live in [connection.ts](scripts/db/connection.ts) — importing it readies the DB.
- Standalone file-based migration runner: [migrate.ts](scripts/db/migrate.ts) (`npm run migrate`) — loads `.ts`/`.js` files from `migrations/` in sorted order, tracks applied ones in `migrations_applied (id, name, applied_at)`. Each migration file must export `up(db)` and optionally `id` and `name`.
- Constants `KNOWN_MODELS`, `DEFAULT_PROMPT_TEXT`, and `STRUCTURED_SUFFIX` live in [constants/gemini.ts](scripts/shared/constants/gemini.ts). Current model list: `gemini-3.5-flash`, `gemini-3.1-flash-lite`, `gemini-2.5-pro`, `gemini-2.5-flash`, `gemini-2.5-flash-lite`, `gemini-3.1-pro-preview`, `gemini-3-flash-preview`.

#### Sensitive-field encryption

On top of the scrypt password hash, sensitive data is encrypted by `cipher.ts` (AES-256-GCM) before write and decrypted on read — transparently inside the `db/` functions. Encrypted columns (🔒 in the schemas below):

| Table | Columns |
| --- | --- |
| `users` | `api_keys`, `target_url`, `password_first` |
| `user_files` | `data` (BLOB) |
| `user_questions` | `image` (BLOB), `question`, `correct_answer` |

> **Existing-data migration is lazy and partial.** A legacy plaintext row reads fine but is only encrypted when the field is **rewritten** (password/URL/keys change, question edit). Columns with no rewrite path — existing `user_files.data` and `user_questions.image` — will **never** be encrypted by the lazy path. Protecting already-stored data requires a one-time pass over all rows.

`users` schema (🔒 = encrypted via `cipher.ts`):

```sql
id              INTEGER PRIMARY KEY AUTOINCREMENT
name            TEXT UNIQUE NOT NULL
password_hash   TEXT NOT NULL                -- scrypt hash (one-way)
password_first  TEXT NOT NULL DEFAULT ''     -- 🔒 (quick login; reversible)
api_keys        TEXT NOT NULL DEFAULT '[]'   -- 🔒 JSON array
is_admin        INTEGER NOT NULL DEFAULT 0
target_url      TEXT NOT NULL DEFAULT ''     -- 🔒
prompts         TEXT NOT NULL DEFAULT '[]'   -- JSON: [{id, name, text}, ...]
active_prompt_id TEXT NOT NULL DEFAULT ''
enabled_models  TEXT NOT NULL DEFAULT '[]'   -- JSON array of model names
active_model    TEXT NOT NULL DEFAULT ''
last_seen       INTEGER NOT NULL DEFAULT 0  -- Unix ms, updated via touchUserLastSeen
```

`user_files` schema:

```sql
id          INTEGER PRIMARY KEY AUTOINCREMENT
user_id     INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE
name        TEXT NOT NULL
mime        TEXT NOT NULL
size        INTEGER NOT NULL                 -- size of plaintext data
data        BLOB NOT NULL                    -- 🔒 (AES-256-GCM, magic header)
created_at  INTEGER NOT NULL
```

`user_questions` schema:

```sql
id             INTEGER PRIMARY KEY AUTOINCREMENT
user_id        INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE
image          BLOB NOT NULL                 -- 🔒
mime           TEXT NOT NULL DEFAULT 'image/jpeg'
question       TEXT NOT NULL DEFAULT ''      -- 🔒
options        TEXT NOT NULL DEFAULT '[]'    -- JSON array
correct_answer TEXT NOT NULL DEFAULT ''      -- 🔒
tags           TEXT NOT NULL DEFAULT '[]'    -- JSON array
created_at     INTEGER NOT NULL
```

`user_appearance` schema (one row per user, JSON blob with `resultFont/Size/Color/...`, `btnFont/Size/...`, `showFilesStatus`, `showModelToast`):

```sql
user_id  INTEGER PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE
data     TEXT NOT NULL DEFAULT '{}'
```

All new columns are added via `ALTER TABLE ADD COLUMN` at runtime — old DBs are migrated automatically on first boot.

### `session.ts`

- `parseCookie(req, name)` — parses the `Cookie` header.
- `setSession(res, userId)` — generates 24 random bytes (base64url) and stores `Map<sessionId, {userId, expiresAt}>`.
- `getSessionUserId(req)` — reads the cookie, checks TTL, evicts expired entries.
- `clearSession(req, res)` — removes the entry and resets the cookie via `Max-Age=0`.
- `clearSessionsForUser(userId)` — clears all active sessions for a user (called on delete).
- A `setInterval(...).unref()` sweeps expired sessions every 60 s.

### `gemini/` — `index.ts` + `cache.ts` + `parser.ts`

Uses the official `@google/genai` SDK instead of raw `fetch`. Call flow:

- `solveWithGemini({ apiKeys, imageBase64, prompt, models, files })` ([gemini.ts](scripts/gemini/index.ts)) — iterates models in user-defined order (the active model first), and for each model tries every API key. The first success returns; otherwise the last error is thrown. 20-second timeout per request, no auto-retries.
- `uploadFileForKey(client, apiKey, file)` ([cache.ts](scripts/gemini/cache.ts)) — lazily uploads a `UserFile` (BLOB from the DB) to the Gemini Files API via `client.files.upload({ file: Blob, config: { mimeType, displayName } })`. Returns `{ uri, mimeType, expiresAt }`. The result is cached in memory in `Map<"<apiKey>::<fileId>", UploadedFile>` for ~40 hours (the Files API itself keeps files for ~48h).
- The actual call: `client.models.generateContent({ model, config: { thinkingConfig: { thinkingBudget: model.includes('pro') ? 3000 : 1000 } }, contents })`. `parts` start with the prompt text, then PDF parts via `createPartFromUri(uri, mime)`, ending with the screenshot `inlineData` (JPEG base64).
- `invalidateUploadsForUser(fileIds)` ([cache.ts](scripts/gemini/cache.ts)) — called from [files.ts](scripts/api/files.ts) when a user deletes a file, clearing the cache for that `fileId` across every key.
- `dropCacheForKey(apiKey)` ([cache.ts](scripts/gemini/cache.ts)) — drops every URI for one key; called by `solveWithGemini` after a failed attempt.
- `parseResultText(text)` ([parser.ts](scripts/gemini/parser.ts)) — first looks for `Відповідь:` / `Answer:`, then for the first line matching `\d+(,\d+)*` / `\d+(;\d+)*` / `\d+-[а-яa-z]...` / `так|ні`.

If a request to one (model, key) pair fails, the URI cache for that key is reset automatically — the next attempt re-uploads the files.

## Client pages

### `/<id>/` — user dashboard ([public/js/user.js](public/js/user.js))

Flow:

1. `GET /_uix/api/me`.
2. If `me.id === id` (authenticated as this exact user) → `enterAuthed()`.
3. Otherwise → `initLogin()` — quick login.

`enterAuthed(me, { fromLogin })`:

- Shows the top-bar with the user name plus "Settings", "Admin" (admins only), "Logout".
- Wires up `barTrigger` (an invisible 44×44 click zone in the top-right corner) → click toggles the menu.
- `GET /_uix/api/config` → sets `allow="..."` on the iframe per `iframePermissions`, then sets `frame.src` to `proxyBase` (`/_p/`), unless this is a redirect right after login (`fromLogin=true` — the iframe already shows the target).
- Imports `initGemini()` ([user-gemini.js](public/js/user-gemini.js)), `initFilesStatus()` ([user-files-status.js](public/js/user-files-status.js)), `initSettings()` ([user-settings.js](public/js/user-settings.js)). Registers shortcuts / wheel and attaches `frame.addEventListener('load', syncMetaFromFrame)` to mirror the target's title/favicon.
- On entry, fetches the saved appearance from the server (`fetchAppearance` → `GET /_uix/api/me/appearance`) and applies it via CSS variables (`applyAppearance` from [user-appearance.js](public/js/user-appearance.js)).
- The settings dialog saves through several PUTs — only changed fields: `/me/url`, `/me/api-keys`, `/me/password`, `/me/prompts`, `/me/models`, `/me/appearance`. Files are uploaded/deleted live via `/me/files`.

`initLogin()`:

- Sets `frame.src = "/_p/<id>/"` so the user already sees the target before logging in (preview mode).
- Reveals a hidden `<input type="password" maxLength="1">`. The `input` event fires `POST /_uix/api/login/<id>/quick` with the single character as soon as the field has exactly one char.
- On error: adds `wrong shake` (CSS shake animation) and refocuses.

### `/` — full login ([public/js/login.js](public/js/login.js))

Plain `name + password` form → `POST /_uix/api/login` → redirect to `/<user.id>/`.

### `/admin` ([public/js/admin.js](public/js/admin.js), [public/js/admin-login.js](public/js/admin-login.js))

- If you're not an admin, the server returns `admin-login.html` with a `POST /_uix/api/admin/login` form. After success — `location.reload()` and the server returns `admin.html`.
- The admin panel: a user table (id, name, admin, target, key count), a "Create / Edit" form, and `DELETE /_uix/api/users/:id` guarded with `confirm()`.
- The table render and `removeUser` live in [admin-users.js](public/js/admin-users.js) (`setupUsers({ tbody, errEl, fieldId, setEdit }) → { refresh }`); the form and its `setEdit` stay in `admin.js`.
- During edit: an empty "Password" field keeps the existing password; API keys — one per line.

### Shared — [public/js/http.js](public/js/http.js)

`api(path, opts)` — a wrapper around `fetch('/api' + path)` with `Content-Type: application/json` and `credentials: same-origin`. Returns `null` for `204`, parses JSON, throws an `Error` with `body.error` on non-2xx.

## Keyboard shortcuts

`installShortcuts()` in [public/js/user.js](public/js/user.js) registers a `keydown` listener on `window` and **also** mirrors it into `iframe.contentDocument` (via `attachToFrame` after `load`) — so the shortcuts still fire when focus is inside the target. The handler only triggers on `Alt + key` (no `Ctrl`/`Meta`) and is **ignored** in text inputs (`INPUT`, `TEXTAREA`, `contentEditable`).

| Key     | Action                                                                                                            | Implementation                                                                                                     |
| ------- | ----------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------ |
| `Alt+G` | Take an iframe screenshot and send (Gemini or friend — depends on mode) | `triggerScreenshot()` routes between Gemini and friend |
| `Alt+H` | Show/hide the last answer | `toggleResult()` |
| `Alt+M` | Show/hide the top-bar menu | `toggleBar()` |
| `Alt+C` | Cycle the active Gemini model to the next enabled one | `cycleModel()` — `PUT /_uix/api/me/active-model`, the short name briefly appears in `#modelToast` (bottom-right corner) |
| `Alt+F` | Toggle friend mode (Gemini ↔ helper). Alternative — click the `Д` button next to `S` | `friends.toggleMode()` — requires an active helper |
| `Alt+V` | Cycle the answer appearance variant | `cycleVariant()` — changes `activeVariantId` in `user_appearance`, a toast shows the variant name |

For a cross-origin iframe target, `frame.contentDocument` will be `null` and only the outer-window listener fires. Gemini itself also requires same-origin access (the screenshot is built from the iframe's DOM via `html2canvas`).

## Mouse wheel

The same `installShortcuts()` listens for `wheel` (`passive: false`, capture) and mirrors into the iframe. It **only fires when `Ctrl` or `Alt` is held** — a plain wheel still scrolls the page normally. Cooldown is **700 ms** between actions so a long scroll doesn't spam requests.

| Gesture | Action |
| ------------------------------------------ | ------------------------------------ |
| `Ctrl`/`Alt` + wheel up (`deltaY < 0`) | `triggerGemini()` — fire Gemini |
| `Ctrl`/`Alt` + wheel down (`deltaY > 0`) | `toggleResult()` — toggle the answer |

`preventDefault` is only called when the modifier is pressed; otherwise scroll passes through to the page/iframe untouched. `Ctrl+wheel` is the default browser zoom — in this dashboard it's repurposed to trigger Gemini.

## Menu and settings

### Menu trigger

`<div id="barTrigger" class="bar-trigger">` — an invisible **44×44 px** click zone in the top-right corner (`position: fixed; top: 0; right: 0; background: transparent; z-index: 90`). The same click both opens and closes the menu (equivalent to `Alt+M`). The bar reserves `padding-right: 60px` (44 px trigger + 16 px buffer) so the "Logout" button never sits underneath the trigger.

### Top-bar

`<header id="bar">` is hidden by default and shows up after a successful login. Visibility is the `.show` class — `transform: translateY(-100%)` ↔ `translateY(0)` with a `.2s` transition.

Buttons:

- **User name** — plain text.
- **Settings** — opens a tabbed modal:
  - **General**: site URL → `PUT /_uix/api/me/url`, API keys → `PUT /_uix/api/me/api-keys`, new password (empty — keep current) → `PUT /_uix/api/me/password`.
  - **Prompts**: any number of named prompts, one chosen as active (radio). Persisted as `prompts` + `active_prompt_id` via `PUT /_uix/api/me/prompts`.
  - **Models**: checkboxes over `KNOWN_MODELS` (from `constants/gemini.ts`), a radio for the active model, plus a hint about `Alt+C`. Saved via `PUT /_uix/api/me/models`. The solve request goes **only to the active model** (no fallback to other enabled models — fallback remains only between API keys).
  - **Files**: arbitrary attachments (PDF, images, text, audio, video, …) forwarded to Gemini as context. Add via `POST /_uix/api/me/files` (base64, MIME picked by the browser), delete via `DELETE /_uix/api/me/files/:id`.
  - **Appearance** — three blocks:
    1. **Answer appearance variants** (`<select>` + `+ ✎ ×` buttons) — several named presets. The active one is applied. `Alt+V` cycles through them. Switching / adding / removing / renaming saves immediately via `PUT /_uix/api/me/appearance`.
    2. **Gemini answer** — font, size, text color, background color + opacity slider. Changes are written to the **current active variant**. Live preview via CSS variables (`--result-*`).
    3. **S button** and **Д button in friend mode (active state)** — separate color/opacity settings for both buttons. Not part of variants — these are global settings.
    4. **Indicators** — visibility checkboxes (file status, model toast, debug iframe). Pushed to the server immediately on click.

    Storage — in `user_appearance.data` (JSON blob). On first fetch, legacy flat `result*` fields are automatically wrapped into a "Default" variant (migration in [user-appearance.js](public/js/user-appearance.js#L73) `migrate()`).
  - **Friends**: request a helper by name + list of pending/active connections. Accept/decline pending requests. How-it-works instructions + control buttons. All interactions via `/_uix/api/me/friends/*` + SSE.
- **Admin** — link to `/admin` (visible only when `isAdmin=true`).
- **Logout** — `POST /_uix/api/logout`, then redirect to `/`.

### Gemini panel

The "S" button (`#screenshotBtn`) sits in the **top-left** corner (`top: 1rem; left: 1rem`). Default style: `background: transparent`, dim dark text, dual `text-shadow` (white glow + dark drop) — readable on both light and dark backgrounds. Hover boosts contrast.

The result (`#geminiResult`) sits in the **bottom-left** corner with the same transparent + text-shadow style. It auto-hides after **12 seconds**. Errors render with the same plain style — no red error variant.

Both the button and the result are themed via CSS variables (`--screenshot-font/size/color/bg`, `--result-font/size/color/bg`) populated by `applyAppearance()` using the data from the `user_appearance` table (loaded by `fetchAppearance()` after authentication). The "Appearance" tab can change font / size / color / background of either element on the fly, no reload needed.

### Tab title and favicon

The dashboard automatically picks up the proxied site's name and icon:

- **Favicon (no JS)**: [pages/user.html](pages/user.html) declares `<link rel="icon" id="favicon" href="/_p/favicon.ico">`. The browser fetches `/_p/favicon.ico` → `proxyHandle` → upstream `/favicon.ico` on the target. Works before the iframe even loads.
- **Title + custom icon paths** (`syncMetaFromFrame` in [public/js/user.js](public/js/user.js)) — on `iframe.load`:
  - `document.title = frame.contentDocument.title` (same-origin via the proxy); falls back to `me.name` if the target has no title.
  - Looks for `<link rel~="icon">` or `<link rel="shortcut icon">` inside the iframe document. If origin matches our own — substitutes `/_p<path>` (so it goes through the proxy); if it's a different-host CDN — uses the absolute URL as-is (favicons aren't subject to CORS).
- Fires on every iframe `load` — internal anchor navigation in the target also re-syncs title/favicon.

## Gemini screenshot

Client side (`initGemini` in [public/js/user-gemini.js](public/js/user-gemini.js)):

1. `getFrameWindow()` grabs `iframe.contentWindow` / `contentDocument`. Cross-origin → immediate `Error('iframe недоступний')`.
2. `ensureHtml2Canvas(win)` — injects [html2canvas 1.4.1](https://html2canvas.hertzen.com/) from CDN into `iframe.contentDocument` (the outer page already has it, included via `<script>` in [pages/user.html](pages/user.html)).
3. `captureFrame()` — `html2canvas` with `useCORS`, `allowTaint`. Captures the **full site width** (`documentElement.scrollWidth`, with `x: 0`) but only the **viewport height** (`innerHeight`, with `y: scrollY`) — so if the proxied site is wider than the phone screen, everything past the right edge is included in the screenshot, while vertically it's just the area around the current scroll position.
4. `canvasToBase64Jpeg()` — downscales to **1600 px** width, JPEG quality **0.7**, base64.
5. `POST /_uix/api/gemini/solve` with just `imageBase64`. The active prompt, active model, and file attachments are pulled from the user record on the server.
6. The answer is rendered into `.gemini-result`.

Server side ([files.ts](scripts/api/files.ts) → [gemini.ts](scripts/gemini/index.ts)):

- Picks the user's active prompt (fallback — first in the list, then `DEFAULT_PROMPT_TEXT`).
- Builds the model list: `activeModel` first, then the rest of `enabledModels`. If nothing is enabled — falls back to `gemini-2.5-flash`.
- Loads every `user_files` record for the user (any type — PDF / image / text / audio / video) and passes them into `solveWithGemini`, which calls `client.files.upload` (with URI cache per key).

Guards: a concurrent call is blocked by the `busy` flag; the button is disabled while a request is in flight.

## Responsive (mobile)

A single media block in [styles/_responsive.scss](styles/_responsive.scss) (compiled into `public/style.css`) — `@media (max-width: 640px)`:

- **Top-bar**: `flex-wrap: wrap`, `.8rem` font, `.4rem` gap. The user name gets `flex-basis: 100%` (drops onto its own row) with `text-overflow: ellipsis` for long names. Padding `.5rem 60px .5rem .75rem` — the right side is reserved for the trigger.
- **Admin panel**:
  - `.admin { padding: 1rem }` (was 2rem)
  - `.admin__header` — `flex-wrap: wrap`, the "Користувачі" heading drops to its own row (`flex-basis: 100%`), the "До свого акаунта"/"Вихід" buttons stretch to full width (`flex: 1`)
  - `.admin__spacer { display: none }` — not needed on mobile
  - `.form { max-width: 100% }`, `.form__actions` buttons get `flex: 1`
  - `.section { overflow-x: auto }` — the user table gets a **horizontal scroll** instead of cramped columns
  - In `.table` — smaller padding/font, `truncate` capped at 140 px
- **Gemini result** — `max-width: 80vw` instead of 50vw, `.85rem` font.
- **Settings modal** — `padding: 1rem` instead of 1.5rem.

## Configuration

[environments/environment.ts](environments/environment.ts):

| Field | Description |
| --------------------- | --------------------------------------------------------------------------------------------------------------------- |
| `port` | Server port (default `3000`) |
| `defaultTarget` | URL used when a user's `target_url` is empty |
| `sessionTtlMs` | Session lifetime in milliseconds (1 hour) |
| `iframePermissions` | `Permissions-Policy` features granted to the iframe (camera, microphone, …) |
| `forwardProxies` | Array of laptop relay URLs (`http://localhost:8787` for SSH-R / `https://abc.trycloudflare.com` for tunnel). Empty — no rotation, the central server goes to the target directly |
| `production` | Reserved (not yet used) |

## REST API

All responses are JSON. Errors use `{ "error": "..." }`. The `uix_session` cookie is set automatically after a successful login.

### Public

| Method | Path | Description |
| ----- | -------------------------- | ------------------------------------------------------------------------------------------- |
| POST | `/_uix/api/login` | `{name, password}` |
| POST | `/_uix/api/login/:id` | `{password}` — login by id |
| POST | `/_uix/api/login/:id/quick` | `{char}` — quick login by first character |
| POST | `/_uix/api/admin/login` | Same as `/_uix/api/login`, but rejects non-admins |
| POST | `/_uix/api/logout` | — |
| GET | `/_uix/api/me` | Current user (includes `prompts`, `activePromptId`, `enabledModels`, `activeModel`) |
| GET | `/_uix/api/config` | `{ proxyPath, iframePermissions, knownModels, defaultPrompt }` |
| GET | `/_uix/api/users/by-name/:name` | `{ id, name, targetUrl }` |

### User (session required)

| Method | Path | Body / response |
| ------ | ---------------------- | ------------------------------------------------------------------------------------ |
| PUT | `/_uix/api/me/url` | `{ url: string }` |
| PUT | `/_uix/api/me/password` | `{ password: string }` |
| PUT | `/_uix/api/me/api-keys` | `{ apiKeys: string[] }` |
| PUT | `/_uix/api/me/prompts` | `{ prompts: {id,name,text}[], activePromptId?: string }` |
| PUT | `/_uix/api/me/models` | `{ enabledModels: string[], activeModel?: string }` (filtered against `KNOWN_MODELS`) |
| PUT | `/_uix/api/me/active-model` | `{ activeModel: string }` — must be in `enabledModels` |
| GET | `/_uix/api/me/appearance` | JSON object with appearance settings (`{}` if nothing saved yet) |
| PUT | `/_uix/api/me/appearance` | Full JSON appearance object → written to `user_appearance.data` |
| GET | `/_uix/api/me/files` | `[{id, name, mime, size, createdAt}]` |
| POST | `/_uix/api/me/files` | `{ name, mime, dataBase64 }` → file metadata (30 MB cap) |
| DELETE | `/_uix/api/me/files/:id` | `204`, also clears the URI cache in `gemini/cache.ts` |
| POST | `/_uix/api/gemini/solve` | `{ imageBase64: string }` → `{ answer }`. Prompt / files come from the DB, model = active only |

### Friend-help (session required)

| Method | Path | Body / response |
| ------ | --------------------------------- | ------------------------------------------------------------------------------------------- |
| GET | `/_uix/api/me/friends` | `{ asAsker, asHelper, pendingIncoming, pendingOutgoing }` — lists by role of the current user |
| POST | `/_uix/api/me/friends/request` | `{ toName }` → create a pending request. I become the asker, the target becomes the helper |
| POST | `/_uix/api/me/friends/accept` | `{ id }` → move pending to active (only if I am the helper of this request) |
| DELETE | `/_uix/api/me/friends/:id` | `204` — either side can delete |
| POST | `/_uix/api/me/friends/screenshot` | `{ imageBase64 }` → send screenshot to the active helper via SSE |
| POST | `/_uix/api/me/friends/reply` | `{ askerId, text, messageId? }` → reply to asker; SSE event contains `helperModel` (helper's active model) |
| GET | `/_uix/api/me/friends/stream` | **SSE**. Events: `request`, `accepted`, `disconnected`, `screenshot`, `reply`. Keepalive 25 s |
| GET | `/_uix/api/me/friends/check/:name` | Check whether a user with that name exists (for UI validation before requesting) |
| GET | `/_uix/api/me/friends/users?q=` | Search users by name (up to 60, sorted, with `isOnline`) |
| GET | `/_uix/api/users-public/:id` | `{ id, name }` — public info about a user |

### IP / relay diagnostics

| Method | Path | Description |
| ----- | ----------------------- | ------------------------------------------------------------------------------------------------- |
| GET | `/_uix/api/_diag/server-ip` | IP from which the central server exits directly (bypassing the relay). Cached for 1 hour |
| GET | `/_uix/api/_diag/relay-ip` | IP from which `forwardProxies[0]` exits (i.e. the laptop's IP). Should differ from `/server-ip` |

### Admin (`isAdmin=true`)

| Method | Path | Description |
| ------ | ------------------------------ | ------------------------------------------------------------------------ |
| GET | `/_uix/api/users` | List all, with `isOnline` and `trollMode` |
| POST | `/_uix/api/users` | `{name, password, apiKeys?, isAdmin?, targetUrl?}` |
| GET | `/_uix/api/users/:id` | Single user |
| PUT | `/_uix/api/users/:id` | Partial update |
| DELETE | `/_uix/api/users/:id` | — |
| PUT | `/_uix/api/users/:id/troll-mode` | `{ value: bool }` → sets `trollMode` in that user's `user_appearance` |

## Security

- **Passwords**: scrypt (`node:crypto`), 16-byte salt, 64-byte key, verified via `timingSafeEqual`. One-way.
- **Sensitive-field encryption**: AES-256-GCM ([cipher.ts](scripts/db/cipher.ts)) for `api_keys`, `target_url`, `password_first`, file BLOBs and questions (see the DB section). Key — `UIX_DB_KEY` or `db-secret.key`; **losing the key = losing this data**, keep a backup separate from the DB. Manual decryption — `npm run decrypt` (below).
- **Quick login** by the first character only works once `password_first` is stored (stored encrypted; filled on create/password change, or backfilled on the first full login via `backfillFirstChar`). Note this is **not** equivalent to a full login (1 char → 26+ candidates), so enable it only where the trade-off is acceptable.
- **Sessions** are in-memory `Map`; restarts invalidate every session. Cookie: `HttpOnly; SameSite=Lax; Path=/`.
- **The proxy** strips `X-Frame-Options`, `Content-Security-Policy[-Report-Only]`, `Strict-Transport-Security`, `Feature-Policy` from upstream responses and injects its own `Permissions-Policy`.
- **Target cookies** with `Domain=...`, `Secure`, `SameSite=*` are normalised (forced `SameSite=Lax`, no `Domain`/`Secure`). The session cookie name (`uix_session`) is never forwarded upstream.
- **Path traversal** for static is blocked by `target.startsWith(root)` in `safeJsPath` ([static.ts](scripts/server/static.ts)).
- **Relay availability**: `laptop-proxy.ts` listens on `0.0.0.0` with no authentication. When using an SSH reverse tunnel the port opens only on `localhost` of the server — not reachable externally. With cloudflared/ngrok their own layer protects it. Do not expose the relay port directly to the internet without additional protection.
- **SSE channel** (`/_uix/api/me/friends/stream`) — requires a valid session. Registry is an in-memory `Map<userId, ServerResponse[]>`, so state does not persist across restarts. Friend screenshots via SSE are **not stored** in the DB — they only live in RAM during transit.

## Running

### Central server

```bash
# Install dependencies (once)
npm install

# Create the first admin (args or interactive)
npm run create-admin -- admin "your_password" "https://example.com"
npm run create-admin

# Start (builds front-end + server on :3000, listens on 0.0.0.0)
npm start

# Production — compile + plain node (minimal RAM)
npm run build

# Apply file-based migrations from the migrations/ folder
npm run migrate

# Manually decrypt DB fields (same key as the server)
npm run decrypt -- "enc:v1:..."          # text token → plaintext
npm run decrypt -- --b64 "<base64>"       # encrypted BLOB
npm run decrypt -- --user 1               # dump a user's fields decrypted
npm run decrypt -- --questions 1          # dump a user's questions decrypted

# One-time encrypt of legacy plaintext data in the DB
npm run encrypt-legacy
```

On startup the central server prints all network IPs (0.0.0.0 bind) so it's obvious what address to use from inside the LAN.

### Laptop relay (for IP rotation)

On each laptop through which target traffic should be routed:

```bash
# Install (once, same repository as the server)
git clone <repo>; npm install

# Start relay + SSH tunnel (your laptop, port 8787)
npm run start:relay

# Second laptop — port 8788
RELAY_PORT=8788 npm run start:relay
```

Or via cloudflared / ngrok — see the ["Multi-laptop / IP rotation"](#multi-laptop--ip-rotation-via-forward-relay) section above.

> Production: set `UIX_DB_KEY` (32 bytes hex/base64) in the environment. Without it the key is read from `db-secret.key` in the project root (auto-created on first run, gitignored) — keep a backup of it.

## Dependencies

- **Runtime**: [`better-sqlite3`](https://github.com/WiseLibs/better-sqlite3), [`@google/genai`](https://www.npmjs.com/package/@google/genai) — the official Gemini API SDK (Files API + `generateContent`)
- **Dev/build**: `tsx`, `typescript`, `@types/node`, `@types/better-sqlite3`, `sass` (compiles [styles/style.scss](styles/style.scss) → `public/style.css`), `posthtml` + `posthtml-include` + `posthtml-expressions` (build `pages/*.html` → `public/*.html`)
- **Client CDN** (no npm): [html2canvas 1.4.1](https://cdnjs.com/libraries/html2canvas) — for the iframe screenshot
