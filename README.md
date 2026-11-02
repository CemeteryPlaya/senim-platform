# Сенім

Платформа сделок на мебель на заказ (Астана, интерфейс на русском). Заказчик описывает заявку, исполнители — частные мастера, ИП и ТОО — присылают отклики, стороны подписывают договор ЭЦП и ведут работу по этапам: этап сдаётся с фото, принимается заказчиком и закрывается актом. Споры разбирает оператор.

**Оплата сейчас — напрямую исполнителю по этапам** (режим `manual`): платформа фиксирует отметки сторон «Я оплатил» / «Получил оплату» и не принимает и не хранит деньги клиентов. Эскроу-счёт банка на сделку — цель переговоров с банком; в коде есть точка подключения (`PaymentRail`) и встроенный симулятор банка для показа полного цикла. Подробно — [docs/bank/01-overview.md](docs/bank/01-overview.md).

Состояние: MVP для показа банку на тестовых данных. Внешние сервисы (SMS, ЭЦП, банк, ИИ) работают на моках за интерфейсами; реальные подключаются переменными окружения после выбора провайдеров ([docs/OWNER_TODO.md](docs/OWNER_TODO.md)).

## Стек

Next.js 16 (App Router, Server Actions) · React 19 · TypeScript · Tailwind CSS 4 · Prisma 7 + PostgreSQL 17 · zod 4 · Vitest · Playwright. Модульный монолит: [docs/bank/02-architecture.md](docs/bank/02-architecture.md), [ADR-001](docs/adr/001-modular-monolith.md).

## Локальный запуск

Нужны Node.js 22+ и Docker.

```bash
npm install                 # зависимости и prisma generate
cp .env.example .env        # затем заполнить по комментариям в файле (для разработки хватает значений по умолчанию)
npm run db:up               # Postgres 17 в Docker на порту 5442: базы senim, senim_test, senim_e2e
npm run db:reset            # миграции с нуля + демо-данные
npm run dev                 # http://localhost:3100
```

`npm run db:reset` выполняет `prisma migrate reset --force`. Prisma не даёт ИИ-агентам запускать его без явного подтверждения пользователя; агенту (и вообще для уже созданной базы) подходит другой путь:

```bash
npx prisma migrate deploy
DEMO_MODE=true npx prisma db seed     # непустую базу сид пересоздаёт только при DEMO_MODE=true
```

После запуска:

- `/demo` — вход под демо-персоной одним нажатием (только при `DEMO_MODE=true`);
- `/login` — обычный вход по номеру и SMS-коду; в демо с `SMS_PROVIDER=mock` код показывается на экране;
- `/bank-demo` — сценарий показа банку;
- `/operator/demo` — «Сбросить демо» и режим оплаты для новых сделок.

Порт 3100 выбран потому, что 3000 на машине разработки занят. Демо-персоны и данные сида — [docs/agents/DEMO_DATA.md](docs/agents/DEMO_DATA.md).

## Проверки

```bash
npm run check        # typecheck + lint + все тесты Vitest
npm run test:unit    # только модульные
npm run test:int     # только интеграционные (на реальной БД)
npm run test:e2e     # Playwright: мобильный и десктопный профиль
npm run quality:crap   # CRAP функций: покрытие полным прогоном + сложность (нужна TEST_DATABASE_URL)
npm run quality:dup    # дубли кода jscpd: клоны и похожие функции со сходством ≥ 0,8
npm run quality:mutate # мутационное тестирование Stryker чистой логики
```

- Инструменты качества (эквиваленты crapper, dryer и mutator из `SKILL.md`), пороги и базовая линия — [docs/quality/README.md](docs/quality/README.md). Отчёты — в `reports/quality/` (не в git).
- Интеграционным тестам нужна `TEST_DATABASE_URL` (база с «test» в имени), сквозным — `E2E_DATABASE_URL` (база с «e2e» в имени). Примеры — в `.env.example`.
- Playwright сам поднимает сервер на порту 3110 с `DEMO_MODE=true` и моками, накатывает миграции и сид на базу e2e.
- Переходы статусных машин проверяются тестами на каждый разрешённый и запрещённый переход на реальной тестовой БД. Итоги прогонов по фазам — [docs/PROGRESS.md](docs/PROGRESS.md).
- CI (GitHub Actions, `.github/workflows/check.yml`): `npm ci`, `typecheck`, `lint`, `test`.

## Фоновые задачи

Очередь — таблица `Job`; обработчики идемпотентны (автоприёмка этапа, отправка денежных операций в банк, открытие счёта сделки, досылка зависших операций, SMS, напоминания о замере, уборка брошенных файлов, иллюстрации ИИ).

