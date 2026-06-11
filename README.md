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

Потрібен Node.js 20+ та `npm`. База `users.db` створюється сама в корені проєкту при першому запуску. Тоді ж генерується ключ шифрування `db-secret.key` (32 байти, gitignored) — **зробіть його резервну копію**: без нього зашифровані поля БД не відновити. Для прод-середовища задайте ключ через змінну `UIX_DB_KEY` (32 байти у hex або base64) замість файлу.

## Можливості

- Прозорий HTTP/HTTPS-проксі з підміною URL у HTML/JS-відповідях
- Кілька користувачів — у кожного власний `target_url`, який транслюється в iframe
- Повна автентифікація (ім'я + пароль) + швидкий вхід за першим символом пароля
- Адмін-панель: CRUD користувачів, видача прав адміна, керування API-ключами
- Особистий кабінет: змінити цільовий URL, пароль, додати/видалити Gemini API-ключі
- Інтеграція з Google Gemini (через офіційний `@google/genai` SDK): скрін iframe → коротка відповідь на тест
- **Власні промти** з вибором активного — зберігаються в БД на користувача
- **Перемикання моделей**: вмикати/вимикати моделі в налаштуваннях, активна модель циклічно перемикається через `Alt+C`. Запит йде **тільки в активну модель** (без fallback на інші, щоб не палити квоту на резерв)
- **Вкладення файлів**: будь-які файли (PDF, зображення, текст, аудіо, відео тощо) зберігаються в БД і автоматично передаються в Gemini як контекст разом зі скріншотом (через Files API + `createPartFromUri`)
- **Варіанти вигляду відповіді Gemini** (Alt+V) — кілька іменованих пресетів стилю (шрифт/колір/фон), перемикаються по колу
- **Кастомізація вигляду** (шрифт/розмір/колір/фон) для відповіді Gemini, кнопки `S` та активного стану кнопки `Д` — зберігається в БД (таблиця `user_appearance`)
- **Допомога друга** (Alt+F або кнопка `Д`) — підключаєш помічника за іменем, скрін летить йому, відповідь з'являється на місці Gemini-відповіді. Real-time через SSE
- **Авто-акцепт запитів друга** — помічник може задати список імен або `'*'` у `appearance.friendAutoAccept`; відповідні запити автоматично стають `active` без підтвердження
- **Пошук користувачів** (`GET /me/friends/users?q=`) — для вибору помічника з переліку, до 60 результатів із прапором `isOnline`
- **Troll mode** — адмін вмикає для конкретного юзера через `PUT /users/:id/troll-mode`; відображається в переліку `GET /users`
- **Online status** — прапор `isOnline` повертається в `GET /users` (адмін) та пошуку юзерів; онлайн = є активне SSE-підключення
- **IP-ротація через ноути** — центральний сервер може форвардити вихідні запити до target через одного з кількох ноутів-relay (sticky per userId), target бачить IP конкретного ноута, а не центрального сервера
- Гарячі клавіші `Alt+G/H/M/C/F/V` і керування колесом мишки з модифікатором `Ctrl`/`Alt`
- **Гід-помічник** (🤖) — стартовий онбоардинг із 8 кроків по основних фішках (`S`-кнопка, Alt-хоткеї, режим друга, архів, налаштування). За замовчуванням показується одноразово на першому вході, повторно вмикається в `Налаштуваннях → Вигляд → "Показувати гід-помічника"`
- Невидимий клік-зон 44×44 у правому верхньому куті для відкриття меню
- Назва вкладки та favicon автоматично підхоплюються з цільового сайту
- Адаптивна верстка для мобільних (top-bar, адмін-панель, таблиця користувачів)
- Ізольований "preview"-режим для неавтентифікованих відвідувачів за прямим посиланням `/_p/<id>/...`

## Архітектура

Код у `scripts/` розкладено по теках за зоною відповідальності. Кожна тека з кількох файлів має `index.ts`-барель (`db/`, `gemini/`), тож імпорти `from '../db'` працюють як єдина точка входу.

```
scripts/
├── server/   server.ts (точка входу), proxy.ts, static.ts,
│             relay-pool.ts (health check), websocket.ts, stream-rewrite.ts
├── api/      router.ts, helpers.ts, auth.ts, me.ts, files.ts, questions.ts,
│             admin-users.ts, friends.ts (SSE), diag.ts
├── db/       index.ts, connection.ts, crypto.ts, cipher.ts, users.ts, files.ts,
│             questions.ts, appearance.ts, errors.ts, friends.ts, migrate.ts
├── gemini/   index.ts, cache.ts, parser.ts
├── auth/     session.ts
├── shared/   constants.ts, types.ts
└── tools/    create-admin.ts, build-html.ts, decrypt.ts,
              laptop-proxy.ts (relay на ноуті, порт як аргумент)
```

### Сервер

**HTTP / маршрутизація:**
| Файл | Призначення |
| --- | --- |
| [scripts/server/server.ts](scripts/server/server.ts) | Точка входу: `http.createServer` + диспетчер маршрутів |
| [scripts/server/static.ts](scripts/server/static.ts) | `serveFile`, `safeJsPath` — стрімінг локальних файлів |
| [scripts/server/proxy.ts](scripts/server/proxy.ts) | `performProxy`, `proxyForUser`, `proxyHandle` — реверс-проксі та preview-режим. Relay-запити мають таймаут 10 с |
| [scripts/server/relay-pool.ts](scripts/server/relay-pool.ts) | `initRelayPool`, `pickRelay`, `reportRelayFailure` — health check кожні 10 с, швидкий re-check при відновленні реле, exponential backoff recovery |
| [scripts/server/websocket.ts](scripts/server/websocket.ts) | WebSocket upgrade, session validation, TLS/TCP тунель |
| [scripts/server/stream-rewrite.ts](scripts/server/stream-rewrite.ts) | `HostStripStream` — стримінгова заміна хоста в JS-відповідях |

**REST API (`/_uix/api/*`):**
| Файл | Призначення |
| --- | --- |
| [scripts/api/router.ts](scripts/api/router.ts) | Диспетчер: пробує кожну групу хендлерів по черзі |
| [scripts/api/helpers.ts](scripts/api/helpers.ts) | `readJson`, `sendJson`, `getCurrentUser`, `requireAuth` |
| [scripts/api/auth.ts](scripts/api/auth.ts) | Логін / логаут / `/_uix/api/me` / `/_uix/api/config` / `/_uix/api/users/by-name` |
| [scripts/api/me.ts](scripts/api/me.ts) | Налаштування користувача: URL, ключі, пароль, промти, моделі |
| [scripts/api/files.ts](scripts/api/files.ts) | `/_uix/api/me/files/*` (CRUD/status/preload) + `/_uix/api/gemini/solve` |
| [scripts/api/questions.ts](scripts/api/questions.ts) | Архів питань: список, додавання, редагування, шеринг |
| [scripts/api/admin-users.ts](scripts/api/admin-users.ts) | Адмінський CRUD над користувачами |

**База даних (`better-sqlite3`):**
| Файл | Призначення |
| --- | --- |
| [scripts/db/index.ts](scripts/db/index.ts) | Барель: re-export із `users`, `files`, `appearance`, `questions` |
| [scripts/db/connection.ts](scripts/db/connection.ts) | Відкриття БД, схема, рантайм-міграції через `ALTER TABLE` |
| [scripts/db/crypto.ts](scripts/db/crypto.ts) | scrypt-хешування паролів + `safeParseArray` |
| [scripts/db/cipher.ts](scripts/db/cipher.ts) | Реверсивне шифрування полів/BLOB (AES-256-GCM): `encrypt`/`decrypt`, `encryptBuffer`/`decryptBuffer` |
| [scripts/db/users.ts](scripts/db/users.ts) | CRUD над `users` + `verify*` + `touchUserLastSeen` |
| [scripts/db/files.ts](scripts/db/files.ts) | CRUD над `user_files`, IDs реюзяться (як у `users`) |
| [scripts/db/questions.ts](scripts/db/questions.ts) | CRUD над `user_questions` + `shareQuestions` |
| [scripts/db/appearance.ts](scripts/db/appearance.ts) | `getAppearance`/`setAppearance` для `user_appearance` (JSON-blob на користувача) |
| [scripts/db/migrate.ts](scripts/db/migrate.ts) | Окремий міграційний runner: `npm run migrate` — читає `migrations/*.ts\|.js`, трекає в `migrations_applied` |

**Gemini (через `@google/genai`):**
| Файл | Призначення |
| --- | --- |
| [scripts/gemini/index.ts](scripts/gemini/index.ts) | `solveWithGemini`, `preloadFiles`, `callOnce` — оркестрація |
| [scripts/gemini/cache.ts](scripts/gemini/cache.ts) | In-memory кеш `<apiKey>::<fileId>` → завантажений URI |
| [scripts/gemini/parser.ts](scripts/gemini/parser.ts) | `parseResultText` — витягання короткої відповіді |

**Інше:**
| Файл | Призначення |
| --- | --- |
| [scripts/auth/session.ts](scripts/auth/session.ts) | In-memory сесії, HttpOnly-cookie `uix_session` |
| [scripts/shared/constants/gemini.ts](scripts/shared/constants/gemini.ts) | `KNOWN_MODELS`, `DEFAULT_PROMPT_TEXT`, `STRUCTURED_SUFFIX`, `QDATA_RE`, таймаути |
| [scripts/shared/constants/proxy-scripts.ts](scripts/shared/constants/proxy-scripts.ts) | Injected скрипти: `KEEP_ACTIVE_SCRIPT` (visibility/focus spoof + idle jitter), `CROSS_ORIGIN_PROXY_SCRIPT` (rewrite fetch/XHR), `IP_DIAG_SCRIPT`, `TURNSTILE_STUB_SCRIPT` |
| [scripts/shared/types.ts](scripts/shared/types.ts) | Типи `User`, `UserFile`, `SolveOptions`, `ProxyOpts` тощо |
| [scripts/tools/build-html.ts](scripts/tools/build-html.ts) | Збірка HTML з [pages/](pages) у [public/](public) (posthtml-include + expressions) |
| [scripts/tools/create-admin.ts](scripts/tools/create-admin.ts) | CLI для створення першого адміна |
| [scripts/tools/decrypt.ts](scripts/tools/decrypt.ts) | CLI ручного розшифрування (`npm run decrypt`) |
| [scripts/tools/laptop-proxy.ts](scripts/tools/laptop-proxy.ts) | Relay на ноуті. Порт — перший аргумент CLI або `8787` за замовчуванням (`npm run start:laptop-proxy -- 8788`) |
| [environments/environment.ts](environments/environment.ts) | Конфіг: порт, дефолтний таргет, TTL сесії, iframe-дозволи, `forwardProxies` |

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
- [public/js/user-appearance.js](public/js/user-appearance.js) — `APPEARANCE_DEFAULTS`, `loadAppearance` (in-memory cache), `fetchAppearance`/`saveAppearance` (через `GET/PUT /_uix/api/me/appearance`), `applyAppearance`, `hexToRgba`
- [public/js/user-gemini.js](public/js/user-gemini.js) — `initGemini` (скрін iframe + виклик Gemini через `html2canvas`)
- [public/js/user-files-status.js](public/js/user-files-status.js) — `initFilesStatus` (бейдж статусу файлів + кнопка прогріву)
- [public/js/user-settings.js](public/js/user-settings.js) — `initSettings` (модалка з табами: основні, промти, моделі, файли, вигляд)

`admin.js` розкладено на:

- [public/js/admin.js](public/js/admin.js) — точка входу, перевірка адміна, форма, `setEdit`
- [public/js/admin-users.js](public/js/admin-users.js) — `setupUsers({ tbody, errEl, fieldId, setEdit })` → `{ refresh }`, рендер таблиці, `removeUser`

### Збірка ассетів

Сирі HTML і CSS лежать поза `public/` і компілюються в нього:

- **HTML**: `pages/*.html` із includes (`<include src="partials/...">`) → `public/*.html` через [scripts/tools/build-html.ts](scripts/tools/build-html.ts) (`posthtml` + `posthtml-include` + `posthtml-expressions`).
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
- `/_uix/api/*` — REST (див. нижче)
- решта — fallback-проксі (для абсолютних шляхів усередині проксійованого HTML)

## Мультиноут / IP-ротація через forward-relay

Центральний сервер може форвардити вихідні запити до target через ноути-relay, щоб **target бачив IP конкретного ноута**, а не центрального сервера. Корисно щоб уникнути ситуації "всі студенти ходять з одного IP".

### Архітектура

```
Браузер ──► центральний сервер (myapp.com)
                │
                │  proxy.ts вибирає sticky-ноут за userId
                │  outbound HTTP-запит з X-Relay-Url = target
                ▼
        локальний relay-ендпоінт на ноуті (cloudflared / SSH-tunnel)
                │
                │  laptop-proxy.ts читає X-Relay-Url,
                │  перевикликає до target з власної мережі
                ▼
        target (бачить IP ноута)
```

Sticky-вибір: `forwardProxies[userId % forwardProxies.length]` — один юзер завжди йде через той самий ноут, інакше target помітить "стрибки" IP в межах однієї сесії і може анулювати куки.

### На ноуті — запустити relay

```bash
# 1) Скачай репо та постав залежності
git clone <repo>; npm install

# 2) Запусти relay + SSH тунель однією командою (порт 8787 за замовчуванням)
npm run start:relay

# Якщо треба інший порт (наприклад другий ноут)
RELAY_PORT=8788 npm run start:relay
```

Команда `start:relay` одночасно піднімає SSH reverse tunnel до `root@178.105.54.231` і запускає `laptop-proxy.ts` на вказаному порту. Тунель налаштований з keepalive (`ServerAliveInterval=10`, `ServerAliveCountMax=3`) і `ExitOnForwardFailure=yes` — якщо порт на сервері зайнятий, SSH одразу завершиться з помилкою замість тихого збою.

Порт `laptop-proxy.ts` можна передати як аргумент і без `start:relay`:

```bash
npx tsx scripts/tools/laptop-proxy.ts 8788
```

Тепер треба зробити порт доступним для центрального сервера. Є три варіанти:

#### Варіант A: SSH reverse tunnel (вбудований у `start:relay`)

`npm run start:relay` вже робить це автоматично. Якщо хочеш підняти тунель вручну:

```bash
ssh -R 8787:localhost:8787 \
  -o ServerAliveInterval=10 -o ServerAliveCountMax=3 \
  -o ExitOnForwardFailure=yes \
  root@178.105.54.231
```

З точки зору центрального сервера relay сидить на `localhost:8787`. В `environments/environment.ts`:

```ts
forwardProxies: ['http://localhost:8787'],
```

Для автоматичного перепідключення після обриву — `autossh`:

```bash
autossh -M 0 -N -o ServerAliveInterval=10 -o ServerAliveCountMax=3 \
  -o ExitOnForwardFailure=yes \
  -R 8787:localhost:8787 root@178.105.54.231
```

`apt install autossh` (Debian/Ubuntu) або `brew install autossh` (macOS).

#### Варіант B: cloudflared tunnel (HTTPS, без SSH)

```bash
cloudflared tunnel --url http://localhost:8787
# отримаєш https://random-name.trycloudflare.com
```

У `forwardProxies` записати повний URL:

```ts
forwardProxies: ['https://random-name.trycloudflare.com'],
```

Плюси: HTTPS, авто-перепідключення. Мінуси: домен генерується випадково (для постійного потрібен named tunnel з прив'язкою до домену).

#### Варіант C: ngrok

```bash
ngrok http 8787
# https://abc.ngrok.io
```

Безкоштовний tier — HTTPS only, URL змінюється при перезапуску.

### Декілька ноутів = ротація між юзерами

```ts
forwardProxies: [
  'http://localhost:8787',                  // ноут A через SSH-R
  'https://abc.trycloudflare.com',          // ноут B через cloudflared
  'https://xyz.trycloudflare.com',          // ноут C
],
```

- userId=1 → ноут B (1 % 3 = 1)
- userId=2 → ноут C (2 % 3 = 2)
- userId=3 → ноут A (3 % 3 = 0)
- userId=4 → знову B …

Юзер залишається на "своєму" ноуті між сесіями, тож куки таргета не злітають.

### Як перевірити що relay реально працює

Відкрий проксійовану сторінку → DevTools → Console. Має бути 3 рядки `[UIX-IP]`:

```
[UIX-IP] браузер → зовні (реальний IP клієнта): X.X.X.X         ← IP студента
[UIX-IP] центральний сервер → зовні (прямий):   Y.Y.Y.Y         ← IP VPS (повз relay)
[UIX-IP] через ноут-relay → зовні:              Z.Z.Z.Z         ← IP ноута ✓
```

Третій рядок — це що бачить target. Якщо там IP центрального сервера — relay не працює (тунель упав / secret не той / `forwardProxies` порожнє). Якщо там IP ноута — все добре.

Реалізація: [scripts/api/diag.ts](scripts/api/diag.ts) `probeViaRelay`, виклик зі скрипта `IP_DIAG_SCRIPT` в [scripts/server/proxy.ts](scripts/server/proxy.ts).

### Безпека relay

Relay слухає на `0.0.0.0` — будь-хто, хто дотягнеться до порту, може використати ноут як open proxy. Тому тунелюй через SSH (порт відкривається тільки на `localhost` сервера) або обмеж доступ фаєрволом. Cloudflared і ngrok мають власний шар автентифікації.

## Допомога друга (friend-help)

Юзер A може отримати допомогу від юзера B у режимі реального часу: A натискає кнопку `S` / `Alt+G`, скрін летить B-у в чат-модал, B пише відповідь — A бачить її там же де відповідь Gemini. Real-time транспорт — Server-Sent Events.

### Flow

1. **A → запит**: Settings → таб "Друзі" → ввести ім'я B → "Запросити". У БД створюється `friend_connections` зі `status='pending'`. SSE-подія `request` летить B-у. **Якщо B налаштував `appearance.friendAutoAccept`** (список імен або `'*'`) — запит від A автоматично стає `active`, SSE-подія `accepted` летить обом без ручного підтвердження.
2. **B → акцепт** (без авто-акцепту): бачить toast "запит на допомогу від A" + у своєму "Друзі" з'являється рядок "Прийняти/Відхилити". Прийняти → `status='active'`. SSE-подія `accepted` летить A-у.
3. **A → режим друга**: `Alt+F` (або клік на кнопку `Д` поряд з `S`) → toast "режим: ДРУГ (<ім'я B>)", кнопка `Д` підсвічується синім.
4. **A → надсилає скрін**: натискає `S` / `Alt+G` / `Ctrl+wheel-up` → скрін iframe → `POST /_uix/api/me/friends/screenshot` → SSE-подія `screenshot` (з base64 картинкою) летить B-у. У A в `#geminiResult` напис "очікую відповідь…".
5. **B → відповідь**: автоматично відкривається модал "Допомога другу" з картинкою. B пише текст → "Надіслати" / `Ctrl+Enter` → `POST /_uix/api/me/friends/reply`. SSE-подія `reply` летить A-у і містить `helperModel` (активна модель B або `null`).
6. **A → бачить відповідь**: текст з'являється в `#geminiResult` як звичайна відповідь Gemini.

### Обмеження

- **1 активний помічник на юзера-аскера**. Якщо в `asAsker` уже є active connection, нові запити повертають 400.
- **Скрін не зберігається в БД** — летить лише через SSE. Якщо B offline у момент надсилання → A отримує `409 helper is offline`.
- **Кілька вкладок у B** — обидві отримують подію (SSE-registry зберігає масив `ServerResponse` на userId), отже модал відкриється в обох. Не критично.
- **Keepalive 25с** у SSE — щоб cloudflared / SSH-тунель не вбили idle-з'єднання. EventSource на фронті авто-перепідключається, плюс manual retry через 5с при `onerror`.
- **last_seen** оновлюється примусово (`force=true`) при відключенні SSE-стріму, якщо більше немає активних підписок цього юзера.

### Файли

- [scripts/db/friends.ts](scripts/db/friends.ts) — `requestFriendship`, `acceptFriendship`, `removeFriendship`, `getActiveHelperFor`, `listMyFriends`
- [scripts/api/friends.ts](scripts/api/friends.ts) — HTTP-ендпоінти + in-memory SSE registry (`subscribers: Map<userId, ServerResponse[]>`)
- [public/js/user-friends.js](public/js/user-friends.js) — фронт-оркестратор: SSE-handler, settings panel, chat modal, sticky-режим
- [public/js/user-screenshot.js](public/js/user-screenshot.js) — спільна функція захоплення скріна, використовується і Gemini, і friend
- [pages/partials/user/modal-friend-chat.html](pages/partials/user/modal-friend-chat.html) — модал на стороні B
- [pages/partials/user/modal-settings/friends.html](pages/partials/user/modal-settings/friends.html) — таб "Друзі" + how-to інструкція

## Серверні модулі — ключові функції

### `server/` — `server.ts` + `static.ts` + `proxy.ts`

- `serveFile(res, file)` ([static.ts](scripts/server/static.ts)) — стрімить локальний файл із `Cache-Control: no-store`, MIME визначається за розширенням.
- `safeJsPath(reqPath)` ([static.ts](scripts/server/static.ts)) — нормалізує шлях для `/js/*` і блокує path-traversal за межі `public/js/`.
- `rewriteUrls(text, targetHost)` ([proxy.ts](scripts/server/proxy.ts)) — видаляє `https://<targetHost>` та `http://<targetHost>` із тіла відповіді, щоб усі абсолютні посилання залишилися в межах нашого домену.
- `performProxy(req, res, targetRaw, pathOnly, opts)` ([proxy.ts](scripts/server/proxy.ts)) — виконує http(s)-запит до таргета, переписує `Set-Cookie` (зрізає `Domain`, `Secure`, форсить `SameSite=Lax`), знімає `X-Frame-Options` / `Content-Security-Policy` / `Strict-Transport-Security` / `Feature-Policy`, виставляє `Permissions-Policy` зі списку `iframePermissions`. Для `text/html` та `application/javascript` — буферизує тіло і викликає `rewriteUrls`. Опції (`ProxyOpts` із [types.ts](scripts/shared/types.ts)):
  - `sendCookies: false` — не пересилати cookies клієнта в таргет
  - `stripSetCookie: true` — видалити `Set-Cookie` з відповіді (preview-режим)
  - `setPreviewCookie: <userId>` — виставити cookie `uix_preview=<userId>` (HttpOnly, Lax)
- `proxyForUser(req, res, userId, reqPath, preview)` ([proxy.ts](scripts/server/proxy.ts)) — підставляє `target_url` користувача (або `defaultTarget`) і викликає `performProxy`.
- `proxyHandle(req, res)` ([proxy.ts](scripts/server/proxy.ts)) — порядок резолву "хто власник запиту":
  1. Сесія (`uix_session`) → проксі для користувача сесії
  2. `Referer` починається з `/_p/<id>/` → preview для цього `id`
  3. Cookie `uix_preview` → preview для цього `id`
  4. Інакше — `403`
- `server.ts` сам — лише `http.createServer` із плоским ланцюжком `if`-ів, що відсіюють `/_uix/api/*`, `/favicon.ico`, `/style.css`, `/js/*`, `/_p/<id>/`, `/admin`, `/<id>/` та `/`. Усе інше падає в `proxyHandle`.

### `api/` — `router.ts` (диспетчер) + решта груп маршрутів

`handleApi(req, res)` повертає `true`, якщо запит оброблений як `/_uix/api/*`, інакше `false` — і керування передається в роутер `server/server.ts`. Сам диспетчер крихітний: пробує `handleAuth` → `handleMe` → `handleFiles` → `handleQuestions` → `handleAdminUsers`; перший, що повертає `true`, виграє. Інакше — `404`.

Усе тіло читається через `readJson<T>()` ([helpers.ts](scripts/api/helpers.ts)) з лімітом 1 МБ (30 МБ для `POST /_uix/api/me/files`, 15 МБ для `/_uix/api/gemini/solve` через base64-картинку). Помилки серіалізуються у `{ error: "..." }` через `sendJson(res, status, body)`.

`requireAuth(req, res)` (загальний для `api-me`/`api-files`) повертає `User` або `null`, попередньо відписавши `401`. У [admin-users.ts](scripts/api/admin-users.ts) додатково є `requireAdmin(req, res)`, що додає перевірку `isAdmin`.

### `db/` — `index.ts` + `connection.ts` + `crypto.ts` + `cipher.ts` + `users.ts` + `files.ts` + `questions.ts`

`db/index.ts` — лише re-export із `users`, `files`, `appearance`, `questions`, тож імпорти `from '../db'` працюють як єдина точка входу.

- `hashPassword(password)` / `verifyHash(password, stored)` ([crypto.ts](scripts/db/crypto.ts)) — scrypt (`node:crypto`), сіль 16 байт, ключ 64 байти, формат `scrypt$<salt-hex>$<hash-hex>`. Перевірка через `crypto.timingSafeEqual`. **Незворотне** — лише для пароля.
- `encrypt(s)`/`decrypt(s)` та `encryptBuffer(b)`/`decryptBuffer(b)` ([cipher.ts](scripts/db/cipher.ts)) — **зворотне** шифрування AES-256-GCM для чутливих полів і BLOB. Ключ береться зі змінної `UIX_DB_KEY` (32 байти hex/base64) або з файлу `db-secret.key` (генерується автоматично, `chmod 600`, gitignored). Текстовий формат — `enc:v1:<base64(iv|tag|ciphertext)>`, бінарний — magic-заголовок `UIX\x01`. Обидва migration-safe: значення без префікса/магії повертається **як є** (старі відкриті записи читаються без помилок), а `encrypt*` ідемпотентне (вже зашифроване не чіпає).
- `firstChar(s)` ([crypto.ts](scripts/db/crypto.ts)) — береться через `[...s][0]`, тобто коректно обробляє Unicode-символи (емодзі тощо).
- `createUser` / `updateUser` / `getUserById` / `getUserByName` / `listUsers` / `deleteUser` ([users.ts](scripts/db/users.ts)) — CRUD над `users`. `password_first` записується одночасно з `password_hash`. `updateUser` приймає також `prompts`, `activePromptId`, `enabledModels`, `activeModel`. При створенні `id` береться як найменший вільний (`nextUserId()`), щоб заповнювати прогалини після видалень.
- `touchUserLastSeen(userId, now?, force?)` ([users.ts](scripts/db/users.ts)) — оновлює `last_seen` не частіше ніж раз на 30 с (in-memory кеш); `force=true` пропускає обмеження. Викликається при кожному `getCurrentUser` (через `helpers.ts`) і при відключенні SSE-стріму (якщо більше нема підписок).
- `listUserFiles(userId)` / `getUserFile` / `getUserFiles(userId)` / `addUserFile(userId, name, mime, data)` / `deleteUserFile(userId, fileId)` ([files.ts](scripts/db/files.ts)) — CRUD для прикріплених файлів (тип не обмежений: PDF, зображення, текст, аудіо, відео). `addUserFile` працює в транзакції і обирає найменший вільний `id` через `nextFileId()` — так само, як `users`, тож після видалень дірки заповнюються.
- `verifyPasswordById` / `verifyPasswordByName` ([users.ts](scripts/db/users.ts)) — повна перевірка пароля; на успіху викликає `backfillFirstChar` (якщо в БД ще немає `password_first`).
- `verifyFirstCharById` ([users.ts](scripts/db/users.ts)) — порівнює один символ із `password_first` (без хешу). Працює лише якщо колонка вже заповнена.
- Схема, `PRAGMA journal_mode = WAL` і всі `ALTER TABLE ADD COLUMN`-міграції (у т.ч. `last_seen`) зібрані в [connection.ts](scripts/db/connection.ts) — імпорт цього файлу автоматично готує БД.
- Окремий файловий міграційний runner: [migrate.ts](scripts/db/migrate.ts) (`npm run migrate`) — завантажує `.ts`/`.js` файли з `migrations/` у відсортованому порядку, трекає застосовані в таблиці `migrations_applied (id, name, applied_at)`. Кожен файл міграції має експортувати `up(db)` + опціонально `id` і `name`.
- Константи `KNOWN_MODELS`, `DEFAULT_PROMPT_TEXT` та `STRUCTURED_SUFFIX` живуть у [constants/gemini.ts](scripts/shared/constants/gemini.ts). Актуальний список моделей: `gemini-3.5-flash`, `gemini-3.1-flash-lite`, `gemini-2.5-pro`, `gemini-2.5-flash`, `gemini-2.5-flash-lite`, `gemini-3.1-pro-preview`, `gemini-3-flash-preview`.

#### Шифрування чутливих полів

Поверх scrypt-хешу пароля чутливі дані шифруються `cipher.ts` (AES-256-GCM) перед записом і розшифровуються при читанні — прозоро всередині `db/`-функцій. Зашифровані (🔒 у схемах нижче):

| Таблиця | Поля |
| --- | --- |
| `users` | `api_keys`, `target_url`, `password_first` |
| `user_files` | `data` (BLOB) |
| `user_questions` | `image` (BLOB), `question`, `correct_answer` |

> **Міграція наявних даних — лінива і часткова.** Старий відкритий запис читається без помилок, але шифрується лише коли поле **перезаписують** (зміна пароля/URL/ключів, редагування питання). Поля без шляху перезапису — наявні `user_files.data` та `user_questions.image` — лінивим шляхом **не** зашифруються ніколи. Для гарантованого захисту вже наявних даних потрібен одноразовий міграційний прохід по всіх рядках.

Схема `users` (🔒 = шифрується через `cipher.ts`):

```sql
id              INTEGER PRIMARY KEY AUTOINCREMENT
name            TEXT UNIQUE NOT NULL
password_hash   TEXT NOT NULL                -- scrypt-хеш (незворотно)
password_first  TEXT NOT NULL DEFAULT ''     -- 🔒 (швидкий вхід; зворотно)
api_keys        TEXT NOT NULL DEFAULT '[]'   -- 🔒 JSON-масив
is_admin        INTEGER NOT NULL DEFAULT 0
target_url      TEXT NOT NULL DEFAULT ''     -- 🔒
prompts         TEXT NOT NULL DEFAULT '[]'   -- JSON: [{id, name, text}, ...]
active_prompt_id TEXT NOT NULL DEFAULT ''
enabled_models  TEXT NOT NULL DEFAULT '[]'   -- JSON-масив імен моделей
active_model    TEXT NOT NULL DEFAULT ''
last_seen       INTEGER NOT NULL DEFAULT 0  -- Unix ms, оновлюється через touchUserLastSeen
```

Схема `user_files`:

```sql
id          INTEGER PRIMARY KEY AUTOINCREMENT
user_id     INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE
name        TEXT NOT NULL
mime        TEXT NOT NULL
size        INTEGER NOT NULL                 -- розмір відкритих даних
data        BLOB NOT NULL                    -- 🔒 (AES-256-GCM, magic-заголовок)
created_at  INTEGER NOT NULL
```

Схема `user_questions`:

```sql
id             INTEGER PRIMARY KEY AUTOINCREMENT
user_id        INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE
image          BLOB NOT NULL                 -- 🔒
mime           TEXT NOT NULL DEFAULT 'image/jpeg'
question       TEXT NOT NULL DEFAULT ''      -- 🔒
options        TEXT NOT NULL DEFAULT '[]'    -- JSON-масив
correct_answer TEXT NOT NULL DEFAULT ''      -- 🔒
tags           TEXT NOT NULL DEFAULT '[]'    -- JSON-масив
created_at     INTEGER NOT NULL
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

### `gemini/` — `index.ts` + `cache.ts` + `parser.ts`

Використовує офіційний `@google/genai` SDK замість «голого» `fetch`. Структура виклику:

- `solveWithGemini({ apiKeys, imageBase64, prompt, models, files })` ([gemini.ts](scripts/gemini/index.ts)) — перебирає моделі в порядку, заданому користувачем (активна модель іде першою), для кожної моделі — всі API-ключі. Перший успіх повертає результат, інакше — кидає останню помилку. Таймаут — 20 с на запит, без авто-ретраїв.
- `uploadFileForKey(client, apiKey, file)` ([cache.ts](scripts/gemini/cache.ts)) — лінива загрузка `UserFile` (BLOB із БД) у Gemini Files API через `client.files.upload({ file: Blob, config: { mimeType, displayName } })`. Повертає `{ uri, mimeType, expiresAt }`. Результат кешується в пам'яті в `Map<"<apiKey>::<fileId>", UploadedFile>` на ~40 годин (Files API сам тримає файли ~48h).
- Сам запит — `client.models.generateContent({ model, config: { thinkingConfig: { thinkingBudget: model.includes('pro') ? 3000 : 1000 } }, contents })`. У `parts` спочатку текст промту, потім PDF-парти через `createPartFromUri(uri, mime)`, наприкінці — `inlineData` зі скріншотом (JPEG base64).
- `invalidateUploadsForUser(fileIds)` ([cache.ts](scripts/gemini/cache.ts)) — викликається з [files.ts](scripts/api/files.ts) коли користувач видаляє файл, щоб скинути кеш для цього `fileId` по всіх ключах.
- `dropCacheForKey(apiKey)` ([cache.ts](scripts/gemini/cache.ts)) — скидає всі URI цього ключа; викликається з `solveWithGemini` після провалу.
- `parseResultText(text)` ([parser.ts](scripts/gemini/parser.ts)) — спочатку шукає `Відповідь:` / `Answer:`, потім перший рядок, що матчить `\d+(,\d+)*` / `\d+(;\d+)*` / `\d+-[а-яa-z]...` / `так|ні`.

Якщо запит до однієї пари (модель, ключ) падає, кеш URI для цього ключа автоматично скидається — наступна спроба перезавантажить файли.

## Сторінки клієнта

### `/<id>/` — кабінет користувача ([public/js/user.js](public/js/user.js))

Логіка:

1. Запит `GET /_uix/api/me`.
2. Якщо `me.id === id` (тобто авторизований саме як цей користувач) → `enterAuthed()`.
3. Інакше → `initLogin()` — швидкий вхід.

`enterAuthed(me, { fromLogin })`:

- Показує top-bar з ім'ям, кнопками "Налаштування", "Адмін" (для адмінів), "Вихід".
- Реєструє `barTrigger` (невидимий клік-зон 44×44 у правому верхньому куті) → клік toggle меню.
- Запит `GET /_uix/api/config` → ставить `allow="..."` на iframe згідно `iframePermissions` і виставляє `frame.src` в `proxyBase` (`/_p/`), якщо це не редирект після свіжого логіну (`fromLogin=true` — iframe уже показує таргет).
- Імпортує `initGemini()` ([user-gemini.js](public/js/user-gemini.js)), `initFilesStatus()` ([user-files-status.js](public/js/user-files-status.js)), `initSettings()` ([user-settings.js](public/js/user-settings.js)). Реєструє гарячі клавіші / колесо, навішує `frame.addEventListener('load', syncMetaFromFrame)` для синхронізації title/favicon.
- При вході підвантажує збережений вигляд із сервера (`fetchAppearance` → `GET /_uix/api/me/appearance`) і застосовує через CSS-змінні (`applyAppearance` із [user-appearance.js](public/js/user-appearance.js)).
- Налаштування зберігаються кількома PUT-запитами — лише для змінених полів: `/me/url`, `/me/api-keys`, `/me/password`, `/me/prompts`, `/me/models`, `/me/appearance`. Файли заливаються/видаляються одразу через `/me/files`.

`initLogin()`:

- Виставляє `frame.src = "/_p/<id>/"` — користувач бачить таргет ще до логіну (preview-режим).
- Показує приховану форму `<input type="password" maxLength="1">`. Подія `input` автоматично надсилає `POST /_uix/api/login/<id>/quick` з одним символом, як тільки в полі є рівно один символ.
- На помилці — клас `wrong shake` (CSS-анімація трясіння), фокус повертається на input.

### `/` — повний логін ([public/js/login.js](public/js/login.js))

Звичайна форма `name + password` → `POST /_uix/api/login` → редирект на `/<user.id>/`.

### `/admin` ([public/js/admin.js](public/js/admin.js), [public/js/admin-login.js](public/js/admin-login.js))

- Якщо не авторизований як адмін, сервер віддає `admin-login.html` із формою `POST /_uix/api/admin/login`. Після успіху — `location.reload()` → сервер віддає `admin.html`.
- В адмін-панелі: таблиця користувачів (id, name, admin, target, к-ть ключів), форма "Створити / Редагувати" та `DELETE /_uix/api/users/:id` з `confirm()`.
- Рендер таблиці і `removeUser` живуть у [admin-users.js](public/js/admin-users.js) (`setupUsers({ tbody, errEl, fieldId, setEdit }) → { refresh }`); сама форма та її `setEdit` — у `admin.js`.
- При редагуванні: пусте поле "Пароль" не змінює пароль; список API-ключів — рядок на ключ.

### Спільне — [public/js/http.js](public/js/http.js)

`api(path, opts)` — обгортка над `fetch('/api' + path)` із `Content-Type: application/json` та `credentials: same-origin`. Повертає `null` для `204`, парсить JSON, кидає `Error` із `body.error` при не-2xx.

## Гарячі клавіші

Слухач навішується через `installShortcuts()` у [public/js/user.js](public/js/user.js) на `window` і **дублюється** в `iframe.contentDocument` (через `attachToFrame` після `load`) — щоб клавіші ловилися й коли фокус усередині таргета. Спрацьовує лише на `Alt + клавіша` (без `Ctrl`/`Meta`) і **ігнорується** в текстових полях (`INPUT`, `TEXTAREA`, `contentEditable`).

| Клавіша | Дія                                                       | Реалізація                                                                                               |
| ------- | --------------------------------------------------------- | -------------------------------------------------------------------------------------------------------- |
| `Alt+G` | Зробити скрін iframe і надіслати (Gemini або друг — залежно від режиму) | `triggerScreenshot()` маршрутизує між Gemini та friend                              |
| `Alt+H` | Показати/сховати останню відповідь                        | `toggleResult()`                                                                                         |
| `Alt+M` | Показати/сховати верхнє меню (top-bar)                    | `toggleBar()`                                                                                            |
| `Alt+C` | Перемкнути активну Gemini-модель на наступну з увімкнених | `cycleModel()` — `PUT /_uix/api/me/active-model`, скорочена назва спливає в `#modelToast` (правий нижній кут) |
| `Alt+F` | Перемкнути режим друга (Gemini ↔ помічник). Альтернатива — клік на кнопку `Д` поряд з `S` | `friends.toggleMode()` — потребує активного помічника |
| `Alt+V` | Циклічно перемкнути варіант вигляду відповіді              | `cycleVariant()` — змінює `activeVariantId` у `user_appearance`, тост із назвою варіанту                |

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
  - **Основні**: URL сайту → `PUT /_uix/api/me/url`, API ключі → `PUT /_uix/api/me/api-keys`, новий пароль (порожньо — не змінювати) → `PUT /_uix/api/me/password`.
  - **Промти**: довільна кількість іменованих промтів, один обраний як активний (radio). Зберігається в `prompts` + `active_prompt_id` через `PUT /_uix/api/me/prompts`.
  - **Моделі**: чекбокси по списку `KNOWN_MODELS` (з `constants/gemini.ts`), radio для активної моделі, підказка про `Alt+C`. Зберігається через `PUT /_uix/api/me/models`. Запит на solve йде **тільки в активну модель** (без fallback на інші — fallback залишився лише між API-ключами).
  - **Файли**: довільні файли (PDF, зображення, текст, аудіо, відео…), що передаються в Gemini контекстом. Додавання — `POST /_uix/api/me/files` (base64, MIME визначається браузером), видалення — `DELETE /_uix/api/me/files/:id`.
  - **Вигляд** — три блоки:
    1. **Варіанти вигляду відповіді** (`<select>` + кнопки `+ ✎ ×`) — кілька іменованих пресетів. Активний застосовується. `Alt+V` циклічно перемикає. Перемикання/додавання/видалення/перейменування зберігаються одразу через `PUT /_uix/api/me/appearance`.
    2. **Відповідь Gemini** — шрифт, розмір, колір тексту, колір фону + слайдер прозорості. Зміни пишуться у **поточний активний варіант**. Live-preview через CSS-змінні (`--result-*`).
    3. **Кнопка S** та **Кнопка Д у режимі друга (активний стан)** — окремі набори кольору/прозорості для двох кнопок. Не входять у варіанти — це глобальні налаштування.
    4. **Індикатори** — чекбокси видимості елементів (статус файлів, тост моделі, debug iframe). Відсилаються на сервер відразу після кліку.
    
    Зберігання — в `user_appearance.data` (JSON-blob). При першому fetch старі плоскі `result*` поля автоматично загортаються у варіант "Default" (міграція в [user-appearance.js](public/js/user-appearance.js#L73) `migrate()`).
  - **Друзі**: запит помічника за іменем + список pending/active підключень. Прийняття/відхилення pending-запитів. Інструкція "як це працює" + кнопки керування. Усі взаємодії — через `/_uix/api/me/friends/*` + SSE.
- **Адмін** — посилання на `/admin` (тільки для `isAdmin=true`).
- **Вихід** — `POST /_uix/api/logout`, редирект на `/`.

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
5. `POST /_uix/api/gemini/solve` із одним лише `imageBase64`. Активний промт, активна модель і прикріплені файли беруться сервером із даних користувача в БД.
6. Відповідь показується в `.gemini-result`.

Сервер ([files.ts](scripts/api/files.ts) → [gemini.ts](scripts/gemini/index.ts)):

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

| Поле                  | Опис                                                                                                                  |
| --------------------- | --------------------------------------------------------------------------------------------------------------------- |
| `port`                | Порт сервера (за замовчуванням `3000`)                                                                                |
| `defaultTarget`       | URL за замовчуванням, якщо в користувача порожній `target_url`                                                        |
| `sessionTtlMs`        | Час життя сесії в мілісекундах (1 година)                                                                             |
| `iframePermissions`   | Список дозволів `Permissions-Policy` для iframe (camera, microphone, …)                                               |
| `forwardProxies`      | Масив URL-ів ноутів-relay (`http://localhost:8787` для SSH-R / `https://abc.trycloudflare.com` для tunnel). Порожній — без ротації, центральний сервер ходить до target напряму |
| `production`          | Зарезервовано (поки не використовується)                                                                              |

## REST API

Всі відповіді — JSON. Помилки — `{ "error": "..." }`. Cookie `uix_session` встановлюється автоматично після логіну.

### Публічні

| Метод | Шлях                       | Опис                                                                                        |
| ----- | -------------------------- | ------------------------------------------------------------------------------------------- |
| POST  | `/_uix/api/login`               | `{name, password}`                                                                          |
| POST  | `/_uix/api/login/:id`           | `{password}` — логін за id                                                                  |
| POST  | `/_uix/api/login/:id/quick`     | `{char}` — швидкий вхід за першим символом                                                  |
| POST  | `/_uix/api/admin/login`         | Як `/_uix/api/login`, але відмовляє не-адмінам                                                   |
| POST  | `/_uix/api/logout`              | —                                                                                           |
| GET   | `/_uix/api/me`                  | Поточний користувач (включно з `prompts`, `activePromptId`, `enabledModels`, `activeModel`) |
| GET   | `/_uix/api/config`              | `{ proxyPath, iframePermissions, knownModels, defaultPrompt }`                              |
| GET   | `/_uix/api/users/by-name/:name` | `{ id, name, targetUrl }`                                                                   |

### Користувач (потребує сесії)

| Метод  | Шлях                   | Тіло / результат                                                                     |
| ------ | ---------------------- | ------------------------------------------------------------------------------------ |
| PUT    | `/_uix/api/me/url`          | `{ url: string }`                                                                    |
| PUT    | `/_uix/api/me/password`     | `{ password: string }`                                                               |
| PUT    | `/_uix/api/me/api-keys`     | `{ apiKeys: string[] }`                                                              |
| PUT    | `/_uix/api/me/prompts`      | `{ prompts: {id,name,text}[], activePromptId?: string }`                             |
| PUT    | `/_uix/api/me/models`       | `{ enabledModels: string[], activeModel?: string }` (фільтрується за `KNOWN_MODELS`) |
| PUT    | `/_uix/api/me/active-model` | `{ activeModel: string }` — має бути в `enabledModels`                               |
| GET    | `/_uix/api/me/appearance`   | JSON-обʼєкт із налаштуваннями вигляду (`{}` якщо ще не збережено)                    |
| PUT    | `/_uix/api/me/appearance`   | Повний JSON-обʼєкт налаштувань → пише в `user_appearance.data`                       |
| GET    | `/_uix/api/me/files`        | `[{id, name, mime, size, createdAt}]`                                                |
| POST   | `/_uix/api/me/files`        | `{ name, mime, dataBase64 }` → метадані файлу (ліміт 30 МБ)                          |
| DELETE | `/_uix/api/me/files/:id`    | `204`, скидає кеш URI у `gemini/cache.ts`                                                  |
| POST   | `/_uix/api/gemini/solve`    | `{ imageBase64: string }` → `{ answer }`. Промт/файли беруться з БД, модель = тільки активна |

### Friend-help (потребує сесії)

| Метод  | Шлях                              | Тіло / результат                                                                            |
| ------ | --------------------------------- | ------------------------------------------------------------------------------------------- |
| GET    | `/_uix/api/me/friends`                 | `{ asAsker, asHelper, pendingIncoming, pendingOutgoing }` — списки за роллю поточного юзера |
| POST   | `/_uix/api/me/friends/request`         | `{ toName }` → створити pending-запит. Я стаю аскером, target — помічником                 |
| POST   | `/_uix/api/me/friends/accept`          | `{ id }` → перевести pending в active (тільки якщо я — помічник цього запиту)              |
| DELETE | `/_uix/api/me/friends/:id`             | `204` — будь-яка сторона може видалити                                                     |
| POST   | `/_uix/api/me/friends/screenshot`      | `{ imageBase64 }` → надіслати скрін активному помічнику через SSE                          |
| POST   | `/_uix/api/me/friends/reply`           | `{ askerId, text, messageId? }` → відповідь аскеру; SSE-подія містить `helperModel` (активна модель помічника) |
| GET    | `/_uix/api/me/friends/stream`          | **SSE**. Події: `request`, `accepted`, `disconnected`, `screenshot`, `reply`. Keepalive 25с |
| GET    | `/_uix/api/me/friends/check/:name`     | Перевірити, чи існує юзер з таким іменем (для UI-валідації перед запитом)                   |
| GET    | `/_uix/api/me/friends/users?q=`        | Пошук юзерів по імені (до 60, відсортовано, з `isOnline`)                                   |
| GET    | `/_uix/api/users-public/:id`           | `{ id, name }` — публічна інфа про юзера                                                    |

### Діагностика IP / relay

| Метод | Шлях                    | Опис                                                                                              |
| ----- | ----------------------- | ------------------------------------------------------------------------------------------------- |
| GET   | `/_uix/api/_diag/server-ip`  | IP, з якого виходить центральний сервер напряму (повз relay). Кеш 1 година                       |
| GET   | `/_uix/api/_diag/relay-ip`   | IP, з якого виходить `forwardProxies[0]` (тобто IP ноута). Має відрізнятись від `/server-ip`     |

### Адміністратор (`isAdmin=true`)

| Метод  | Шлях                           | Опис                                                                     |
| ------ | ------------------------------ | ------------------------------------------------------------------------ |
| GET    | `/_uix/api/users`              | Список усіх, з `isOnline` та `trollMode`                                 |
| POST   | `/_uix/api/users`              | `{name, password, apiKeys?, isAdmin?, targetUrl?}`                       |
| GET    | `/_uix/api/users/:id`          | Один користувач                                                          |
| PUT    | `/_uix/api/users/:id`          | Часткове оновлення                                                       |
| DELETE | `/_uix/api/users/:id`          | —                                                                        |
| PUT    | `/_uix/api/users/:id/troll-mode` | `{ value: bool }` → встановлює `trollMode` в `user_appearance` юзера  |

## Безпека

- **Паролі**: scrypt (`node:crypto`), сіль 16 байт, ключ 64 байти, перевірка через `timingSafeEqual`. Незворотно.
- **Шифрування чутливих полів**: AES-256-GCM ([cipher.ts](scripts/db/cipher.ts)) для `api_keys`, `target_url`, `password_first`, BLOB-файлів і питань (див. розділ БД). Ключ — `UIX_DB_KEY` або `db-secret.key`; **втрата ключа = втрата цих даних**, тримайте резервну копію окремо від БД. Ручне розшифрування — `npm run decrypt` (нижче).
- **Швидкий логін** за першим символом працює лише якщо в БД збережено `password_first` (зберігається зашифровано, заповнюється при створенні/оновленні пароля або при першому повноцінному вході через `backfillFirstChar`). Для безпеки — це **не** еквівалент звичайного логіна (1 символ → 26+ варіантів), тож вмикайте лише там, де доречно.
- **Сесії** — in-memory `Map`; рестарт процесу скидає всі сесії. Cookie: `HttpOnly; SameSite=Lax; Path=/`.
- **Проксі** знімає `X-Frame-Options`, `Content-Security-Policy[-Report-Only]`, `Strict-Transport-Security`, `Feature-Policy` із відповіді таргета та підставляє свій `Permissions-Policy`.
- **Cookies таргета** з `Domain=...`, `Secure`, `SameSite=*` нормалізуються (примусово `SameSite=Lax`, без `Domain`/`Secure`). Cookie з ім'ям нашої сесії (`uix_session`) ніколи не пересилається в таргет.
- **Path-traversal** для статики блокується перевіркою `target.startsWith(root)` у `safeJsPath` ([static.ts](scripts/server/static.ts)).
- **Relay-доступність**: `laptop-proxy.ts` слухає на `0.0.0.0` без автентифікації. При використанні SSH reverse tunnel порт відкривається тільки на `localhost` сервера — зовні недоступний. При cloudflared/ngrok — захищено їх власним шаром. Не виставляй порт relay напряму в інтернет без додаткового захисту.
- **SSE-канал** (`/_uix/api/me/friends/stream`) — потребує валідної сесії. Registry — in-memory `Map<userId, ServerResponse[]>`, тобто пам'ять не персистує між рестартами. Скріни друзів через SSE **не зберігаються** в БД, тільки в RAM під час передачі.

## Запуск

### Центральний сервер

```bash
# Встановити залежності (один раз)
npm install

# Створити першого адміна (аргументи або інтерактивно)
npm run create-admin -- admin "ваш_пароль" "https://example.com"
npm run create-admin

# Запуск (білдить фронт + сервер на :3000, слухає 0.0.0.0)
npm start

# Прод — компіляція + чистий node (мінімум RAM)
npm run build

# Застосувати файлові міграції з папки migrations/
npm run migrate

# Ручне розшифрування полів БД (тим самим ключем, що й сервер)
npm run decrypt -- "enc:v1:..."          # текстовий токен → відкритий текст
npm run decrypt -- --b64 "<base64>"       # зашифрований BLOB
npm run decrypt -- --user 1               # усі поля користувача розшифровано
npm run decrypt -- --questions 1          # питання користувача розшифровано

# Одноразово зашифрувати старі plaintext-дані в БД
npm run encrypt-legacy
```

При старті центральний сервер виводить всі мережеві IP (0.0.0.0-bind), щоб було очевидно за яким адресом до нього звертатись зсередини LAN.

### Ноут-relay (для IP-ротації)

На кожному ноуті, через який треба маршрутизувати target-трафік:

```bash
# Встановити (один раз, той самий репозиторій що й сервер)
git clone <repo>; npm install

# Запустити relay + SSH тунель (твій ноут, порт 8787)
npm run start:relay

# Другий ноут — порт 8788
RELAY_PORT=8788 npm run start:relay
```

Або через cloudflared / ngrok — деталі див. вище у розділі ["Мультиноут / IP-ротація"](#мультиноут--ip-ротація-через-forward-relay).

> Прод: задайте `UIX_DB_KEY` (32 байти hex/base64) у середовищі. Без змінної ключ візьметься з `db-secret.key` у корені проєкту (створюється автоматично при першому запуску, gitignored) — зробіть його резервну копію.

## Залежності

- **Рантайм**: [`better-sqlite3`](https://github.com/WiseLibs/better-sqlite3), [`@google/genai`](https://www.npmjs.com/package/@google/genai) — офіційний SDK Gemini API (Files API + `generateContent`)
- **Dev/build**: `tsx`, `typescript`, `@types/node`, `@types/better-sqlite3`, `sass` (компіляція [styles/style.scss](styles/style.scss) → `public/style.css`), `posthtml` + `posthtml-include` + `posthtml-expressions` (збірка `pages/*.html` → `public/*.html`)
- **CDN на клієнті** (без npm): [html2canvas 1.4.1](https://cdnjs.com/libraries/html2canvas) — для скріншота iframe
