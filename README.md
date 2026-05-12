# UIXProtocol

Легкий проксі з мультикористувацькою автентифікацією та опційним AI-помічником на базі Gemini. Один Node-процес, один порт, без фреймворків.

> Англійська версія: [README.en.md](README.en.md)

## Простий старт

Чотири команди — і застосунок працює:

```bash
git clone <url>
npm install
npm run create-admin -- admin "ваш_пароль"
npm run start
```

Відкрийте `http://localhost:3000/admin`, увійдіть як `admin`, створіть користувачів. Кожен з них далі заходить на `http://localhost:3000/` (форма входу) або одразу на `http://localhost:3000/<свій_id>/`.

Потрібен Node.js 20+ та `npm`. База `users.db` створюється сама в корені проєкту при першому запуску.

## Можливості

- Прозорий HTTP/HTTPS-проксі з підміною URL у HTML/JS-відповідях
- Кілька користувачів — у кожного власний `target_url`, який транслюється в iframe
- Повна автентифікація (ім'я + пароль) + швидкий вхід за першим символом пароля
- Адмін-панель: CRUD користувачів, видача прав адміна, керування API-ключами
- Особистий кабінет: змінити цільовий URL, пароль, додати/видалити Gemini API-ключі
- Інтеграція з Google Gemini (через офіційний `@google/genai` SDK): скрін iframe → коротка відповідь на тест
- **Власні промти** з вибором активного — зберігаються в БД на користувача
- **Перемикання моделей**: вмикати/вимикати моделі в налаштуваннях, активна модель циклічно перемикається через `Alt+X`
- **Вкладення файлів**: будь-які файли (PDF, зображення, текст, аудіо, відео тощо) зберігаються в БД і автоматично передаються в Gemini як контекст разом зі скріншотом (через Files API + `createPartFromUri`)
- **Кастомізація вигляду** (шрифт/розмір/колір/фон) для відповіді Gemini та кнопки `S` — зберігається в БД (таблиця `user_appearance`)
- Гарячі клавіші `Alt+G/H/M/C` і керування колесом мишки з модифікатором `Ctrl`/`Alt`
- Невидимий клік-зон 44×44 у правому верхньому куті для відкриття меню
- Назва вкладки та favicon автоматично підхоплюються з цільового сайту
- Адаптивна верстка для мобільних (top-bar, адмін-панель, таблиця користувачів)
- Ізольований "preview"-режим для неавтентифікованих відвідувачів за прямим посиланням `/_p/<id>/...`

## Архітектура

Кожен великий модуль розкладений на кілька маленьких файлів за зоною відповідальності. Точки входу (`server.ts`, `api.ts`, `db.ts`, `gemini.ts`) залишаються — вони ре-експортують решту або диспетчеризують.

### Сервер

**HTTP / маршрутизація:**
| Файл | Призначення |
| --- | --- |
| [scripts/server.ts](scripts/server.ts) | Точка входу: `http.createServer` + диспетчер маршрутів |
| [scripts/server-static.ts](scripts/server-static.ts) | `serveFile`, `safeJsPath` — стрімінг локальних файлів |
| [scripts/server-proxy.ts](scripts/server-proxy.ts) | `performProxy`, `proxyForUser`, `proxyHandle` — реверс-проксі та preview-режим |

**REST API (`/api/*`):**
| Файл | Призначення |
| --- | --- |
| [scripts/api.ts](scripts/api.ts) | Диспетчер: пробує кожну групу хендлерів по черзі |
| [scripts/api-helpers.ts](scripts/api-helpers.ts) | `readJson`, `sendJson`, `getCurrentUser`, `requireAuth` |
| [scripts/api-auth.ts](scripts/api-auth.ts) | Логін / логаут / `/api/me` / `/api/config` / `/api/users/by-name` |
| [scripts/api-me.ts](scripts/api-me.ts) | Налаштування користувача: URL, ключі, пароль, промти, моделі |
| [scripts/api-files.ts](scripts/api-files.ts) | `/api/me/files/*` (CRUD/status/preload) + `/api/gemini/solve` |
| [scripts/api-admin-users.ts](scripts/api-admin-users.ts) | Адмінський CRUD над користувачами |

**База даних (`better-sqlite3`):**
| Файл | Призначення |
| --- | --- |
| [scripts/db.ts](scripts/db.ts) | Re-export із `db-users`, `db-files`, `db-appearance` |
| [scripts/db-connection.ts](scripts/db-connection.ts) | Відкриття БД, схема, рантайм-міграції через `ALTER TABLE` |
| [scripts/db-crypto.ts](scripts/db-crypto.ts) | scrypt-хешування паролів + `safeParseArray` |
| [scripts/db-users.ts](scripts/db-users.ts) | CRUD над `users` + `verify*` |
| [scripts/db-files.ts](scripts/db-files.ts) | CRUD над `user_files`, IDs реюзяться (як у `users`) |
| [scripts/db-appearance.ts](scripts/db-appearance.ts) | `getAppearance`/`setAppearance` для `user_appearance` (JSON-blob на користувача) |

**Gemini (через `@google/genai`):**
| Файл | Призначення |
| --- | --- |
| [scripts/gemini.ts](scripts/gemini.ts) | `solveWithGemini`, `preloadFiles`, `callOnce` — оркестрація |
| [scripts/gemini-cache.ts](scripts/gemini-cache.ts) | In-memory кеш `<apiKey>::<fileId>` → завантажений URI |
| [scripts/gemini-parser.ts](scripts/gemini-parser.ts) | `parseResultText` — витягання короткої відповіді |

**Інше:**
| Файл | Призначення |
| --- | --- |
| [scripts/session.ts](scripts/session.ts) | In-memory сесії, HttpOnly-cookie `uix_session` |
| [scripts/constants.ts](scripts/constants.ts) | Шляхи, MIME, таймаути, `KNOWN_MODELS`, `DEFAULT_PROMPT_TEXT` |
| [scripts/types.ts](scripts/types.ts) | Типи `User`, `UserFile`, `SolveOptions`, `ProxyOpts` тощо |
| [scripts/build-html.ts](scripts/build-html.ts) | Збірка HTML з [pages/](pages) у [public/](public) (posthtml-include + expressions) |
| [scripts/create-admin.ts](scripts/create-admin.ts) | CLI для створення першого адміна |
| [environments/environment.ts](environments/environment.ts) | Конфіг: порт, дефолтний таргет, TTL сесії, iframe-дозволи |

### Клієнт (без фреймворків)

JS і HTML кожної сторінки розкладено за зоною відповідальності — стартовий файл імпортує під-модулі через ES modules.

| Сторінка            | HTML                                                                         | Логіка                                                                                                            |
| ------------------- | ---------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------- |
| Загальний логін     | [pages/login.html](pages/login.html) → `public/login.html`                   | [public/js/login.js](public/js/login.js)                                                                          |
| Кабінет користувача | [pages/user.html](pages/user.html) → `public/user.html`                      | [public/js/user.js](public/js/user.js) (+ `user-appearance`, `user-gemini`, `user-files-status`, `user-settings`) |
| Логін адміна        | [pages/admin-login.html](pages/admin-login.html) → `public/admin-login.html` | [public/js/admin-login.js](public/js/admin-login.js)                                                              |
| Адмін-панель        | [pages/admin.html](pages/admin.html) → `public/admin.html`                   | [public/js/admin.js](public/js/admin.js) (+ `admin-users.js`)                                                     |
| Стилі               | [styles/style.scss](styles/style.scss) → `public/style.css`                  | —                                                                                                                 |
| HTTP-обгортка       | —                                                                            | [public/js/http.js](public/js/http.js) — `api(path, opts)`                                                        |

Розклад модулів `user.js`:

- [public/js/user.js](public/js/user.js) — точка входу, `enterAuthed`, `installFavicon`, `installShortcuts`, `initLogin`, `initModelToast`, `shortModel`
- [public/js/user-appearance.js](public/js/user-appearance.js) — `APPEARANCE_DEFAULTS`, `loadAppearance` (in-memory cache), `fetchAppearance`/`saveAppearance` (через `GET/PUT /api/me/appearance`), `applyAppearance`, `hexToRgba`
- [public/js/user-gemini.js](public/js/user-gemini.js) — `initGemini` (скрін iframe + виклик Gemini через `html2canvas`)
- [public/js/user-files-status.js](public/js/user-files-status.js) — `initFilesStatus` (бейдж статусу файлів + кнопка прогріву)
- [public/js/user-settings.js](public/js/user-settings.js) — `initSettings` (модалка з табами: основні, промти, моделі, файли, вигляд)

`admin.js` розкладено на:

- [public/js/admin.js](public/js/admin.js) — точка входу, перевірка адміна, форма, `setEdit`
- [public/js/admin-users.js](public/js/admin-users.js) — `setupUsers({ tbody, errEl, fieldId, setEdit })` → `{ refresh }`, рендер таблиці, `removeUser`

### Збірка ассетів

Сирі HTML і CSS лежать поза `public/` і компілюються в нього:

- **HTML**: `pages/*.html` із includes (`<include src="partials/...">`) → `public/*.html` через [scripts/build-html.ts](scripts/build-html.ts) (`posthtml` + `posthtml-include` + `posthtml-expressions`).
- **CSS**: `styles/style.scss` (з `@use 'base'`, `'login'`, `'user'`, `'gemini'`, `'modal'`, `'admin'`, `'responsive'`) → `public/style.css` через `sass`.
- **JS**: лежить як є в `public/js/` — без бандлера, ES modules.

`npm run build:assets` запускає обидві стадії; `npm run dev` робить це + стартує `tsx server.ts`. Watch-режим — `npm run build:html:watch` / `npm run build:css:watch` (потрібно тільки коли активно правиш HTML/SCSS).

### Маршрути сервера

- `/` — форма входу (ім'я + пароль), редирект автентифікованих на `/<id>/`
- `/<id>/` — кабінет користувача (iframe + меню) або форма пароля для конкретного користувача
- `/admin` — панель адміністратора (форма входу або UI керування користувачами)
- `/_p/<id>/...` — preview-проксі для неавтентифікованих відвідувачів (без cookies таргета, виставляється `uix_preview` cookie)
- `/style.css` (+ `/style.css.map`) і `/favicon.ico` — статика з `public/`
- `/js/*` — клієнтські модулі з `public/js/`
- `/api/*` — REST (див. нижче)
- решта — fallback-проксі (для абсолютних шляхів усередині проксійованого HTML)

## Серверні модулі — ключові функції

### `server.ts` + `server-static.ts` + `server-proxy.ts`

- `serveFile(res, file)` ([server-static.ts](scripts/server-static.ts)) — стрімить локальний файл із `Cache-Control: no-store`, MIME визначається за розширенням.
- `safeJsPath(reqPath)` ([server-static.ts](scripts/server-static.ts)) — нормалізує шлях для `/js/*` і блокує path-traversal за межі `public/js/`.
- `rewriteUrls(text, targetHost)` ([server-proxy.ts](scripts/server-proxy.ts)) — видаляє `https://<targetHost>` та `http://<targetHost>` із тіла відповіді, щоб усі абсолютні посилання залишилися в межах нашого домену.
- `performProxy(req, res, targetRaw, pathOnly, opts)` ([server-proxy.ts](scripts/server-proxy.ts)) — виконує http(s)-запит до таргета, переписує `Set-Cookie` (зрізає `Domain`, `Secure`, форсить `SameSite=Lax`), знімає `X-Frame-Options` / `Content-Security-Policy` / `Strict-Transport-Security` / `Feature-Policy`, виставляє `Permissions-Policy` зі списку `iframePermissions`. Для `text/html` та `application/javascript` — буферизує тіло і викликає `rewriteUrls`. Опції (`ProxyOpts` із [types.ts](scripts/types.ts)):
  - `sendCookies: false` — не пересилати cookies клієнта в таргет
  - `stripSetCookie: true` — видалити `Set-Cookie` з відповіді (preview-режим)
  - `setPreviewCookie: <userId>` — виставити cookie `uix_preview=<userId>` (HttpOnly, Lax)
- `proxyForUser(req, res, userId, reqPath, preview)` ([server-proxy.ts](scripts/server-proxy.ts)) — підставляє `target_url` користувача (або `defaultTarget`) і викликає `performProxy`.
- `proxyHandle(req, res)` ([server-proxy.ts](scripts/server-proxy.ts)) — порядок резолву "хто власник запиту":
  1. Сесія (`uix_session`) → проксі для користувача сесії
  2. `Referer` починається з `/_p/<id>/` → preview для цього `id`
  3. Cookie `uix_preview` → preview для цього `id`
  4. Інакше — `403`
- `server.ts` сам — лише `http.createServer` із плоским ланцюжком `if`-ів, що відсіюють `/api/*`, `/favicon.ico`, `/style.css`, `/js/*`, `/_p/<id>/`, `/admin`, `/<id>/` та `/`. Усе інше падає в `proxyHandle`.

### `api.ts` (диспетчер) + `api-*.ts` (групи маршрутів)

`handleApi(req, res)` повертає `true`, якщо запит оброблений як `/api/*`, інакше `false` — і керування передається в роутер `server.ts`. Сам диспетчер крихітний: пробує `handleAuth` → `handleMe` → `handleFiles` → `handleAdminUsers`; перший, що повертає `true`, виграє. Інакше — `404`.

Усе тіло читається через `readJson<T>()` ([api-helpers.ts](scripts/api-helpers.ts)) з лімітом 1 МБ (30 МБ для `POST /api/me/files`, 15 МБ для `/api/gemini/solve` через base64-картинку). Помилки серіалізуються у `{ error: "..." }` через `sendJson(res, status, body)`.

`requireAuth(req, res)` (загальний для `api-me`/`api-files`) повертає `User` або `null`, попередньо відписавши `401`. У [api-admin-users.ts](scripts/api-admin-users.ts) додатково є `requireAdmin(req, res)`, що додає перевірку `isAdmin`.

### `db.ts` + `db-connection.ts` + `db-crypto.ts` + `db-users.ts` + `db-files.ts`

`db.ts` — лише re-export із `db-users` і `db-files`, тож імпорти `from './db'` працюють як раніше.

- `hashPassword(password)` / `verifyHash(password, stored)` ([db-crypto.ts](scripts/db-crypto.ts)) — scrypt (`node:crypto`), сіль 16 байт, ключ 64 байти, формат `scrypt$<salt-hex>$<hash-hex>`. Перевірка через `crypto.timingSafeEqual`.
- `firstChar(s)` ([db-crypto.ts](scripts/db-crypto.ts)) — береться через `[...s][0]`, тобто коректно обробляє Unicode-символи (емодзі тощо).
- `createUser` / `updateUser` / `getUserById` / `getUserByName` / `listUsers` / `deleteUser` ([db-users.ts](scripts/db-users.ts)) — CRUD над `users`. `password_first` записується одночасно з `password_hash`. `updateUser` приймає також `prompts`, `activePromptId`, `enabledModels`, `activeModel`. При створенні `id` береться як найменший вільний (`nextUserId()`), щоб заповнювати прогалини після видалень.
- `listUserFiles(userId)` / `getUserFile` / `getUserFiles(userId)` / `addUserFile(userId, name, mime, data)` / `deleteUserFile(userId, fileId)` ([db-files.ts](scripts/db-files.ts)) — CRUD для прикріплених файлів (тип не обмежений: PDF, зображення, текст, аудіо, відео). `addUserFile` працює в транзакції і обирає найменший вільний `id` через `nextFileId()` — так само, як `users`, тож після видалень дірки заповнюються.
- `verifyPasswordById` / `verifyPasswordByName` ([db-users.ts](scripts/db-users.ts)) — повна перевірка пароля; на успіху викликає `backfillFirstChar` (якщо в БД ще немає `password_first`).
- `verifyFirstCharById` ([db-users.ts](scripts/db-users.ts)) — порівнює один символ із `password_first` (без хешу). Працює лише якщо колонка вже заповнена.
- Схема, `PRAGMA journal_mode = WAL` і всі `ALTER TABLE ADD COLUMN`-міграції зібрані в [db-connection.ts](scripts/db-connection.ts) — імпорт цього файлу автоматично готує БД.
- Константи `KNOWN_MODELS` і `DEFAULT_PROMPT_TEXT` живуть у [constants.ts](scripts/constants.ts) (раніше були в `db.ts`).

Схема `users`:

```sql
id              INTEGER PRIMARY KEY AUTOINCREMENT
name            TEXT UNIQUE NOT NULL
password_hash   TEXT NOT NULL
password_first  TEXT NOT NULL DEFAULT ''
api_keys        TEXT NOT NULL DEFAULT '[]'   -- JSON-масив
is_admin        INTEGER NOT NULL DEFAULT 0
target_url      TEXT NOT NULL DEFAULT ''
prompts         TEXT NOT NULL DEFAULT '[]'   -- JSON: [{id, name, text}, ...]
active_prompt_id TEXT NOT NULL DEFAULT ''
enabled_models  TEXT NOT NULL DEFAULT '[]'   -- JSON-масив імен моделей
active_model    TEXT NOT NULL DEFAULT ''
```

Схема `user_files`:

```sql
id          INTEGER PRIMARY KEY AUTOINCREMENT
user_id     INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE
name        TEXT NOT NULL
mime        TEXT NOT NULL
size        INTEGER NOT NULL
data        BLOB NOT NULL
created_at  INTEGER NOT NULL
```

Схема `user_appearance` (один рядок на користувача, JSON-блоб із полями `resultFont/Size/Color/...`, `btnFont/Size/...`, `showFilesStatus`, `showModelToast`):

```sql
user_id  INTEGER PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE
data     TEXT NOT NULL DEFAULT '{}'
```

Усі нові колонки додаються через `ALTER TABLE ADD COLUMN` у рантаймі — стара БД мігрується автоматично при першому запуску.

### `session.ts`

- `parseCookie(req, name)` — парсить заголовок `Cookie`.
- `setSession(res, userId)` — генерує 24-байтний `randomBytes`, base64url, кладе в `Map<sessionId, {userId, expiresAt}>`.
- `getSessionUserId(req)` — читає cookie, перевіряє TTL, видаляє протерміновані.
- `clearSession(req, res)` — видаляє запис із Map і скидає cookie через `Max-Age=0`.
- `clearSessionsForUser(userId)` — очищає всі активні сесії користувача (викликається при видаленні).
- Кожні 60 секунд вичищаються прострочені сесії (`setInterval(...).unref()`).

### `gemini.ts` + `gemini-cache.ts` + `gemini-parser.ts`

Використовує офіційний `@google/genai` SDK замість «голого» `fetch`. Структура виклику:

- `solveWithGemini({ apiKeys, imageBase64, prompt, models, files })` ([gemini.ts](scripts/gemini.ts)) — перебирає моделі в порядку, заданому користувачем (активна модель іде першою), для кожної моделі — всі API-ключі. Перший успіх повертає результат, інакше — кидає останню помилку. Таймаут — 20 с на запит, без авто-ретраїв.
- `uploadFileForKey(client, apiKey, file)` ([gemini-cache.ts](scripts/gemini-cache.ts)) — лінива загрузка `UserFile` (BLOB із БД) у Gemini Files API через `client.files.upload({ file: Blob, config: { mimeType, displayName } })`. Повертає `{ uri, mimeType, expiresAt }`. Результат кешується в пам'яті в `Map<"<apiKey>::<fileId>", UploadedFile>` на ~40 годин (Files API сам тримає файли ~48h).
- Сам запит — `client.models.generateContent({ model, config: { thinkingConfig: { thinkingBudget: model.includes('pro') ? 8000 : 2000 } }, contents })`. У `parts` спочатку текст промту, потім PDF-парти через `createPartFromUri(uri, mime)`, наприкінці — `inlineData` зі скріншотом (JPEG base64).
- `invalidateUploadsForUser(fileIds)` ([gemini-cache.ts](scripts/gemini-cache.ts)) — викликається з [api-files.ts](scripts/api-files.ts) коли користувач видаляє файл, щоб скинути кеш для цього `fileId` по всіх ключах.
- `dropCacheForKey(apiKey)` ([gemini-cache.ts](scripts/gemini-cache.ts)) — скидає всі URI цього ключа; викликається з `solveWithGemini` після провалу.
- `parseResultText(text)` ([gemini-parser.ts](scripts/gemini-parser.ts)) — спочатку шукає `Відповідь:` / `Answer:`, потім перший рядок, що матчить `\d+(,\d+)*` / `\d+(;\d+)*` / `\d+-[а-яa-z]...` / `так|ні`.

Якщо запит до однієї пари (модель, ключ) падає, кеш URI для цього ключа автоматично скидається — наступна спроба перезавантажить файли.

## Сторінки клієнта

### `/<id>/` — кабінет користувача ([public/js/user.js](public/js/user.js))

Логіка:

1. Запит `GET /api/me`.
2. Якщо `me.id === id` (тобто авторизований саме як цей користувач) → `enterAuthed()`.
3. Інакше → `initLogin()` — швидкий вхід.

`enterAuthed(me, { fromLogin })`:

- Показує top-bar з ім'ям, кнопками "Налаштування", "Адмін" (для адмінів), "Вихід".
- Реєструє `barTrigger` (невидимий клік-зон 44×44 у правому верхньому куті) → клік toggle меню.
- Запит `GET /api/config` → ставить `allow="..."` на iframe згідно `iframePermissions` і виставляє `frame.src` в `proxyBase` (`/_p/`), якщо це не редирект після свіжого логіну (`fromLogin=true` — iframe уже показує таргет).
- Імпортує `initGemini()` ([user-gemini.js](public/js/user-gemini.js)), `initFilesStatus()` ([user-files-status.js](public/js/user-files-status.js)), `initSettings()` ([user-settings.js](public/js/user-settings.js)). Реєструє гарячі клавіші / колесо, навішує `frame.addEventListener('load', syncMetaFromFrame)` для синхронізації title/favicon.
- При вході підвантажує збережений вигляд із сервера (`fetchAppearance` → `GET /api/me/appearance`) і застосовує через CSS-змінні (`applyAppearance` із [user-appearance.js](public/js/user-appearance.js)).
- Налаштування зберігаються кількома PUT-запитами — лише для змінених полів: `/me/url`, `/me/api-keys`, `/me/password`, `/me/prompts`, `/me/models`, `/me/appearance`. Файли заливаються/видаляються одразу через `/me/files`.

`initLogin()`:

- Виставляє `frame.src = "/_p/<id>/"` — користувач бачить таргет ще до логіну (preview-режим).
- Показує приховану форму `<input type="password" maxLength="1">`. Подія `input` автоматично надсилає `POST /api/login/<id>/quick` з одним символом, як тільки в полі є рівно один символ.
- На помилці — клас `wrong shake` (CSS-анімація трясіння), фокус повертається на input.

### `/` — повний логін ([public/js/login.js](public/js/login.js))

Звичайна форма `name + password` → `POST /api/login` → редирект на `/<user.id>/`.

### `/admin` ([public/js/admin.js](public/js/admin.js), [public/js/admin-login.js](public/js/admin-login.js))

- Якщо не авторизований як адмін, сервер віддає `admin-login.html` із формою `POST /api/admin/login`. Після успіху — `location.reload()` → сервер віддає `admin.html`.
- В адмін-панелі: таблиця користувачів (id, name, admin, target, к-ть ключів), форма "Створити / Редагувати" та `DELETE /api/users/:id` з `confirm()`.
- Рендер таблиці і `removeUser` живуть у [admin-users.js](public/js/admin-users.js) (`setupUsers({ tbody, errEl, fieldId, setEdit }) → { refresh }`); сама форма та її `setEdit` — у `admin.js`.
- При редагуванні: пусте поле "Пароль" не змінює пароль; список API-ключів — рядок на ключ.

### Спільне — [public/js/http.js](public/js/http.js)

`api(path, opts)` — обгортка над `fetch('/api' + path)` із `Content-Type: application/json` та `credentials: same-origin`. Повертає `null` для `204`, парсить JSON, кидає `Error` із `body.error` при не-2xx.

## Гарячі клавіші

Слухач навішується через `installShortcuts()` у [public/js/user.js](public/js/user.js) на `window` і **дублюється** в `iframe.contentDocument` (через `attachToFrame` після `load`) — щоб клавіші ловилися й коли фокус усередині таргета. Спрацьовує лише на `Alt + клавіша` (без `Ctrl`/`Meta`) і **ігнорується** в текстових полях (`INPUT`, `TEXTAREA`, `contentEditable`).

| Клавіша | Дія                                                       | Реалізація                                                                                               |
| ------- | --------------------------------------------------------- | -------------------------------------------------------------------------------------------------------- |
| `Alt+G` | Зробити скрін iframe і надіслати в Gemini                 | `triggerGemini()`                                                                                        |
| `Alt+H` | Показати/сховати останню відповідь Gemini                 | `toggleResult()`                                                                                         |
| `Alt+M` | Показати/сховати верхнє меню (top-bar)                    | `toggleBar()`                                                                                            |
| `Alt+C` | Перемкнути активну Gemini-модель на наступну з увімкнених | `cycleModel()` — `PUT /api/me/active-model`, скорочена назва спливає в `#modelToast` (правий нижній кут) |

Для iframe із cross-origin таргета `frame.contentDocument` буде `null` — тоді клавіші ловить тільки зовнішнє вікно. Власне Gemini теж потребує same-origin доступу до iframe (бо знімок робиться з його DOM через `html2canvas`).

## Колесо мишки

Той самий `installShortcuts()` слухає `wheel` (passive: false, capture) і також дублюється в iframe. Спрацьовує **тільки якщо натиснуто `Ctrl` або `Alt`** — звичайне колесо без модифікаторів скролить сторінку як завжди. Cooldown — **700 мс** між діями, щоб довге прокручування не спамило запитами.

| Жест                                       | Дія                                  |
| ------------------------------------------ | ------------------------------------ |
| `Ctrl`/`Alt` + колесо вгору (`deltaY < 0`) | `triggerGemini()` — викликати Gemini |
| `Ctrl`/`Alt` + колесо вниз (`deltaY > 0`)  | `toggleResult()` — toggle відповіді  |

`preventDefault` викликається лише коли спрацював модифікатор — інакше скрол проходить у сторінку/iframe без змін. `Ctrl+wheel` у браузерах за замовчуванням це zoom — у нашому кабінеті він перевизначений під виклик Gemini.

## Меню та налаштування

### Тригер меню

`<div id="barTrigger" class="bar-trigger">` — невидимий клік-зон **44×44 px** у правому верхньому куті (`position: fixed; top: 0; right: 0; background: transparent; z-index: 90`). Той самий клік відкриває й закриває меню (як `Alt+M`). У `.bar` зарезервовано `padding-right: 60px` (44 px тригера + 16 px буфер), щоб кнопка «Вихід» не перекривалася.

### Top-bar

`<header id="bar">` за замовчуванням схований; з'являється після успішного логіну. Стан показу — клас `.show`, перехід через `transform: translateY(-100%)` ↔ `translateY(0)` із `transition .2s`.

Кнопки:

- **Ім'я користувача** — просто текст.
- **Налаштування** — модалка з табами:
  - **Основні**: URL сайту → `PUT /api/me/url`, API ключі → `PUT /api/me/api-keys`, новий пароль (порожньо — не змінювати) → `PUT /api/me/password`.
  - **Промти**: довільна кількість іменованих промтів, один обраний як активний (radio). Зберігається в `prompts` + `active_prompt_id` через `PUT /api/me/prompts`.
  - **Моделі**: чекбокси по списку `KNOWN_MODELS`, radio для активної моделі, підказка про `Alt+C`. Зберігається через `PUT /api/me/models`.
  - **Файли**: довільні файли (PDF, зображення, текст, аудіо, відео…), що передаються в Gemini контекстом. Додавання — `POST /api/me/files` (base64, MIME визначається браузером), видалення — `DELETE /api/me/files/:id`.
  - **Вигляд**: окремо для відповіді Gemini та кнопки `S` — шрифт, розмір, колір тексту, колір фону + чекбокс «прозорий фон». Live-preview через CSS-змінні; зберігається на сервері в таблиці `user_appearance` через `PUT /api/me/appearance`. Зміни застосовуються миттєво (CSS-змінні), кнопка «Скасувати» відновлює попередній збережений набір (із in-memory кешу). Чекбокси «показувати статус файлів»/«показувати тост моделі» відсилаються на сервер відразу після кліку.
- **Адмін** — посилання на `/admin` (тільки для `isAdmin=true`).
- **Вихід** — `POST /api/logout`, редирект на `/`.

### Панель Gemini

Кнопка-«S» (`#screenshotBtn`) — у **верхньому лівому** куті (`top: 1rem; left: 1rem`). Стиль за замовчуванням: `background: transparent`, напівпрозорий темний текст, подвійний `text-shadow` (білий glow + темний drop) — читається і на білому, і на темному фоні. Hover підвищує контраст.

Результат (`#geminiResult`) — у **лівому нижньому** куті, той самий прозорий стиль із тінню. Автоматично ховається через **12 секунд**. Помилки виводяться тим самим стилем без червоного кольору.

Стиль кнопки і результату керується через CSS-змінні (`--screenshot-font/size/color/bg`, `--result-font/size/color/bg`), що виставляються `applyAppearance()` на основі даних із таблиці `user_appearance` (підвантажуються `fetchAppearance()` після успішної автентифікації). Це дозволяє змінювати шрифт/розмір/колір/фон обох елементів через таб «Вигляд» без перезавантаження.

### Назва вкладки та favicon

Кабінет автоматично підхоплює назву та іконку з цільового сайту:

- **Favicon (без JS)**: у [pages/user.html](pages/user.html) тег `<link rel="icon" id="favicon" href="/_p/favicon.ico">`. Браузер запитує `/_p/favicon.ico` → `proxyHandle` → проксі-запит на `/favicon.ico` цільового сайту. Працює ще до завантаження iframe.
- **Title + кастомні іконки** (`syncMetaFromFrame` у [public/js/user.js](public/js/user.js)) — на `iframe.load`:
  - `document.title = frame.contentDocument.title` (same-origin через проксі); якщо в таргеті title порожній — fallback на `me.name`.
  - Шукає `<link rel~="icon">` чи `<link rel="shortcut icon">` у iframe-документі. Якщо origin збігається з нашим — підставляє `/_p<path>` (іде через проксі); якщо CDN іншого хоста — використовує абсолютний URL без змін (для favicon CORS не діє).
- Спрацьовує на кожен `load` iframe-а — внутрішня навігація (anchor-кліки в таргеті) теж синхронізує title/favicon.

## Скріншот для Gemini

Клієнт (`initGemini` у [public/js/user-gemini.js](public/js/user-gemini.js)):

1. `getFrameWindow()` бере `iframe.contentWindow`/`contentDocument`. Cross-origin → одразу `Error('iframe недоступний')`.
2. `ensureHtml2Canvas(win)` — підключає [html2canvas 1.4.1](https://html2canvas.hertzen.com/) із CDN у `iframe.contentDocument` (на самій сторінці воно вже є — підвантажене з `<script>` у [pages/user.html](pages/user.html)).
3. `captureFrame()` — `html2canvas` із `useCORS`, `allowTaint`. Захоплюється **повна ширина сайту** (`documentElement.scrollWidth`, з `x: 0`) і лише **висота вьюпорта** (`innerHeight`, з `y: scrollY`) — тобто якщо проксійований сайт ширший за екран телефона, у скріншот потрапляє все, що праворуч за межами видимої області, а вертикально — те, що навколо поточної позиції скролу.
4. `canvasToBase64Jpeg()` — даунскейл до **1600 px** по ширині, JPEG quality **0.7**, base64.
5. `POST /api/gemini/solve` із одним лише `imageBase64`. Активний промт, активна модель і прикріплені файли беруться сервером із даних користувача в БД.
6. Відповідь показується в `.gemini-result`.

Сервер ([api-files.ts](scripts/api-files.ts) → [gemini.ts](scripts/gemini.ts)):

- Бере активний промт користувача (fallback — перший зі списку, потім `DEFAULT_PROMPT_TEXT`).
- Формує список моделей: спочатку `activeModel`, далі решта `enabledModels`. Якщо нічого не вибрано — fallback на `gemini-2.5-flash`.
- Підвантажує всі `user_files` користувача (будь-якого типу — PDF/зображення/текст/аудіо/відео), передає їх у `solveWithGemini` → `client.files.upload` (з кешуванням URI per ключ).

Захист: одночасний запит блокується флагом `busy`; кнопка дизейблиться під час запиту.

## Адаптивність (мобільні)

Один media-блок у [styles/\_responsive.scss](styles/_responsive.scss) (компілюється в `public/style.css`) — `@media (max-width: 640px)`:

- **Top-bar**: `flex-wrap: wrap`, шрифт `.8rem`, gap `.4rem`. Ім'я користувача отримує `flex-basis: 100%` (переноситься в окремий рядок) із `text-overflow: ellipsis` для довгих імен. Padding `.5rem 60px .5rem .75rem` — права частина зарезервована під тригер.
- **Адмін-панель**:
  - `.admin { padding: 1rem }` (замість 2rem)
  - `.admin__header` — `flex-wrap: wrap`, заголовок «Користувачі» переноситься на свій рядок (`flex-basis: 100%`), кнопки «До свого акаунта»/«Вихід» розтягуються на повну ширину (`flex: 1`)
  - `.admin__spacer { display: none }` — на мобільному не потрібен
  - `.form { max-width: 100% }`, `.form__actions` — кнопки `flex: 1`
  - `.section { overflow-x: auto }` — таблиця користувачів отримує **горизонтальний скрол** замість стискання колонок
  - У `.table` — менші паддинги/шрифт, `truncate` обмежено 140 px
- **Gemini-результат** — `max-width: 80vw` замість 50vw, шрифт `.85rem`.
- **Модалка налаштувань** — `padding: 1rem` замість 1.5rem.

## Налаштування

[environments/environment.ts](environments/environment.ts):

| Поле                | Опис                                                                    |
| ------------------- | ----------------------------------------------------------------------- |
| `port`              | Порт сервера (за замовчуванням `3000`)                                  |
| `defaultTarget`     | URL за замовчуванням, якщо в користувача порожній `target_url`          |
| `sessionTtlMs`      | Час життя сесії в мілісекундах (1 година)                               |
| `iframePermissions` | Список дозволів `Permissions-Policy` для iframe (camera, microphone, …) |
| `production`        | Зарезервовано (поки не використовується)                                |

## REST API

Всі відповіді — JSON. Помилки — `{ "error": "..." }`. Cookie `uix_session` встановлюється автоматично після логіну.

### Публічні

| Метод | Шлях                       | Опис                                                                                        |
| ----- | -------------------------- | ------------------------------------------------------------------------------------------- |
| POST  | `/api/login`               | `{name, password}`                                                                          |
| POST  | `/api/login/:id`           | `{password}` — логін за id                                                                  |
| POST  | `/api/login/:id/quick`     | `{char}` — швидкий вхід за першим символом                                                  |
| POST  | `/api/admin/login`         | Як `/api/login`, але відмовляє не-адмінам                                                   |
| POST  | `/api/logout`              | —                                                                                           |
| GET   | `/api/me`                  | Поточний користувач (включно з `prompts`, `activePromptId`, `enabledModels`, `activeModel`) |
| GET   | `/api/config`              | `{ proxyPath, iframePermissions, knownModels, defaultPrompt }`                              |
| GET   | `/api/users/by-name/:name` | `{ id, name, targetUrl }`                                                                   |

### Користувач (потребує сесії)

| Метод  | Шлях                   | Тіло / результат                                                                     |
| ------ | ---------------------- | ------------------------------------------------------------------------------------ |
| PUT    | `/api/me/url`          | `{ url: string }`                                                                    |
| PUT    | `/api/me/password`     | `{ password: string }`                                                               |
| PUT    | `/api/me/api-keys`     | `{ apiKeys: string[] }`                                                              |
| PUT    | `/api/me/prompts`      | `{ prompts: {id,name,text}[], activePromptId?: string }`                             |
| PUT    | `/api/me/models`       | `{ enabledModels: string[], activeModel?: string }` (фільтрується за `KNOWN_MODELS`) |
| PUT    | `/api/me/active-model` | `{ activeModel: string }` — має бути в `enabledModels`                               |
| GET    | `/api/me/appearance`   | JSON-обʼєкт із налаштуваннями вигляду (`{}` якщо ще не збережено)                    |
| PUT    | `/api/me/appearance`   | Повний JSON-обʼєкт налаштувань → пише в `user_appearance.data`                       |
| GET    | `/api/me/files`        | `[{id, name, mime, size, createdAt}]`                                                |
| POST   | `/api/me/files`        | `{ name, mime, dataBase64 }` → метадані файлу (ліміт 30 МБ)                          |
| DELETE | `/api/me/files/:id`    | `204`, скидає кеш URI у `gemini.ts`                                                  |
| POST   | `/api/gemini/solve`    | `{ imageBase64: string }` → `{ answer }`. Промт/моделі/PDF беруться з БД             |

### Адміністратор (`isAdmin=true`)

| Метод  | Шлях             | Опис                                               |
| ------ | ---------------- | -------------------------------------------------- |
| GET    | `/api/users`     | Список усіх                                        |
| POST   | `/api/users`     | `{name, password, apiKeys?, isAdmin?, targetUrl?}` |
| GET    | `/api/users/:id` | Один користувач                                    |
| PUT    | `/api/users/:id` | Часткове оновлення                                 |
| DELETE | `/api/users/:id` | —                                                  |

## Безпека

- **Паролі**: scrypt (`node:crypto`), сіль 16 байт, ключ 64 байти, перевірка через `timingSafeEqual`.
- **Швидкий логін** за першим символом працює лише якщо в БД збережено `password_first` (заповнюється при створенні/оновленні пароля або при першому повноцінному вході через `backfillFirstChar`). Для безпеки — це **не** еквівалент звичайного логіна (1 символ → 26+ варіантів), тож вмикайте лише там, де доречно.
- **Сесії** — in-memory `Map`; рестарт процесу скидає всі сесії. Cookie: `HttpOnly; SameSite=Lax; Path=/`.
- **Проксі** знімає `X-Frame-Options`, `Content-Security-Policy[-Report-Only]`, `Strict-Transport-Security`, `Feature-Policy` із відповіді таргета та підставляє свій `Permissions-Policy`.
- **Cookies таргета** з `Domain=...`, `Secure`, `SameSite=*` нормалізуються (примусово `SameSite=Lax`, без `Domain`/`Secure`). Cookie з ім'ям нашої сесії (`uix_session`) ніколи не пересилається в таргет.
- **Path-traversal** для статики блокується перевіркою `target.startsWith(root)` у `safeJsPath` ([server-static.ts](scripts/server-static.ts)).

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

- **Рантайм**: [`better-sqlite3`](https://github.com/WiseLibs/better-sqlite3), [`@google/genai`](https://www.npmjs.com/package/@google/genai) — офіційний SDK Gemini API (Files API + `generateContent`)
- **Dev/build**: `tsx`, `typescript`, `@types/node`, `@types/better-sqlite3`, `sass` (компіляція [styles/style.scss](styles/style.scss) → `public/style.css`), `posthtml` + `posthtml-include` + `posthtml-expressions` (збірка `pages/*.html` → `public/*.html`)
- **CDN на клієнті** (без npm): [html2canvas 1.4.1](https://cdnjs.com/libraries/html2canvas) — для скріншота iframe