```bash
npm run jobs                 # один проход очереди
npm run jobs -- --watch      # проход каждые 10 секунд
```

На Vercel очередь разбирает `GET /api/cron/run` по расписанию из `vercel.json` (раз в сутки — ограничение плана Hobby) с заголовком `Authorization: Bearer <CRON_SECRET>`. Для рабочего режима нужен запуск не реже раза в 15 минут.

## Переменные окружения

Полный список с комментариями — `.env.example`; проверка — zod-схема в `src/platform/env.ts` (при ошибке приложение не стартует и перечисляет все проблемы).

| Группа | Переменные | Примечание |
|---|---|---|
| База | `DATABASE_URL`, `TEST_DATABASE_URL`, `E2E_DATABASE_URL` | Тестовые базы — отдельные |
| Приложение | `APP_URL`, `DEMO_MODE`, `DEMO_ACCESS_PASSWORD`, `LOG_LEVEL`, `TRUST_PROXY` | `DEMO_MODE=true` включает демо-персоны, сброс демо, `/bank-demo`, переключатель режима оплаты. В рабочем окружении — `false` |
| Персональные данные | `PII_ENCRYPTION_KEY`, `PII_HASH_KEY` | 32 байта в base64 каждый, разные. Шифрование ИИН/БИН (AES-256-GCM) и HMAC для поиска |
| Вход по SMS | `SMS_PROVIDER`, `SMS_HTTP_URL`, `SMS_HTTP_TOKEN`, `SMS_SENDER`, `OTP_DAILY_GLOBAL_LIMIT`, `OTP_DAILY_PREFIX_LIMIT` | Суточные потолки кодов на новые номера |
| Подпись ЭЦП | `SIGNATURE_PROVIDER`, `SIGEX_BASE_URL` | |
| Файлы | `STORAGE_PROVIDER`, `STORAGE_LOCAL_DIR`, `FILE_URL_SECRET`, `S3_*`, `BLOB_READ_WRITE_TOKEN` | Ссылки на файлы подписываются `FILE_URL_SECRET` |
| ИИ | `AI_ENABLED`, `AI_PROVIDER`, `AI_GATEWAY_API_KEY`, `AI_TEXT_MODEL`, `AI_IMAGE_MODEL`, `AI_MAX_VISUALIZATIONS_PER_REQUEST`, `AI_DAILY_BUDGET_USD` | По умолчанию выключен |
| Оплата | `PAYMENT_RAIL`, `ESCROW_SIMULATOR_WEBHOOK_SECRET`, `BANK_API_URL`, `BANK_WEBHOOK_SECRET` | См. «Режимы провайдеров» |
| Сделки | `AUTO_ACCEPT_DAYS` | Автоприёмка сданного этапа, по умолчанию 5 дней |
| Фоновые задачи | `CRON_SECRET` | Секрет `/api/cron/run` |

В `NODE_ENV=production` обязательны `PII_ENCRYPTION_KEY`, `PII_HASH_KEY`, `FILE_URL_SECRET`, `CRON_SECRET` и `TRUST_PROXY=true`; при `DEMO_MODE=true` — ещё `DEMO_ACCESS_PASSWORD` (весь сайт под паролем, кроме вебхуков и cron) и `ESCROW_SIMULATOR_WEBHOOK_SECRET`; без демо-режима моки SMS и подписи запрещены. Локально ключи можно не задавать: используются ключи разработки.

## Режимы провайдеров

Каждый внешний сервис — интерфейс с моком и реальной реализацией; выбор — переменной окружения. API сервисов без документации не выдумываются: там интерфейс и TODO.

| Сервис | Переменная | Мок / по умолчанию | Реальная реализация |
|---|---|---|---|
| Оплата (`PaymentRail`) | `PAYMENT_RAIL` | `manual` — прямая оплата исполнителю; `escrow-simulator` — встроенный симулятор банка для показа | `bank` — только интерфейс: методы отвечают «не подключён», вебхук `/api/webhooks/bank` — 503. Требования к банку — [03-escrow-integration.md](docs/bank/03-escrow-integration.md) |
| SMS | `SMS_PROVIDER` | `mock` — код не отправляется, в демо показывается на экране | `http` — каркас под SMS-шлюз РК; формат уточняется по документации провайдера |
| Подпись ЭЦП | `SIGNATURE_PROVIDER` | `mock` — подпись имитируется, интерфейс предупреждает | `sigex` — порт и проверка готовы, HTTP-клиент SIGEX — после получения документации и доступа |
| Хранилище файлов | `STORAGE_PROVIDER` | `local` — папка `./storage` | `s3` (любое S3-совместимое, в том числе облако РК), `vercel-blob` (демо на Vercel, приватное) |
| ИИ-помощник | `AI_ENABLED`, `AI_PROVIDER` | выключен; `mock` — детерминированные ответы | `gateway` — по ключу и моделям владельца |

