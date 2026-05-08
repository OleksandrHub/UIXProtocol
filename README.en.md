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
- Google Gemini integration via the official `@google/genai` SDK: iframe screenshot → short test answer
- **Custom prompts** with one active prompt — stored per-user in the DB
- **Model switching**: enable/disable models in settings; cycle the active model with `Alt+X`
- **File attachments**: any file type (PDF, images, text, audio, video, …) is stored in the DB and automatically forwarded to Gemini as context alongside the screenshot (Files API + `createPartFromUri`)
- **Appearance customisation** (font / size / color / background) for the Gemini answer and the `S` button — kept in `localStorage`
- `Alt+G/H/M/C` keyboard shortcuts and mouse-wheel control with `Ctrl`/`Alt` modifier
- Invisible 44×44 click zone in the top-right corner that toggles the menu
- Tab title and favicon automatically synced with the proxied site
- Responsive layout for mobile (top-bar, admin panel, user table)
- Isolated "preview" mode for unauthenticated visitors via direct link `/_p/<id>/...`

## Architecture

### Server

| File | Purpose |
| --- | --- |
| [server.ts](server.ts) | HTTP server on a single port: static, user/admin routes, proxy |
| [api.ts](api.ts) | REST API (`/api/*`) — login, users, settings, prompts, models, files, Gemini |
| [db.ts](db.ts) | SQLite (`better-sqlite3`) + scrypt password hashing, `user_files` table for attachments |
| [session.ts](session.ts) | In-memory sessions, `uix_session` HttpOnly cookie |
| [gemini.ts](gemini.ts) | Gemini calls via the `@google/genai` SDK + Files API + parsing of the short test answer |
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
- `createUser` / `updateUser` / `getUserById` / `getUserByName` / `listUsers` / `deleteUser` — CRUD over `users`. `password_first` is written alongside `password_hash`. `updateUser` also accepts `prompts`, `activePromptId`, `enabledModels`, `activeModel`. On create, the smallest free `id` is chosen to reuse gaps after deletions.
- `listUserFiles(userId)` / `getUserFile` / `getUserFiles(userId)` / `addUserFile(userId, name, mime, data)` / `deleteUserFile(userId, fileId)` — CRUD for attached files (type is not restricted: PDF, images, text, audio, video).
- `verifyPasswordById` / `verifyPasswordByName` — full password verification; on success calls `backfillFirstChar` if the column is empty.
- `verifyFirstCharById` — compares one character against `password_first` (no hashing). Only works once the column is populated.
- Exports `KNOWN_MODELS` (the list of supported Gemini models) and `DEFAULT_PROMPT_TEXT` (the default test-solving prompt).

`users` schema:

```sql
id              INTEGER PRIMARY KEY AUTOINCREMENT
name            TEXT UNIQUE NOT NULL
password_hash   TEXT NOT NULL
password_first  TEXT NOT NULL DEFAULT ''
api_keys        TEXT NOT NULL DEFAULT '[]'   -- JSON array
is_admin        INTEGER NOT NULL DEFAULT 0
target_url      TEXT NOT NULL DEFAULT ''
prompts         TEXT NOT NULL DEFAULT '[]'   -- JSON: [{id, name, text}, ...]
active_prompt_id TEXT NOT NULL DEFAULT ''
enabled_models  TEXT NOT NULL DEFAULT '[]'   -- JSON array of model names
active_model    TEXT NOT NULL DEFAULT ''
```

`user_files` schema:

```sql
id          INTEGER PRIMARY KEY AUTOINCREMENT
user_id     INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE
name        TEXT NOT NULL
mime        TEXT NOT NULL
size        INTEGER NOT NULL
data        BLOB NOT NULL
created_at  INTEGER NOT NULL
```

All new columns are added via `ALTER TABLE ADD COLUMN` at runtime — old DBs are migrated automatically on first boot.

### `session.ts`

- `parseCookie(req, name)` — parses the `Cookie` header.
- `setSession(res, userId)` — generates 24 random bytes (base64url) and stores `Map<sessionId, {userId, expiresAt}>`.
- `getSessionUserId(req)` — reads the cookie, checks TTL, evicts expired entries.
- `clearSession(req, res)` — removes the entry and resets the cookie via `Max-Age=0`.
- `clearSessionsForUser(userId)` — clears all active sessions for a user (called on delete).
- A `setInterval(...).unref()` sweeps expired sessions every 60 s.

### `gemini.ts`

Uses the official `@google/genai` SDK instead of raw `fetch`. Call flow:

