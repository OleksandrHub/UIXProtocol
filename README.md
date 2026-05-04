# UIXProtocol

Лёгкий проксі з мульти-користувацькою auth. Один Node-процес, один порт.

## Архітектура

- `server.ts` — HTTP-сервер на одному порту (за замовчуванням 3000):
  - `/` — повна форма входу (ім'я + пароль), редирект на `/<id>/`
  - `/<id>/` — кабінет користувача (іфрейм + меню) або форма пароля
  - `/admin` — панель адміна (форма ім'я+пароль для будь-якого адміна)
  - `/api/*` — REST API
  - `/static/*` — статика (CSS/JS)
  - `/_p/*` — точка входу проксі для іфрейма
  - решта — fallback-проксі (для абсолютних шляхів усередині проксійованого HTML)
- `db.ts` — SQLite (`better-sqlite3`) + scrypt (`node:crypto`)
- `session.ts` — in-memory сесії, HttpOnly cookie
- `api.ts` — REST роутинг
- `public/` — HTML/CSS/JS клієнт (без фреймворків)

Кожен користувач має поле `target_url` — сайт, який транслює проксі. Юзер може його змінити з меню.

## Запуск

```bash
# Встановити залежності (ОДИН раз)
npm install

# Створити першого адміна
npm run create-admin -- admin "ваш_пароль" "https://example.com"
# або інтерактивно:
npm run create-admin

# Розробка (з гарячою TS)
npm run dev

# Прод (компіляція + чистий node — мінімум RAM)
npm run build
npm start
```

Відкрити: `http://localhost:3000/admin` (увійти як admin), створити користувачів. Потім кожен заходить на `http://localhost:3000/<його_id>/` або через `http://localhost:3000/`.

## Налаштування

`environments/environment.ts`:
- `port` — порт сервера
- `defaultTarget` — URL за замовчуванням, якщо в юзера порожній `target_url`
- `sessionTtlMs` — час життя сесії (мс)
- `iframePermissions` — дозволи для іфрейма (camera, microphone, тощо)

## Залежності

- `better-sqlite3` — рантайм
- `tsx`, `typescript`, `@types/*` — тільки для dev/build

bcrypt і Angular повністю прибрані.