В демо-режиме оператор может переключить режим оплаты для **новых** сделок на `/operator/demo` (`manual` ↔ `escrow-simulator`); режим фиксируется в сделке при её создании.

## Сценарий показа банку

Показ на 10 минут по странице `/bank-demo`: заявка и анонимные отклики, договор с хэшем SHA-256 и ЭЦП, этапы с фото и автоприёмкой, эскроу в симуляторе (пополнение по реквизитам, подписанный вебхук, повторная доставка без двойного эффекта, транш по этапу), журнал аудита только на добавление, сверка с выпиской. Подготовка, реплики и запасной план — [docs/bank/05-demo-script.md](docs/bank/05-demo-script.md).

Перед показом: оператор (Динара Абенова, +7 700 000 00 01) → `/operator/demo` → «Сбросить демо».

## Установка на телефон

Сайт устанавливается как приложение (PWA): значок на главном экране, открывается без адресной строки, без магазина приложений.

- **Android (Chrome, Edge, Samsung Internet):** на главной странице — плашка «Сенім на экране телефона» с кнопкой «Установить приложение»; у вошедших та же кнопка в меню «Ещё». Кнопка появляется, когда браузер разрешил установку (событие `beforeinstallprompt`), и пропадает в установленном приложении. Плашку можно скрыть — выбор помнится в браузере. Всегда работает и пункт меню браузера «Установить приложение» / «Добавить на главный экран».
- **iPhone и iPad (Safari, Chrome с iOS 16.4):** кнопки установки Apple не даёт — вместо неё подсказка: «Поделиться» → «На экран „Домой“».
- Нужен HTTPS (на `localhost` работает и по http). Без сети установленное приложение показывает страницу «Нет связи» с кнопкой повтора; данные сделок и ответы сервера на телефоне не кэшируются.
- На демо-стенде с паролем манифест, значки, `sw.js` и `/offline` отдаются без пароля — браузер запрашивает их без учётных данных (`src/platform/demo-gate.ts`).

Где что лежит: манифест — `src/app/manifest.ts`; значки — `public/icons/` и `src/app/apple-icon.png`, перерисовать: `node scripts/generate-icons.mjs` (цвет из `src/ui/tokens.css`); сервис-воркер — `public/sw.js`; кнопка и подсказка — `src/app/_components/install/`; тексты — `src/i18n/ru/pwa.ts`. Проверка: Chrome DevTools → Application → Manifest (раздел Installability без ошибок).

## Развёртывание

Деплой, домены, ключи и аккаунты сервисов делает владелец проекта ([docs/OWNER_TODO.md](docs/OWNER_TODO.md)). На Vercel скрипт `vercel-build` выполняет `prisma generate`, `prisma migrate deploy` и `next build`. Демо на Vercel — только с тестовыми данными; реальные клиенты — после переезда в облако в РК (план — [docs/bank/04-security-and-data.md](docs/bank/04-security-and-data.md), разделы 10–11).

## Документы

| Документ | О чём |
|---|---|
| [docs/bank/01-overview.md](docs/bank/01-overview.md) | Продукт, роли, путь заявки и сделки, режимы оплаты |
| [docs/bank/02-architecture.md](docs/bank/02-architecture.md) | Модули, потоки данных, статусные машины, фоновые задачи |
| [docs/bank/03-escrow-integration.md](docs/bank/03-escrow-integration.md) | Что нужно от банка: операции, идемпотентность, подписи, статусы, сбои, сверка |
| [docs/bank/04-security-and-data.md](docs/bank/04-security-and-data.md) | Вход, роли, шифрование ИИН, журнал аудита, хранение данных в РК, резервные копии |
| [docs/bank/05-demo-script.md](docs/bank/05-demo-script.md) | Показ на 10 минут |
| [docs/bank/openapi.yaml](docs/bank/openapi.yaml) | Вебхук-эндпоинты для банка (OpenAPI 3.1) |
| [docs/adr/](docs/adr/) | Архитектурные решения: модульный монолит, путь сделки и PaymentRail, путь заявки и анонимность |
| [docs/GLOSSARY.md](docs/GLOSSARY.md) | Термины |
| [docs/PROGRESS.md](docs/PROGRESS.md), [docs/OPEN_QUESTIONS.md](docs/OPEN_QUESTIONS.md), [docs/OWNER_TODO.md](docs/OWNER_TODO.md) | Прогресс, открытые вопросы, шаги владельца |
| [CLAUDE.md](CLAUDE.md), [SKILL.md](SKILL.md) | Правила работы с кодом |