- `solveWithGemini({ apiKeys, imageBase64, prompt, models, files })` — iterates models in user-defined order (the active model first), and for each model tries every API key. The first success returns; otherwise the last error is thrown. 20-second timeout per request, no auto-retries.
- `uploadFileForKey(client, apiKey, file)` — lazily uploads a `UserFile` (BLOB from the DB) to the Gemini Files API via `client.files.upload({ file: Blob, config: { mimeType, displayName } })`. Returns `{ uri, mimeType, expiresAt }`. The result is cached in memory in `Map<"<apiKey>::<fileId>", UploadedFile>` for ~40 hours (the Files API itself keeps files for ~48h).
- The actual call: `client.models.generateContent({ model, config: { thinkingConfig: { thinkingBudget: model.includes('pro') ? 8000 : 2000 } }, contents })`. `parts` start with the prompt text, then PDF parts via `createPartFromUri(uri, mime)`, ending with the screenshot `inlineData` (JPEG base64).
- `invalidateUploadsForUser(fileIds)` — called from `api.ts` when a user deletes a file, clearing the cache for that `fileId` across every key.
- `parseResultText(text)` — first looks for `Відповідь:` / `Answer:`, then for the first line matching `\d+(,\d+)*` / `\d+(;\d+)*` / `\d+-[а-яa-z]...` / `так|ні`.

If a request to one (model, key) pair fails, the URI cache for that key is reset automatically — the next attempt re-uploads the files.

## Client pages

### `/<id>/` — user dashboard ([public/static/user.js](public/static/user.js))

Flow:

1. `GET /api/me`.
2. If `me.id === id` (authenticated as this exact user) → `enterAuthed()`.
3. Otherwise → `initLogin()` — quick login.

`enterAuthed(me, { fromLogin })`:
- Shows the top-bar with the user name plus "Settings", "Admin" (admins only), "Logout".
- Wires up `barTrigger` (an invisible 44×44 click zone in the top-right corner) → click toggles the menu.
- `GET /api/config` → sets `allow="..."` on the iframe per `iframePermissions`, then `frame.src = proxyBase` (`/_p/`) unless this is a redirect right after login (`fromLogin=true` — the iframe already shows the target).
- Spawns the Gemini panel, registers shortcuts / wheel, and attaches `frame.addEventListener('load', syncMetaFromFrame)` to mirror the target's title/favicon.
- On load, applies the saved appearance (font / color / background for the answer and the `S` button) from `localStorage` via CSS variables.
- The settings dialog saves through several PUTs — only changed fields: `/me/url`, `/me/api-keys`, `/me/password`, `/me/prompts`, `/me/models`. PDF files are uploaded/deleted live via `/me/files`. Appearance is written to `localStorage`.

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

