# Technical Handover — текущая кодовая база escrowkz

Для: Санжар (CTO). Назначение: быстро понять, что уже написано, как устроены данные и что можно переиспользовать при проектировании своей архитектуры. Репозиторий: `github.com/madiyarknbk-ui/escrowkz` (приватный, инвайт по GitHub-нику).

## 1. Стек и деплой

| Слой | Технология | Где крутится |
|---|---|---|
| Frontend | Next.js (React), TypeScript, Tailwind CSS, PWA | Vercel — **escrowkz-web.vercel.app** (живое демо) |
| Backend | Node.js + Express, TypeScript | Render (free-тариф, засыпает без трафика — будить запросом) |
| ORM / БД | Prisma ORM → PostgreSQL | Neon (облачный Postgres) |
| Auth | JWT + bcrypt | — |
| Keep-alive | GitHub Actions пингует Render | `.github/workflows/keep-alive.yml` |

## 2. Структура бэкенда (`apps/api/src`)

```
index.ts            — вход, сборка Express-приложения
env.ts              — конфиг/переменные окружения
db.ts               — Prisma-клиент
auth.ts             — JWT-аутентификация, middleware requireAuth
upload.ts           — загрузка файлов (KYC, фото сдачи)
geo.ts              — haversine-расчёт дистанции (GPS-проверка приёмки)
grade.ts            — грейды мастеров (anti-fraud: уровень → % аванса)
ai-mediator.ts      — ИИ-медиатор споров (уровень 1 арбитража)
bank.ts             — АБСТРАКЦИЯ БАНКА: holdPayment / releasePayment / splitTransaction;
                      провайдер выбирается env-переменной BANK_PROVIDER (mock | alatau)
bank-mock.ts        — мок-провайдер (фейковый номинальный IBAN, сплит 94/6 — УСТАРЕЛ, в ТЗ новая модель 4+2)
bank-alatau.ts      — клиент Alatau City Bank Business API (sandbox; заблокирован на ключах/ЭЦП)
routes/auth.ts      — регистрация/логин
routes/orders.ts    — сделки: статусная машина, фото+GPS на READY, блокировка выплаты при споре
routes/masters.ts   — каталог мастеров
routes/disputes.ts  — споры (AI-чат → эскалация эксперту)
routes/admin.ts     — админка
routes/demo.ts      — демо-данные
```

## 3. Статусная машина (routes/orders.ts)

```
CREATED → PAID_HOLD → IN_PROGRESS → READY → ACCEPTED → SPLIT_PAYOUT
```
- Переходы только последовательные (`NEXT_STATUS`-map, перескоки отвергаются).
- `READY`: фото результата обязательно; GPS мастера сверяется с адресом заказа (радиус 500 м, мягкая проверка — предупреждение, не блок).
- Выплата (`ACCEPTED → SPLIT_PAYOUT`) блокируется, если по заказу есть спор в статусе OPEN.
- После выплаты вызывается `bumpGradeAfterPayout` (грейд мастера растёт).

## 4. Схема данных (prisma/schema.prisma — полностью)

- **User**: id, role (CLIENT | MASTER), fullName, email (unique), phone, passwordHash, kycStatus (PENDING | VERIFIED | REJECTED), idDocumentUrl, businessRegistrationUrl, payoutIban, createdAt. Связи: grade, ordersAsClient, ordersAsMaster.
- **Grade**: masterId (unique), level (default 1), completedOrdersCount, advancePercent (default 0). Логика: грейд 1 — первые 20 заказов, 0% аванса; грейд 2+ — аванс 30% (пока не включено в UI).
- **Order**: clientId, masterId?, status (enum выше), amount Decimal(12,2) — **в новой архитектуре заменить на целые тиыны**, address, addressLat/Lng, readyPhotoUrl, readyLat/Lng, readyGpsDistanceMeters, readyGpsWithinRadius, createdAt/updatedAt. Связи: transactions[], disputes[].
- **Transaction**: orderId, type (HOLD | RELEASE | SPLIT_MASTER | SPLIT_PLATFORM), amount, nominalIban?, createdAt. ⚠️ Это источник правды для «экрана денег» из ТЗ п. 4.
- **Dispute**: orderId, level (AI_CHAT | EXPERT), status (OPEN | RESOLVED_AI | RESOLVED_EXPERT), resolution?, createdAt, resolvedAt. + **DisputeMessage**: sender (CLIENT | MASTER | AI), text.

## 5. Что переиспользовать, что менять

**Переиспользовать (проверено, работает):**
- Статусная машина и её инварианты (п. 3) — логика выверена, менять только модель комиссии.
- Схема сущностей (п. 4) как минимум концептуально — покрывает все кейсы ТЗ.
- Паттерн абстракции банка (bank.ts) — в ТЗ это обязательное требование (провайдеры mock | freedompay | manual).
- GPS/фото-валидация приёмки.

**Менять:**
- Сплит 94/6 → модель 4% + 2% (ТЗ п. 6), суммы в тиынах integer.
- Добавить: идемпотентность платёжных операций, аудит-лог, вебхуки (ТЗ п. 11), manual-провайдер для ручного эскроу Freedom (ТЗ п. 10), Offer/торг как сущность (сейчас торг был только в твоём прототипе).

**Решение по стеку** (обсуждали на синке): бэкенд можно пересобрать на Python/FastAPI, если так быстрее — при условии сохранения схемы данных, статусной машины и абстракции провайдера. Фронт и PWA — на твоё усмотрение с учётом 18-страничного дизайн-концепта «Сенім». Текущее демо остаётся живым для банков, пока новое не достигнет паритета.

## 6. Внешние контуры (статус на 02.11.2026)

- **Freedom Pay**: публичная дока, приём `/init_payment`, выплата `/api/reg2nonreg`; PCI DSS не нужен (фреймы провайдера). Ключи песочницы запрошены у менеджеров.
- **Freedom Bank эскроу**: продукт подтверждён банком — трёхсторонний договор, физлицо-плательщик, 0 ₸ открытие/обслуживание, раскрытие по расписке, API нет (поэтому manual-провайдер). Контакт банка в работе (Нурдавлет, проект ответа банка).
- **Alatau Business API**: клиент написан (bank-alatau.ts), заблокирован на API-ключах + ЭЦП/NCALayer.
- **БЦК**: Escrow API на рефакторинге, продукт эскроу-счёта 12 000 ₸/мес — резервный вариант.

Вопросы: Мадияр +7 701 556 99 97, группа «Безопасная сделка» в Telegram.
