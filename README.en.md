# UIXProtocol

A lightweight reverse proxy with multi-user authentication and an optional Gemini-powered AI helper. Single Node process, single port, no frameworks.

> Ukrainian version: [README.md](README.md)

## Simple start

Four commands and you're up:

```bash
git clone <url>
npm install
npm run create-admin -- admin "your_password"
npm run dev
```

Open `http://localhost:3000/admin`, sign in as `admin`, create users. Each user then visits `http://localhost:3000/` (login form) or `http://localhost:3000/<their_id>/` directly.

Requires Node.js 20+ and `npm`. The `users.db` SQLite file is created automatically in the project root on first run.

## Features

- Transparent HTTP/HTTPS proxy that rewrites absolute URLs in HTML/JS responses
- Multiple users — each with their own `target_url` rendered inside an iframe
- Full credentials login (name + password) plus quick-login by the first character of the password
- Admin panel: user CRUD, grant admin rights, manage API keys
- User dashboard: change target URL, change password, add/remove Gemini API keys
- Google Gemini integration: iframe screenshot → short test answer
- `Alt+G/H/M` keyboard shortcuts and mouse-wheel control (no extra toolbars needed)
- Isolated "preview" mode for unauthenticated visitors via direct link `/_p/<id>/...`

## Architecture

### Server

| File | Purpose |
| --- | --- |
| [server.ts](server.ts) | HTTP server on a single port: static, user/admin routes, proxy |
| [api.ts](api.ts) | REST API (`/api/*`) — login, users, settings, Gemini |
| [db.ts](db.ts) | SQLite (`better-sqlite3`) + scrypt password hashing |
| [session.ts](session.ts) | In-memory sessions, `uix_session` HttpOnly cookie |
| [gemini.ts](gemini.ts) | Gemini API call + parsing of the short test answer |
| [environments/environment.ts](environments/environment.ts) | Config: port, default target, session TTL, iframe permissions |
| [create-admin.ts](create-admin.ts) | CLI to create the first admin |

### Client (no frameworks)

| Page | HTML | Logic |
| --- | --- | --- |
| Generic login | [public/login.html](public/login.html) | [public/static/login.js](public/static/login.js) |
| User dashboard | [public/user.html](public/user.html) | [public/static/user.js](public/static/user.js) |
| Admin login | [public/admin-login.html](public/admin-login.html) | [public/static/admin-login.js](public/static/admin-login.js) |
| Admin panel | [public/admin.html](public/admin.html) | [public/static/admin.js](public/static/admin.js) |
| Styles | [public/static/style.css](public/static/style.css) | — |
| HTTP wrapper | — | [public/static/http.js](public/static/http.js) — `api(path, opts)` |

### Server routes

- `/` — login form (name + password); authenticated users are redirected to `/<id>/`
- `/<id>/` — user workspace (iframe + menu) or password form for that specific user
- `/admin` — admin panel (login form, then user-management UI)
- `/_p/<id>/...` — preview proxy for unauthenticated visitors (target cookies are dropped, a `uix_preview` cookie is set)
- `/static/*` — static assets (CSS/JS/icons)
- `/api/*` — REST (see below)
- everything else — fallback proxy (for absolute paths inside proxied HTML)

## Server modules — key functions

### `server.ts`

- `serveFile(res, file)` — streams a local file with `Cache-Control: no-store`; MIME picked by extension.
- `safeStaticPath(reqPath)` — normalises a `/static/*` path and blocks path traversal outside `public/static/`.
- `rewriteUrls(text, targetHost)` — strips `https://<targetHost>` and `http://<targetHost>` from response bodies so all absolute links stay within our origin.
- `performProxy(req, res, targetRaw, pathOnly, opts)` — performs the upstream http(s) request, rewrites `Set-Cookie` (drops `Domain`, `Secure`, forces `SameSite=Lax`), strips `X-Frame-Options` / `Content-Security-Policy` / `Strict-Transport-Security` / `Feature-Policy`, injects its own `Permissions-Policy` from `iframePermissions`. For `text/html` and `application/javascript` it buffers the body and runs `rewriteUrls`. Options:
  - `sendCookies: false` — do not forward client cookies to the target
  - `stripSetCookie: true` — drop `Set-Cookie` from the upstream response (preview mode)
  - `setPreviewCookie: <userId>` — set `uix_preview=<userId>` cookie (HttpOnly, Lax)