`installShortcuts()` in [public/static/user.js](public/static/user.js#L245) registers a `keydown` listener on `window` and **also** mirrors it into `iframe.contentDocument` (via `attachToFrame` after `load`) — so the shortcuts still fire when focus is inside the target. The handler only triggers on `Alt + key` (no `Ctrl`/`Meta`) and is **ignored** in text inputs (`INPUT`, `TEXTAREA`, `contentEditable`).

| Key | Action | Implementation |
| --- | --- | --- |
| `Alt+G` | Take an iframe screenshot and send to Gemini | `triggerGemini()` |
| `Alt+H` | Show/hide the last Gemini answer | `toggleResult()` |
| `Alt+M` | Show/hide the top-bar menu | `toggleBar()` |
| `Alt+C` | Cycle the active Gemini model to the next enabled one | `cycleModel()` — `PUT /api/me/active-model`, the short name briefly appears in `#modelToast` (bottom-right corner) |

For a cross-origin iframe target, `frame.contentDocument` will be `null` and only the outer-window listener fires. Gemini itself also requires same-origin access (the screenshot is built from the iframe's DOM via `html2canvas`).

## Mouse wheel

The same `installShortcuts()` listens for `wheel` (`passive: false`, capture) and mirrors into the iframe. It **only fires when `Ctrl` or `Alt` is held** — a plain wheel still scrolls the page normally. Cooldown is **700 ms** between actions so a long scroll doesn't spam requests.

| Gesture | Action |
| --- | --- |
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
  - **General**: site URL → `PUT /api/me/url`, API keys → `PUT /api/me/api-keys`, new password (empty — keep current) → `PUT /api/me/password`.
  - **Prompts**: any number of named prompts, one chosen as active (radio). Persisted as `prompts` + `active_prompt_id` via `PUT /api/me/prompts`.
  - **Models**: checkboxes over `KNOWN_MODELS`, a radio for the active model, plus a hint about `Alt+C`. Saved via `PUT /api/me/models`.
  - **Files**: arbitrary attachments (PDF, images, text, audio, video, …) forwarded to Gemini as context. Add via `POST /api/me/files` (base64, MIME picked by the browser), delete via `DELETE /api/me/files/:id`.
  - **Appearance**: separately for the Gemini result and the `S` button — font, size, text color, background color + a "transparent background" checkbox. Live preview via CSS variables; saved in `localStorage` under `uix.appearance`. Changes apply immediately; "Cancel" restores the last saved set.
- **Admin** — link to `/admin` (visible only when `isAdmin=true`).
- **Logout** — `POST /api/logout`, then redirect to `/`.

### Gemini panel

The "S" button (`#screenshotBtn`) sits in the **top-left** corner (`top: 1rem; left: 1rem`). Default style: `background: transparent`, dim dark text, dual `text-shadow` (white glow + dark drop) — readable on both light and dark backgrounds. Hover boosts contrast.

The result (`#geminiResult`) sits in the **bottom-left** corner with the same transparent + text-shadow style. It auto-hides after **12 seconds**. Errors render with the same plain style — no red error variant.

Both the button and the result are themed via CSS variables (`--screenshot-font/size/color/bg`, `--result-font/size/color/bg`) populated by `applyAppearance()` from `localStorage["uix.appearance"]`. The "Appearance" tab can change font / size / color / background of either element on the fly, no reload needed.

### Tab title and favicon

The dashboard automatically picks up the proxied site's name and icon:

- **Favicon (no JS)**: [public/user.html](public/user.html) declares `<link rel="icon" id="favicon" href="/_p/favicon.ico">`. The browser fetches `/_p/favicon.ico` → `proxyHandle` → upstream `/favicon.ico` on the target. Works before the iframe even loads.
- **Title + custom icon paths** ([syncMetaFromFrame](public/static/user.js#L39)) — on `iframe.load`:
  - `document.title = frame.contentDocument.title` (same-origin via the proxy); falls back to `me.name` if the target has no title.
  - Looks for `<link rel~="icon">` or `<link rel="shortcut icon">` inside the iframe document. If origin matches our own — substitutes `/_p<path>` (so it goes through the proxy); if it's a different-host CDN — uses the absolute URL as-is (favicons aren't subject to CORS).
- Fires on every iframe `load` — internal anchor navigation in the target also re-syncs title/favicon.

## Gemini screenshot

Client side ([initGemini, user.js](public/static/user.js)):

1. `getFrameWindow()` grabs `iframe.contentWindow` / `contentDocument`. Cross-origin → immediate `Error('iframe недоступний')`.
2. `ensureHtml2Canvas(win)` — injects [html2canvas 1.4.1](https://html2canvas.hertzen.com/) from CDN into `iframe.contentDocument` (the outer page already has it, included via `<script>` in [user.html](public/user.html)).
3. `captureFrame()` — `html2canvas` with `useCORS`, `allowTaint`, viewport area (`scrollX/scrollY` + `innerWidth/innerHeight`).
4. `canvasToBase64Jpeg()` — downscales to **1600 px** width, JPEG quality **0.7**, base64.
5. `POST /api/gemini/solve` with just `imageBase64`. The active prompt, active model, and PDF attachments are pulled from the user record on the server.
6. The answer is rendered into `.gemini-result`.

Server side ([api.ts](api.ts) → [gemini.ts](gemini.ts)):
- Picks the user's active prompt (fallback — first in the list, then `DEFAULT_PROMPT_TEXT`).
- Builds the model order: `activeModel` first, then the rest of `enabledModels`. If nothing is enabled — falls back to `gemini-2.5-flash`.
- Loads every `user_files` record for the user (any type — PDF / image / text / audio / video) and passes them into `solveWithGemini`, which calls `client.files.upload` (with URI cache per key).

Guards: a concurrent call is blocked by the `busy` flag; the button is disabled while a request is in flight.

## Responsive (mobile)

A single media block in [public/static/style.css](public/static/style.css) — `@media (max-width: 640px)`:

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
| GET  | `/api/me` | Current user (includes `prompts`, `activePromptId`, `enabledModels`, `activeModel`) |
| GET  | `/api/config` | `{ proxyPath, iframePermissions, knownModels, defaultPrompt }` |
| GET  | `/api/users/by-name/:name` | `{ id, name, targetUrl }` |

### User (session required)

| Method | Path | Body / response |
| --- | --- | --- |
| PUT | `/api/me/url` | `{ url: string }` |
| PUT | `/api/me/password` | `{ password: string }` |
| PUT | `/api/me/api-keys` | `{ apiKeys: string[] }` |
| PUT | `/api/me/prompts` | `{ prompts: {id,name,text}[], activePromptId?: string }` |
| PUT | `/api/me/models` | `{ enabledModels: string[], activeModel?: string }` (filtered against `KNOWN_MODELS`) |
| PUT | `/api/me/active-model` | `{ activeModel: string }` — must be in `enabledModels` |
| GET | `/api/me/files` | `[{id, name, mime, size, createdAt}]` |
| POST | `/api/me/files` | `{ name, mime, dataBase64 }` → file metadata (30 MB cap) |
| DELETE | `/api/me/files/:id` | `204`, also clears the URI cache in `gemini.ts` |
| POST | `/api/gemini/solve` | `{ imageBase64: string }` → `{ answer }`. Prompt / models / PDFs come from the DB |

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

- **Runtime**: [`better-sqlite3`](https://github.com/WiseLibs/better-sqlite3), [`@google/genai`](https://www.npmjs.com/package/@google/genai) — the official Gemini API SDK (Files API + `generateContent`)
- **Dev/build**: `tsx`, `typescript`, `@types/node`, `@types/better-sqlite3`
- **Client CDN** (no npm): [html2canvas 1.4.1](https://cdnjs.com/libraries/html2canvas) — for the iframe screenshot

bcrypt and Angular have been removed from the project entirely.
