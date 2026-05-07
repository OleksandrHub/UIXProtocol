# UIXProtocol

Легкий проксі з мультикористувацькою автентифікацією та опційним AI-помічником на базі Gemini. Один Node-процес, один порт, без фреймворків.

> Англійська версія: [README.en.md](README.en.md)

## Простий старт

Чотири команди — і застосунок працює:

```bash
git clone <url>
npm install
npm run create-admin -- admin "ваш_пароль"
npm run dev
```

Відкрийте `http://localhost:3000/admin`, увійдіть як `admin`, створіть користувачів. Кожен з них далі заходить на `http://localhost:3000/` (форма входу) або одразу на `http://localhost:3000/<свій_id>/`.

Потрібен Node.js 20+ та `npm`. База `users.db` створюється сама в корені проєкту при першому запуску.

## Можливості

- Прозорий HTTP/HTTPS-проксі з підміною URL у HTML/JS-відповідях
- Кілька користувачів — у кожного власний `target_url`, який транслюється в iframe
- Повна автентифікація (ім'я + пароль) + швидкий вхід за першим символом пароля
- Адмін-панель: CRUD користувачів, видача прав адміна, керування API-ключами
- Особистий кабінет: змінити цільовий URL, пароль, додати/видалити Gemini API-ключі
- Інтеграція з Google Gemini: скрін iframe → коротка відповідь на тест
- Гарячі клавіші `Alt+G/H/M` і керування колесом мишки (без додаткових тулбарів)
- Ізольований "preview"-режим для неавтентифікованих відвідувачів за прямим посиланням `/_p/<id>/...`

## Архітектура

### Сервер

| Файл | Призначення |
| --- | --- |
| [server.ts](server.ts) | HTTP-сервер на одному порту: статика, маршрути користувача/адміна, проксі |
| [api.ts](api.ts) | REST API (`/api/*`) — логін, користувачі, налаштування, Gemini |
| [db.ts](db.ts) | SQLite (`better-sqlite3`) + scrypt-хешування паролів |
| [session.ts](session.ts) | In-memory сесії, HttpOnly-cookie `uix_session` |
| [gemini.ts](gemini.ts) | Виклик Gemini API + парсинг короткої відповіді |
| [environments/environment.ts](environments/environment.ts) | Конфіг: порт, дефолтний таргет, TTL сесії, iframe-дозволи |
| [create-admin.ts](create-admin.ts) | CLI для створення першого адміна |

### Клієнт (без фреймворків)

| Сторінка | HTML | Логіка |
| --- | --- | --- |
| Загальний логін | [public/login.html](public/login.html) | [public/static/login.js](public/static/login.js) |
| Кабінет користувача | [public/user.html](public/user.html) | [public/static/user.js](public/static/user.js) |
| Логін адміна | [public/admin-login.html](public/admin-login.html) | [public/static/admin-login.js](public/static/admin-login.js) |
| Адмін-панель | [public/admin.html](public/admin.html) | [public/static/admin.js](public/static/admin.js) |
| Стилі | [public/static/style.css](public/static/style.css) | — |
| HTTP-обгортка | — | [public/static/http.js](public/static/http.js) — `api(path, opts)` |

### Маршрути сервера

- `/` — форма входу (ім'я + пароль), редирект автентифікованих на `/<id>/`
- `/<id>/` — кабінет користувача (iframe + меню) або форма пароля для конкретного користувача
- `/admin` — панель адміністратора (форма входу або UI керування користувачами)
- `/_p/<id>/...` — preview-проксі для неавтентифікованих відвідувачів (без cookies таргета, виставляється `uix_preview` cookie)
- `/static/*` — статика (CSS/JS/іконки)
- `/api/*` — REST (див. нижче)
- решта — fallback-проксі (для абсолютних шляхів усередині проксійованого HTML)

## Серверні модулі — ключові функції

### `server.ts`

- `serveFile(res, file)` — стрімить локальний файл із `Cache-Control: no-store`, MIME визначається за розширенням.
- `safeStaticPath(reqPath)` — нормалізує шлях для `/static/*` і блокує path-traversal за межі `public/static/`.
- `rewriteUrls(text, targetHost)` — видаляє `https://<targetHost>` та `http://<targetHost>` із тіла відповіді, щоб усі абсолютні посилання залишилися в межах нашого домену.
- `performProxy(req, res, targetRaw, pathOnly, opts)` — виконує http(s)-запит до таргета, переписує `Set-Cookie` (зрізає `Domain`, `Secure`, форсить `SameSite=Lax`), знімає `X-Frame-Options` / `Content-Security-Policy` / `Strict-Transport-Security` / `Feature-Policy`, виставляє `Permissions-Policy` зі списку `iframePermissions`. Для `text/html` та `application/javascript` — буферизує тіло і викликає `rewriteUrls`. Опції:
  - `sendCookies: false` — не пересилати cookies клієнта в таргет
  - `stripSetCookie: true` — видалити `Set-Cookie` з відповіді (preview-режим)
  - `setPreviewCookie: <userId>` — виставити cookie `uix_preview=<userId>` (HttpOnly, Lax)
- `proxyForUser(req, res, userId, reqPath, preview)` — підставляє `target_url` користувача (або `defaultTarget`) і викликає `performProxy`.
- `proxyHandle(req, res)` — порядок резолву "хто власник запиту":
  1. Сесія (`uix_session`) → проксі для користувача сесії
  2. `Referer` починається з `/_p/<id>/` → preview для цього `id`
  3. Cookie `uix_preview` → preview для цього `id`
  4. Інакше — `403`

### `api.ts`

`handleApi(req, res)` повертає `true`, якщо запит оброблений як `/api/*`, інакше `false` — і керування передається в роутер `server.ts`. Усе тіло читається через `readJson<T>()` з лімітом 1 МБ (для `/api/gemini/solve` — 15 МБ через base64-картинку). Помилки серіалізуються у `{ error: "..." }`.

### `db.ts`

- `hashPassword(password)` / `verifyHash(password, stored)` — scrypt (`node:crypto`), сіль 16 байт, ключ 64 байти, формат `scrypt$<salt-hex>$<hash-hex>`. Перевірка через `crypto.timingSafeEqual`.
- `firstChar(s)` — береться через `[...s][0]`, тобто коректно обробляє Unicode-символи (емодзі тощо).
- `createUser` / `updateUser` / `getUserById` / `getUserByName` / `listUsers` / `deleteUser` — CRUD над `users`. `password_first` записується одночасно з `password_hash`.
- `verifyPasswordById` / `verifyPasswordByName` — повна перевірка пароля; на успіху викликає `backfillFirstChar` (якщо в БД ще немає `password_first`).
- `verifyFirstCharById` — порівнює один символ із `password_first` (без хешу). Працює лише якщо колонка вже заповнена.

Схема `users`:

```sql
id            INTEGER PRIMARY KEY AUTOINCREMENT
name          TEXT UNIQUE NOT NULL
password_hash TEXT NOT NULL
password_first TEXT NOT NULL DEFAULT ''
api_keys      TEXT NOT NULL DEFAULT '[]'   -- JSON-масив
is_admin      INTEGER NOT NULL DEFAULT 0
target_url    TEXT NOT NULL DEFAULT ''
```

При першому запуску, якщо колонка `password_first` відсутня — додається через `ALTER TABLE` (міграція в рантаймі).

### `session.ts`

- `parseCookie(req, name)` — парсить заголовок `Cookie`.
- `setSession(res, userId)` — генерує 24-байтний `randomBytes`, base64url, кладе в `Map<sessionId, {userId, expiresAt}>`.
- `getSessionUserId(req)` — читає cookie, перевіряє TTL, видаляє протерміновані.
- `clearSession(req, res)` — видаляє запис із Map і скидає cookie через `Max-Age=0`.
- Кожні 60 секунд вичищаються прострочені сесії (`setInterval(...).unref()`).

### `gemini.ts`

- `solveWithGemini(apiKeys, imageBase64)` — пробує по черзі ключі для моделі `gemini-2.5-flash` (список можна розширити в константі `MODELS`), 20 секунд таймаут на запит через `AbortController`.
- `callGemini(key, model, base64)` — POST до `generativelanguage.googleapis.com/v1beta/models/<model>:generateContent`, prompt вимагає коротку відповідь у форматі `Відповідь: ...`.
- `parseResultText(text)` — спочатку шукає `Відповідь:` / `Answer:`, потім перший рядок, що матчить `\d+(,\d+)*` / `\d+(;\d+)*` / `\d+-[а-яa-z]...` / `так|ні`.

## Сторінки клієнта

### `/<id>/` — кабінет користувача ([public/static/user.js](public/static/user.js))

Логіка:

1. Запит `GET /api/me`.
2. Якщо `me.id === id` (тобто авторизований саме як цей користувач) → `enterAuthed()`.
3. Інакше → `initLogin()` — швидкий вхід.

`enterAuthed(me, { fromLogin })`:
- Показує top-bar з ім'ям, кнопками "Налаштування", "Адмін" (для адмінів), "Вихід".
- Запит `GET /api/config` → ставить `allow="..."` на iframe згідно `iframePermissions` і виставляє `frame.src` в `proxyBase` (`/_p/`), якщо це не редирект після свіжого логіну (`fromLogin=true` — iframe уже показує таргет).
- Запускає панель Gemini (кнопка "Скрін") і встановлює гарячі клавіші / колесо.
- Налаштування зберігаються трьома окремими PUT-запитами (`/me/url`, `/me/api-keys`, `/me/password`) — лише для змінених полів.

`initLogin()`:
- Виставляє `frame.src = "/_p/<id>/"` — користувач бачить таргет ще до логіну (preview-режим).
- Показує приховану форму `<input type="password" maxLength="1">`. Подія `input` автоматично надсилає `POST /api/login/<id>/quick` з одним символом, як тільки в полі є рівно один символ.
- На помилці — клас `wrong shake` (CSS-анімація трясіння), фокус повертається на input.

### `/` — повний логін ([public/static/login.js](public/static/login.js))

Звичайна форма `name + password` → `POST /api/login` → редирект на `/<user.id>/`.

### `/admin` ([public/static/admin.js](public/static/admin.js), [public/static/admin-login.js](public/static/admin-login.js))

- Якщо не авторизований як адмін, сервер віддає `admin-login.html` із формою `POST /api/admin/login`. Після успіху — `location.reload()` → сервер віддає `admin.html`.
- В адмін-панелі: таблиця користувачів (id, name, admin, target, к-ть ключів), форма "Створити / Редагувати" та `DELETE /api/users/:id` з `confirm()`.
- При редагуванні: пусте поле "Пароль" не змінює пароль; список API-ключів — рядок на ключ.

### Спільне — [public/static/http.js](public/static/http.js)

`api(path, opts)` — обгортка над `fetch('/api' + path)` із `Content-Type: application/json` та `credentials: same-origin`. Повертає `null` для `204`, парсить JSON, кидає `Error` із `body.error` при не-2xx.

## Гарячі клавіші

Слухач навішується через `installShortcuts()` у [public/static/user.js](public/static/user.js#L214) на `window` і **дублюється** в `iframe.contentDocument` (через `attachToFrame` після `load`) — щоб клавіші ловилися й коли фокус усередині таргета. Спрацьовує лише на `Alt + клавіша` (без `Ctrl`/`Meta`) і **ігнорується** в текстових полях (`INPUT`, `TEXTAREA`, `contentEditable`).

| Клавіша | Дія | Реалізація |
| --- | --- | --- |
| `Alt+G` | Зробити скрін iframe і надіслати в Gemini | `triggerGemini()` |
| `Alt+H` | Показати/сховати останню відповідь Gemini | `toggleResult()` |
| `Alt+M` | Показати/сховати верхнє меню (top-bar) | `toggleBar()` |

Для iframe із cross-origin таргета `frame.contentDocument` буде `null` — тоді клавіші ловить тільки зовнішнє вікно. Власне Gemini теж потребує same-origin доступу до iframe (бо знімок робиться з його DOM через `html2canvas`).

## Колесо мишки

Той самий `installShortcuts()` слухає `wheel` (passive: false, capture) і також дублюється в iframe. Спрацьовує **тільки якщо натиснуто `Ctrl` або `Alt`** — звичайне колесо без модифікаторів скролить сторінку як завжди. Cooldown — **700 мс** між діями, щоб довге прокручування не спамило запитами.

| Жест | Дія |
| --- | --- |
| `Ctrl`/`Alt` + колесо вгору (`deltaY < 0`) | `triggerGemini()` — викликати Gemini |
| `Ctrl`/`Alt` + колесо вниз (`deltaY > 0`) | `toggleResult()` — toggle відповіді |

`preventDefault` викликається лише коли спрацював модифікатор — інакше скрол проходить у сторінку/iframe без змін. `Ctrl+wheel` у браузерах за замовчуванням це zoom — у нашому кабінеті він перевизначений під виклик Gemini.

## Меню та налаштування

Top-bar (`<header id="bar">`) за замовчуванням схований; з'являється після успішного логіну. Кнопки:

- **Ім'я користувача** — просто текст.
- **Налаштування** — відкриває модалку з трьома полями:
  - URL сайту → `PUT /api/me/url` → після збереження iframe перезавантажується з нового таргета
  - API ключі (по одному в рядок) → `PUT /api/me/api-keys`
  - Новий пароль (порожньо — не змінювати) → `PUT /api/me/password`
- **Адмін** — посилання на `/admin` (видно лише для `isAdmin=true`).
- **Вихід** — `POST /api/logout`, потім редирект на `/`.

Окремо в правому-нижньому куті — панель Gemini з кнопкою "Скрін" (та сама дія, що й `Alt+G`). Результат — плаваючий блок, який автоматично ховається через **12 секунд** після появи.

## Скріншот для Gemini

Вся обробка — на клієнті ([user.js:88](public/static/user.js#L88)):

1. `getFrameWindow()` бере `iframe.contentWindow`/`contentDocument`. Cross-origin → одразу `Error('iframe недоступний')`.
2. `ensureHtml2Canvas(win)` — підключає [html2canvas 1.4.1](https://html2canvas.hertzen.com/) із CDN у `iframe.contentDocument` (на самій сторінці воно вже є — підвантажене з `<script>` у [user.html](public/user.html)).
3. `captureFrame()` — `html2canvas` із `useCORS`, `allowTaint`, видимою областю (`scrollX/scrollY` + `innerWidth/innerHeight`).
4. `canvasToBase64Jpeg()` — даунскейл до **1600 px** по ширині, JPEG quality **0.7**, base64.
5. `POST /api/gemini/solve` → відповідь показується в `.gemini-result`.

Захист: одночасний запит блокується флагом `busy`; кнопка дизейблиться під час запиту.

## Налаштування

[environments/environment.ts](environments/environment.ts):

| Поле | Опис |
| --- | --- |
| `port` | Порт сервера (за замовчуванням `3000`) |
| `defaultTarget` | URL за замовчуванням, якщо в користувача порожній `target_url` |
| `sessionTtlMs` | Час життя сесії в мілісекундах (1 година) |
| `iframePermissions` | Список дозволів `Permissions-Policy` для iframe (camera, microphone, …) |
| `production` | Зарезервовано (поки не використовується) |

## REST API

Всі відповіді — JSON. Помилки — `{ "error": "..." }`. Cookie `uix_session` встановлюється автоматично після логіну.

### Публічні

| Метод | Шлях | Опис |
| --- | --- | --- |
| POST | `/api/login` | `{name, password}` |
| POST | `/api/login/:id` | `{password}` — логін за id |
| POST | `/api/login/:id/quick` | `{char}` — швидкий вхід за першим символом |
| POST | `/api/admin/login` | Як `/api/login`, але відмовляє не-адмінам |
| POST | `/api/logout` | — |
| GET  | `/api/me` | Поточний користувач |
| GET  | `/api/config` | `{ proxyPath, iframePermissions }` |
| GET  | `/api/users/by-name/:name` | `{ id, name, targetUrl }` |

### Користувач (потребує сесії)

| Метод | Шлях | Тіло |
| --- | --- | --- |
| PUT | `/api/me/url` | `{ url: string }` |
| PUT | `/api/me/password` | `{ password: string }` |
| PUT | `/api/me/api-keys` | `{ apiKeys: string[] }` |
| POST | `/api/gemini/solve` | `{ imageBase64: string }` → `{ answer }` |

### Адміністратор (`isAdmin=true`)

| Метод | Шлях | Опис |
| --- | --- | --- |
| GET | `/api/users` | Список усіх |
| POST | `/api/users` | `{name, password, apiKeys?, isAdmin?, targetUrl?}` |
| GET | `/api/users/:id` | Один користувач |
| PUT | `/api/users/:id` | Часткове оновлення |
| DELETE | `/api/users/:id` | — |

## Безпека

- **Паролі**: scrypt (`node:crypto`), сіль 16 байт, ключ 64 байти, перевірка через `timingSafeEqual`.
- **Швидкий логін** за першим символом працює лише якщо в БД збережено `password_first` (заповнюється при створенні/оновленні пароля або при першому повноцінному вході через `backfillFirstChar`). Для безпеки — це **не** еквівалент звичайного логіна (1 символ → 26+ варіантів), тож вмикайте лише там, де доречно.
- **Сесії** — in-memory `Map`; рестарт процесу скидає всі сесії. Cookie: `HttpOnly; SameSite=Lax; Path=/`.
- **Проксі** знімає `X-Frame-Options`, `Content-Security-Policy[-Report-Only]`, `Strict-Transport-Security`, `Feature-Policy` із відповіді таргета та підставляє свій `Permissions-Policy`.
- **Cookies таргета** з `Domain=...`, `Secure`, `SameSite=*` нормалізуються (примусово `SameSite=Lax`, без `Domain`/`Secure`). Cookie з ім'ям нашої сесії (`uix_session`) ніколи не пересилається в таргет.
- **Path-traversal** для статики блокується перевіркою `target.startsWith(root)` у `safeStaticPath`.

## Запуск

```bash
# Встановити залежності (один раз)
npm install

# Створити першого адміна (аргументи або інтерактивно)
npm run create-admin -- admin "ваш_пароль" "https://example.com"
npm run create-admin

# Розробка (tsx, без компіляції)
npm run dev

# Прод — компіляція + чистий node (мінімум RAM)
npm run build
npm start
```

## Залежності

- **Рантайм**: [`better-sqlite3`](https://github.com/WiseLibs/better-sqlite3)
- **Dev/build**: `tsx`, `typescript`, `@types/node`, `@types/better-sqlite3`
- **CDN на клієнті** (без npm): [html2canvas 1.4.1](https://cdnjs.com/libraries/html2canvas) — для скріншота iframe

bcrypt і Angular повністю прибрані з проєкту.