- `proxyForUser(req, res, userId, reqPath, preview)` — picks the user's `target_url` (or `defaultTarget`) and calls `performProxy`.
- `proxyHandle(req, res)` — request-owner resolution order:
  1. Session (`uix_session`) → proxy for the session user
  2. `Referer` starts with `/_p/<id>/` → preview for that `id`
  3. Cookie `uix_preview` → preview for that `id`
  4. Otherwise → `403`

### `api.ts`

`handleApi(req, res)` returns `true` if the request was handled as `/api/*`, otherwise `false` and control falls back to the `server.ts` router. Bodies are read via `readJson<T>()` with a 1 MB limit (15 MB for `/api/gemini/solve` because of the base64 image). Errors serialise to `{ error: "..." }`.

### `db.ts`

- `hashPassword(password)` / `verifyHash(password, stored)` — scrypt (`node:crypto`), 16-byte salt, 64-byte key, format `scrypt$<salt-hex>$<hash-hex>`. Verification uses `crypto.timingSafeEqual`.
- `firstChar(s)` — `[...s][0]`, so it correctly handles Unicode codepoints (emoji, etc.).
- `createUser` / `updateUser` / `getUserById` / `getUserByName` / `listUsers` / `deleteUser` — CRUD over `users`. `password_first` is written alongside `password_hash`.
- `verifyPasswordById` / `verifyPasswordByName` — full password verification; on success calls `backfillFirstChar` if the column is empty.
- `verifyFirstCharById` — compares one character against `password_first` (no hashing). Only works once the column is populated.

`users` schema:

```sql
id            INTEGER PRIMARY KEY AUTOINCREMENT
name          TEXT UNIQUE NOT NULL
password_hash TEXT NOT NULL
password_first TEXT NOT NULL DEFAULT ''
api_keys      TEXT NOT NULL DEFAULT '[]'   -- JSON array
is_admin      INTEGER NOT NULL DEFAULT 0
target_url    TEXT NOT NULL DEFAULT ''
```

On first boot, if `password_first` is missing it's added via `ALTER TABLE` (runtime migration).

### `session.ts`

- `parseCookie(req, name)` — parses the `Cookie` header.
- `setSession(res, userId)` — generates 24 random bytes (base64url) and stores `Map<sessionId, {userId, expiresAt}>`.
- `getSessionUserId(req)` — reads the cookie, checks TTL, evicts expired entries.
- `clearSession(req, res)` — removes the entry and resets the cookie via `Max-Age=0`.
- A `setInterval(...).unref()` sweeps expired sessions every 60 s.

### `gemini.ts`

- `solveWithGemini(apiKeys, imageBase64)` — tries each key for `gemini-2.5-flash` (extend the `MODELS` constant if needed), 20-second timeout per request via `AbortController`.
- `callGemini(key, model, base64)` — POST to `generativelanguage.googleapis.com/v1beta/models/<model>:generateContent`; the prompt asks for a short answer in the form `Відповідь: ...`.
- `parseResultText(text)` — first looks for `Відповідь:` / `Answer:`, then for the first line matching `\d+(,\d+)*` / `\d+(;\d+)*` / `\d+-[а-яa-z]...` / `так|ні`.

## Client pages

### `/<id>/` — user dashboard ([public/static/user.js](public/static/user.js))

Flow:

1. `GET /api/me`.
2. If `me.id === id` (authenticated as this exact user) → `enterAuthed()`.
3. Otherwise → `initLogin()` — quick login.

`enterAuthed(me, { fromLogin })`:
- Shows the top-bar with the user name plus "Settings", "Admin" (admins only), "Logout".
- `GET /api/config` → sets `allow="..."` on the iframe per `iframePermissions`, then `frame.src = proxyBase` (`/_p/`) unless this is a redirect right after login (`fromLogin=true` — the iframe already shows the target).
- Spawns the Gemini panel (the "Скрін" button) and registers shortcuts / wheel.
- The settings dialog saves through three independent PUTs (`/me/url`, `/me/api-keys`, `/me/password`) — only fields that actually changed.

