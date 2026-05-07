# UIXProtocol

Легкий проксі з мультикористувацькою автентифікацією та опційним AI-помічником на базі Gemini. Один Node-процес, один порт, без фреймворків.

> Англійська версія: [README.en.md](README.en.md)

## Простий старт

Чотири команди — і застосунок працює:

```bash
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
- Інтеграція з Google Gemini для аналізу знімка екрана й розв'язання тестів
- Ізольований "preview"-режим для неавтентифікованих відвідувачів за прямим посиланням `/_p/<id>/...`

## Архітектура

| Файл | Призначення |
| --- | --- |
| [server.ts](server.ts) | HTTP-сервер на одному порту: статика, маршрути користувача/адміна, проксі |
| [api.ts](api.ts) | REST API (`/api/*`) — логін, користувачі, налаштування, Gemini |
| [db.ts](db.ts) | SQLite (`better-sqlite3`) + scrypt-хешування паролів |
| [session.ts](session.ts) | In-memory сесії, HttpOnly-cookie `uix_session` |
| [gemini.ts](gemini.ts) | Виклик Gemini API + парсинг короткої відповіді на тест |
| [environments/environment.ts](environments/environment.ts) | Конфіг: порт, дефолтний таргет, TTL сесії, iframe-дозволи |
| [create-admin.ts](create-admin.ts) | CLI для створення першого адміна |
| [public/](public/) | HTML/CSS/JS клієнт без фреймворків |

### Маршрути сервера

- `/` — форма входу (ім'я + пароль), редирект автентифікованих на `/<id>/`
- `/<id>/` — кабінет користувача (iframe + меню) або форма пароля для конкретного користувача
- `/admin` — панель адміністратора (форма входу або UI керування користувачами)
- `/_p/<id>/...` — preview-проксі для неавтентифікованих відвідувачів (без cookies таргета, виставляється `uix_preview` cookie)
- `/static/*` — статика (CSS/JS/іконки)
- `/api/*` — REST (див. нижче)
- решта — fallback-проксі (для абсолютних шляхів усередині проксійованого HTML)

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

Відкрити: `http://localhost:3000/admin` (увійти як admin), створити користувачів. Далі кожен заходить на `http://localhost:3000/<його_id>/` або через `http://localhost:3000/`.

## Налаштування

`environments/environment.ts`:

| Поле | Опис |
| --- | --- |
| `port` | Порт сервера (за замовчуванням `3000`) |
| `defaultTarget` | URL за замовчуванням, якщо в користувача порожній `target_url` |
| `sessionTtlMs` | Час життя сесії в мілісекундах |
| `iframePermissions` | Список дозволів `Permissions-Policy` для iframe (camera, microphone, ...) |

## REST API

Всі відповіді — JSON. Помилки повертаються у форматі `{ "error": "..." }`. Cookie `uix_session` встановлюється автоматично після успішного логіна.

### Публічні

| Метод | Шлях | Опис |
| --- | --- | --- |
| POST | `/api/login` | Логін за `{name, password}` |
| POST | `/api/login/:id` | Логін за `id` + повним паролем |
| POST | `/api/login/:id/quick` | Швидкий логін за `{char}` — першим символом пароля |
| POST | `/api/admin/login` | Логін, але тільки для користувачів з `isAdmin=true` |
| POST | `/api/logout` | Вихід (видаляє сесію та cookie) |
| GET  | `/api/me` | Поточний користувач (потребує сесії) |
| GET  | `/api/config` | Шлях проксі та `iframePermissions` |
| GET  | `/api/users/by-name/:name` | Публічний lookup `{id, name, targetUrl}` за ім'ям |

### Користувач (потребує сесії)

| Метод | Шлях | Тіло |
| --- | --- | --- |
| PUT | `/api/me/url` | `{ url: string }` — оновити власний `target_url` |
| PUT | `/api/me/password` | `{ password: string }` — змінити власний пароль |
| PUT | `/api/me/api-keys` | `{ apiKeys: string[] }` — записати ключі Gemini |
| POST | `/api/gemini/solve` | `{ imageBase64: string }` — повертає `{ answer }` |

### Адміністратор (`isAdmin=true`)

| Метод | Шлях | Опис |
| --- | --- | --- |
| GET | `/api/users` | Список усіх користувачів |
| POST | `/api/users` | Створити користувача `{name, password, apiKeys?, isAdmin?, targetUrl?}` |
| GET | `/api/users/:id` | Отримати одного користувача |
| PUT | `/api/users/:id` | Оновити поля користувача (включно з паролем) |
| DELETE | `/api/users/:id` | Видалити користувача |

## Безпека

- Паролі: scrypt (`node:crypto`), сіль 16 байт, ключ 64 байти, перевірка через `timingSafeEqual`
- Швидкий логін за першим символом працює лише якщо в БД збережено `password_first` (заповнюється при створенні/оновленні пароля або при першому повноцінному вході)
- Сесії — in-memory (`Map`); після рестарту процесу всі сесії скидаються
- Cookie сесії: `HttpOnly; SameSite=Lax; Path=/`
- Проксі знімає `X-Frame-Options`, `Content-Security-Policy`, `Strict-Transport-Security`, `Feature-Policy` із відповіді таргета та підставляє свій `Permissions-Policy`
- Cookie таргета з `Domain=...`, `Secure`, `SameSite=*` нормалізуються (примусово `SameSite=Lax`)

## Інтеграція з Gemini

`gemini.ts` шле PNG/JPEG (base64) у `gemini-2.5-flash` з промптом, що очікує коротку відповідь у форматі `Відповідь: ...` (одиничний вибір, кілька варіантів, пари, відкрита відповідь, так/ні). Список API-ключів зберігається на користувача — у разі помилки/ліміту викликається наступний ключ. Таймаут одного запиту — 20 с.

## Залежності

- Рантайм: [`better-sqlite3`](https://github.com/WiseLibs/better-sqlite3)
- Dev/build: `tsx`, `typescript`, `@types/node`, `@types/better-sqlite3`

bcrypt і Angular повністю прибрані з проєкту.
