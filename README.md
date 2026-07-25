# TAKKAR — Telegram Mini App

> С телефона начни с файла `START_HERE_PHONE.txt`. Локальный HTML из приложения «Файлы» не является Telegram Mini App — проект должен быть опубликован по HTTPS.

Готовый мобильный vertical slice игры **TAKKAR: The Impact Game**, оптимизированный под Telegram Mini Apps, iPhone, Android и desktop Telegram.

## Что уже реализовано

- mobile-first интерфейс без прокрутки и с поддержкой safe area;
- Telegram WebApp SDK: `ready`, `expand`, fullscreen, closing confirmation, vertical swipe control, haptics, user identity;
- тяжёлый механический HOLD TO LAUNCH;
- физически читаемый разгон колеса, инерция, деформация и отскок;
- event-based crash loop: каждый удар — отдельный психологический checkpoint;
- пять видов промышленных препятствий;
- семь стадий повреждения колеса;
- отдельные survival pause, cash out, destruction и Overdrive;
- процедурная графика Canvas 2D без тяжёлых игровых библиотек;
- адаптивное качество графики и ограничение DPR для слабых телефонов;
- синтезированный Web Audio: двигатель, механизм, удар, выживание, cash out, разрушение;
- локальная demo-математика для автономного показа;
- встроенный Node.js authoritative demo server;
- проверка Telegram `initData` на сервере;
- server-side balance, round state, impacts, cash out и seed commitment/reveal;
- Docker/Render/Fly.io конфигурация;
- скрипт автоматической настройки меню Telegram-бота.

## Самый быстрый запуск на компьютере

Требуется Node.js 20+.

```bash
cp server/.env.example .env
npm start
```

Открыть:

```text
http://localhost:3000
```

В development без Telegram сервер автоматически создаёт demo-пользователя. В production это отключено.

## Публикация для Telegram Mini App

Для полноценной работы нужен **HTTPS URL**. HTML-файл из приложения «Файлы» на iPhone не является Mini App и не должен использоваться как способ запуска.

### Вариант 1 — Render

1. Создать новый Web Service из этого репозитория.
2. Render автоматически увидит `render.yaml` или `Dockerfile`.
3. Добавить переменные:

```text
TELEGRAM_BOT_TOKEN=<token from BotFather>
SESSION_SECRET=<long random secret>
ALLOWED_ORIGIN=https://your-service.onrender.com
DEMO_AUTH=false
NODE_ENV=production
```

4. Проверить:

```text
https://your-service.onrender.com/health
```

5. Выполнить настройку бота:

```bash
TELEGRAM_BOT_TOKEN="..." \
MINI_APP_URL="https://your-service.onrender.com" \
npm run bot:setup
```

### Вариант 2 — Fly.io

Изменить имя приложения в `fly.toml`, затем:

```bash
fly launch
fly secrets set TELEGRAM_BOT_TOKEN="..."
fly secrets set SESSION_SECRET="..."
fly secrets set ALLOWED_ORIGIN="https://your-app.fly.dev"
fly deploy
```

## Настройка через BotFather

После публикации HTTPS URL:

1. `@BotFather` → `/mybots` → выбрать бота.
2. **Bot Settings → Configure Mini App → Enable Mini App**.
3. Указать URL приложения.
4. Загрузить иконку из `public/assets/icon-512.png`.
5. Загрузить preview из `public/assets/telegram-preview.jpg`.
6. **Bot Settings → Menu Button** → текст `PLAY TAKKAR` и тот же URL.

Прямой запуск после настройки:

```text
https://t.me/<bot_username>?startapp
```

## Структура

```text
public/               игровой клиент
  index.html          интерфейс Mini App
  styles.css          mobile/desktop адаптация
  game.js             canvas renderer, игровой цикл, Telegram SDK, audio
  assets/             логотипы и Telegram preview
server/server.mjs     authoritative demo server + static hosting
bot/setup-menu.mjs    настройка menu button и описаний бота
docs/                 production, security, math, animation notes
```

## Важная граница

Этот пакет — **готовая игровая demo Mini App**, которую можно публиковать и показывать пользователям. Она использует демонстрационные кредиты.

Для настоящих денег нельзя просто заменить слово DEMO на REAL. Нужны:

- лицензия в выбранной юрисдикции;
- сертифицированная математика и RNG;
- постоянный PostgreSQL ledger и Redis state machine;
- KYC/AML, геоблоки, возрастные ограничения;
- deposit/withdrawal provider;
- responsible gaming limits и self-exclusion;
- внешний security audit и game certification;
- атомарное разрешение гонки `impact vs cash out` в одной транзакции.

Подробности находятся в `docs/REAL_MONEY_PRODUCTION.md`.
