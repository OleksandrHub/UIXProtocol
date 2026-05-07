# UIXProtocol

A lightweight reverse proxy with multi-user authentication and an optional Gemini-powered AI helper. Single Node process, single port, no frameworks.

> Ukrainian version: [README.md](README.md)

## Simple start

Four commands and you're up:

```bash
npm install
npm run create-admin -- admin "your_password"
npm run dev
```

Open `http://localhost:3000/admin`, sign in as `admin`, create users. Each user then visits `http://localhost:3000/` (login form) or `http://localhost:3000/<their_id>/` directly.

Requires Node.js 20+ and `npm`. The `users.db` SQLite file is created automatically in the project root on first run.

## Features

- Transparent HTTP/HTTPS proxy that rewrites absolute URLs in HTML/JS responses
- Multiple users — each with their own `target_url` rendered inside an iframe
- Full credentials login (name + password) plus a quick-login by the first character of the password
- Admin panel: user CRUD, grant admin rights, manage API keys
- User dashboard: change target URL, change password, add/remove Gemini API keys
- Google Gemini integration that analyses a screenshot and returns short test answers
- Isolated "preview" mode for unauthenticated visitors via direct link `/_p/<id>/...`

## Architecture

| File | Purpose |
| --- | --- |
| [server.ts](server.ts) | HTTP server on a single port: static, user/admin routes, proxy |
| [api.ts](api.ts) | REST API (`/api/*`) — login, users, settings, Gemini |
| [db.ts](db.ts) | SQLite (`better-sqlite3`) + scrypt password hashing |
| [session.ts](session.ts) | In-memory sessions, `uix_session` HttpOnly cookie |
| [gemini.ts](gemini.ts) | Gemini API call + parsing of the short test answer |
| [environments/environment.ts](environments/environment.ts) | Config: port, default target, session TTL, iframe permissions |
| [create-admin.ts](create-admin.ts) | CLI to create the first admin |
| [public/](public/) | Vanilla HTML/CSS/JS client |

### Server routes

- `/` — login form (name + password); authenticated users are redirected to `/<id>/`
- `/<id>/` — user workspace (iframe + menu) or password form for that specific user
- `/admin` — admin panel (login form, then user-management UI)
- `/_p/<id>/...` — preview proxy for unauthenticated visitors (target cookies are dropped, a `uix_preview` cookie is set)
- `/static/*` — static assets (CSS/JS/icons)
- `/api/*` — REST (see below)
- everything else — fallback proxy (for absolute paths inside proxied HTML)

## Quick start

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

Open `http://localhost:3000/admin`, sign in as admin, create users. Each user then visits `http://localhost:3000/<their_id>/` or `http://localhost:3000/`.

## Configuration

`environments/environment.ts`:

| Field | Description |
| --- | --- |
| `port` | Server port (default `3000`) |
| `defaultTarget` | URL used when a user's `target_url` is empty |
| `sessionTtlMs` | Session lifetime in milliseconds |
| `iframePermissions` | List of `Permissions-Policy` features granted to the iframe |

## REST API

All responses are JSON. Errors use `{ "error": "..." }`. The `uix_session` cookie is set automatically after a successful login.

### Public

| Method | Path | Description |
| --- | --- | --- |
| POST | `/api/login` | Login by `{name, password}` |
| POST | `/api/login/:id` | Login by `id` + full password |
| POST | `/api/login/:id/quick` | Quick login by `{char}` — first character of the password |
| POST | `/api/admin/login` | Same as `/api/login`, but rejects non-admins |
| POST | `/api/logout` | Logout (drops session + cookie) |
| GET  | `/api/me` | Current user (requires session) |
| GET  | `/api/config` | Proxy path and `iframePermissions` |
| GET  | `/api/users/by-name/:name` | Public lookup `{id, name, targetUrl}` |

### User (session required)

| Method | Path | Body |
| --- | --- | --- |
| PUT | `/api/me/url` | `{ url: string }` — update own `target_url` |
| PUT | `/api/me/password` | `{ password: string }` — change own password |
| PUT | `/api/me/api-keys` | `{ apiKeys: string[] }` — store Gemini keys |
| POST | `/api/gemini/solve` | `{ imageBase64: string }` — returns `{ answer }` |

### Admin (`isAdmin=true`)

| Method | Path | Description |
| --- | --- | --- |
| GET | `/api/users` | List all users |
| POST | `/api/users` | Create user `{name, password, apiKeys?, isAdmin?, targetUrl?}` |
| GET | `/api/users/:id` | Fetch a single user |
| PUT | `/api/users/:id` | Update fields (including password) |
| DELETE | `/api/users/:id` | Delete a user |

## Security

- Passwords: scrypt (`node:crypto`) with a 16-byte salt and 64-byte key, verified via `timingSafeEqual`
- Quick login by the first character only works once `password_first` is stored (filled on create/password change, or backfilled on the first full login)
- Sessions are in-memory (`Map`) — every restart invalidates them
- Session cookie: `HttpOnly; SameSite=Lax; Path=/`
- The proxy strips `X-Frame-Options`, `Content-Security-Policy`, `Strict-Transport-Security`, `Feature-Policy` from upstream responses and injects its own `Permissions-Policy`
- Target `Set-Cookie` headers with `Domain=...`, `Secure`, `SameSite=*` are normalised (forced to `SameSite=Lax`)

## Gemini integration

`gemini.ts` sends a base64-encoded PNG/JPEG to `gemini-2.5-flash` with a prompt that expects a short answer in the `Відповідь: ...` form (single choice, multiple correct, matching pairs, open-ended, true/false). Each user has their own list of API keys; if a key fails or is rate-limited, the next one is tried. Per-request timeout is 20 s.

## Dependencies

- Runtime: [`better-sqlite3`](https://github.com/WiseLibs/better-sqlite3)
- Dev/build: `tsx`, `typescript`, `@types/node`, `@types/better-sqlite3`

bcrypt and Angular have been removed from the project entirely.