`initLogin()`:
- Sets `frame.src = "/_p/<id>/"` so the user already sees the target before logging in (preview mode).
- Reveals a hidden `<input type="password" maxLength="1">`. The `input` event fires `POST /api/login/<id>/quick` with the single character as soon as the field has exactly one char.
- On error: adds `wrong shake` (CSS shake animation) and refocuses.

### `/` — full login ([public/static/login.js](public/static/login.js))

Plain `name + password` form → `POST /api/login` → redirect to `/<user.id>/`.

### `/admin` ([public/static/admin.js](public/static/admin.js), [public/static/admin-login.js](public/static/admin-login.js))

- If you're not an admin, the server returns `admin-login.html` with a `POST /api/admin/login` form. After success — `location.reload()` and the server returns `admin.html`.
- The admin panel: a user table (id, name, admin, target, key count), a "Create / Edit" form, and `DELETE /api/users/:id` guarded with `confirm()`.
- During edit: an empty "Password" field keeps the existing password; API keys — one per line.

### Shared — [public/static/http.js](public/static/http.js)

`api(path, opts)` — a wrapper around `fetch('/api' + path)` with `Content-Type: application/json` and `credentials: same-origin`. Returns `null` for `204`, parses JSON, throws an `Error` with `body.error` on non-2xx.

## Keyboard shortcuts

`installShortcuts()` in [public/static/user.js](public/static/user.js#L214) registers a `keydown` listener on `window` and **also** mirrors it into `iframe.contentDocument` (via `attachToFrame` after `load`) — so the shortcuts still fire when focus is inside the target. The handler only triggers on `Alt + key` (no `Ctrl`/`Meta`) and is **ignored** in text inputs (`INPUT`, `TEXTAREA`, `contentEditable`).

| Key | Action | Implementation |
| --- | --- | --- |
| `Alt+G` | Take an iframe screenshot and send to Gemini | `triggerGemini()` |
| `Alt+H` | Show/hide the last Gemini answer | `toggleResult()` |
| `Alt+M` | Show/hide the top-bar menu | `toggleBar()` |

For a cross-origin iframe target, `frame.contentDocument` will be `null` and only the outer-window listener fires. Gemini itself also requires same-origin access (the screenshot is built from the iframe's DOM via `html2canvas`).

## Mouse wheel

The same `installShortcuts()` listens for `wheel` (`passive: false`, capture) and mirrors into the iframe. It **only fires when `Ctrl` or `Alt` is held** — a plain wheel still scrolls the page normally. Cooldown is **700 ms** between actions so a long scroll doesn't spam requests.

| Gesture | Action |
| --- | --- |
| `Ctrl`/`Alt` + wheel up (`deltaY < 0`) | `triggerGemini()` — fire Gemini |
| `Ctrl`/`Alt` + wheel down (`deltaY > 0`) | `toggleResult()` — toggle the answer |

`preventDefault` is only called when the modifier is pressed; otherwise scroll passes through to the page/iframe untouched. `Ctrl+wheel` is the default browser zoom — in this dashboard it's repurposed to trigger Gemini.

## Menu and settings

The top-bar (`<header id="bar">`) is hidden by default; it appears after a successful login. Buttons:

- **User name** — plain text.
- **Settings** — opens the modal with three fields:
  - Site URL → `PUT /api/me/url` → on save, the iframe reloads from the new target
  - API keys (one per line) → `PUT /api/me/api-keys`
  - New password (empty — keep current) → `PUT /api/me/password`
- **Admin** — link to `/admin` (visible only when `isAdmin=true`).
- **Logout** — `POST /api/logout`, then redirect to `/`.

In addition, a Gemini panel sits in the bottom-right corner with a "Скрін" button (same action as `Alt+G`). The result is a floating block that auto-hides after **12 seconds**.

## Gemini screenshot

All processing is on the client ([user.js:88](public/static/user.js#L88)):

1. `getFrameWindow()` grabs `iframe.contentWindow` / `contentDocument`. Cross-origin → immediate `Error('iframe недоступний')`.
2. `ensureHtml2Canvas(win)` — injects [html2canvas 1.4.1](https://html2canvas.hertzen.com/) from CDN into `iframe.contentDocument` (the outer page already has it, included via `<script>` in [user.html](public/user.html)).
3. `captureFrame()` — `html2canvas` with `useCORS`, `allowTaint`, viewport area (`scrollX/scrollY` + `innerWidth/innerHeight`).
4. `canvasToBase64Jpeg()` — downscales to **1600 px** width, JPEG quality **0.7**, base64.
5. `POST /api/gemini/solve` → answer is rendered into `.gemini-result`.

Guards: a concurrent call is blocked by the `busy` flag; the button is disabled while a request is in flight.

## Configuration

[environments/environment.ts](environments/environment.ts):

| Field | Description |
| --- | --- |
| `port` | Server port (default `3000`) |
| `defaultTarget` | URL used when a user's `target_url` is empty |
| `sessionTtlMs` | Session lifetime in milliseconds (1 hour) |
| `iframePermissions` | `Permissions-Policy` features granted to the iframe |
| `production` | Reserved (not yet used) |

## REST API

All responses are JSON. Errors use `{ "error": "..." }`. The `uix_session` cookie is set automatically after a successful login.

### Public

| Method | Path | Description |
| --- | --- | --- |
| POST | `/api/login` | `{name, password}` |
| POST | `/api/login/:id` | `{password}` — login by id |
| POST | `/api/login/:id/quick` | `{char}` — quick login by first character |
| POST | `/api/admin/login` | Same as `/api/login`, rejects non-admins |
| POST | `/api/logout` | — |
| GET  | `/api/me` | Current user |
| GET  | `/api/config` | `{ proxyPath, iframePermissions }` |
| GET  | `/api/users/by-name/:name` | `{ id, name, targetUrl }` |

### User (session required)

| Method | Path | Body |
| --- | --- | --- |
| PUT | `/api/me/url` | `{ url: string }` |
| PUT | `/api/me/password` | `{ password: string }` |
| PUT | `/api/me/api-keys` | `{ apiKeys: string[] }` |
| POST | `/api/gemini/solve` | `{ imageBase64: string }` → `{ answer }` |

### Admin (`isAdmin=true`)

| Method | Path | Description |
| --- | --- | --- |
| GET | `/api/users` | List all |
| POST | `/api/users` | `{name, password, apiKeys?, isAdmin?, targetUrl?}` |
| GET | `/api/users/:id` | Single user |
| PUT | `/api/users/:id` | Partial update |
| DELETE | `/api/users/:id` | — |

## Security

- **Passwords**: scrypt (`node:crypto`), 16-byte salt, 64-byte key, verified via `timingSafeEqual`.
- **Quick login** by the first character only works once `password_first` is stored (filled on create/password change, or backfilled on the first full login via `backfillFirstChar`). Note this is **not** equivalent to a full login (1 char → 26+ candidates), so enable it only where the trade-off is acceptable.
- **Sessions** are in-memory `Map`; restarts invalidate every session. Cookie: `HttpOnly; SameSite=Lax; Path=/`.
- **The proxy** strips `X-Frame-Options`, `Content-Security-Policy[-Report-Only]`, `Strict-Transport-Security`, `Feature-Policy` from upstream responses and injects its own `Permissions-Policy`.
- **Target cookies** with `Domain=...`, `Secure`, `SameSite=*` are normalised (forced `SameSite=Lax`, no `Domain`/`Secure`). The session cookie name (`uix_session`) is never forwarded upstream.
- **Path traversal** for static is blocked by `target.startsWith(root)` in `safeStaticPath`.

## Running

```bash
# Install dependencies (once)
npm install

# Create the first admin (args or interactive)
npm run create-admin -- admin "your_password" "https://example.com"
npm run create-admin

# Development (tsx, no compile step)
npm run dev

# Production — compile + plain node (minimal RAM)
npm run build
npm start
```

## Dependencies

- **Runtime**: [`better-sqlite3`](https://github.com/WiseLibs/better-sqlite3)
- **Dev/build**: `tsx`, `typescript`, `@types/node`, `@types/better-sqlite3`
- **Client CDN** (no npm): [html2canvas 1.4.1](https://cdnjs.com/libraries/html2canvas) — for the iframe screenshot

bcrypt and Angular have been removed from the project entirely.
