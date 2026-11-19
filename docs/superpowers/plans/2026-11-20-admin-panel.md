# Админка администратора — план реализации

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Владелец входит как «Администратор» (роль ADMIN, обязательная 2FA), видит статистику платформы и все таблицы базы `apps/web`, правит разрешённые поля; каждая правка — аудит со старым и новым значением в той же транзакции.

**Architecture:**
- **identity (Go)** — роль `ADMIN`: сотрудник с одной ролью, второй фактор обязателен; выдаётся только командой `identity grant-admin` и сидом стенда.
- **web** — роль в Prisma и проекции, дом `/v2/admin`, общий экран второго фактора.
- **Модуль `src/modules/admin`** — метаданные моделей (генерируются из `schema.prisma`), реестр правил `rules.ts`, чтение (select только видимых полей), правка (аудит + условный `updateMany`), статистика.
- **Экраны** — `src/app/(app)/v2/admin/`.

**Tech Stack:** Go 1.x (connect-go, pgx, goose, sqlc), buf (go + es), Next.js 16.4.6, Prisma 7, zod, Vitest, Playwright.

**Spec:** `docs/superpowers/specs/2026-11-20-admin-panel-design.md`

## Global Constraints

- **Окружение web.** Работа в `apps/web`; правила — `apps/web/CLAUDE.md`, `SKILL.md`, `AGENTS.md`. Next 16: перед работой с Server Actions и кэшем смотри `node_modules/next/dist/docs/`.
- **Запуск vitest.** Только так: `cd /d/senim-platform && cd apps/web && npx vitest run --project unit|integration <файл>`. Для integration: `DATABASE_URL=postgresql://postgres:postgres@localhost:5442/senim_v2web_test TEST_DATABASE_URL=<то же>`. Путь с `(app)` указывай файлом целиком.
- **Go.** `export PATH="/c/Program Files/Go/bin:$HOME/go/bin:$PATH"`; DoD: `go vet ./...`, `go tool golangci-lint run ./...`, `go tool buf lint`, `go test ./...` (без `-race` локально). Код генерации (`gen/go`, `apps/web/src/gen`) — только `go tool buf generate`, руками не править.
- **Базы.** Только `senim_v2web_test` и `senim_v2web_e2e` на localhost:5442. Никогда не трогать `senim`, `senim_test`, `senim_e2e`. Не запускать `npm run db:up`. База identity — только стенд v2 (docker compose `core`).
- **Интерфейс v2.** Компоненты только из `@/kit`. Тексты только из `ru` (`src/i18n/ru/app/admin.ts`), не в разметке. Кнопки и поля ≥ 48 px, одно главное действие на экране, «Назад» видна на вложенных экранах.
- **Серверные входы.** Каждый Server Action — `action()` с zod-схемой, первой строкой обработчика `requireUser("ADMIN")`. Модуль `admin` повторно проверяет роль сам.
- **Аудит.** Правка — в `transaction()`: сначала `recordAudit`, затем условный `updateMany`; `count !== 1` → `fail.conflict` (откат вместе с аудитом).
- **ПДн.** Поля на `Enc`, `Hash`, `Last4` и прочие `hidden` никогда не попадают в `select`, поиск, фильтр, ответ, ошибку или аудит.
- **Деньги.** Тиыны, `BigInt`, без float; денежная статистика — только из `MoneyTransaction`.
- **Миграции.** Руками: web — `prisma/migrations/20261120120000_admin_role/migration.sql`, затем `npx prisma generate`; identity — `services/identity/migrations/0013_admin_role.sql`.
- **Логирование.** Без `console.log`/`fmt.Println`: `logger` в web, `log/slog` в Go. Без `any`.
- **Порты.** 3000, 3100, 3110, 5440, 5442 не занимать. Dev-сервер для проверки — 3112 с `NEXT_DIST_DIR=.next-dbg`, после — остановить, `tsconfig.json` откатить.
- **Нельзя трогать.** `apps/web/.env.example`.
- **Коммиты.** Conventional Commits по-русски, тело «почему / что / как проверено», последняя строка `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`. Файлы явными путями. Не пушить.

## Review Focus

1. **Подмена модели или поля в форме.** `updateRecordAction` с `model: "MoneyTransaction"`, `field: "status"`, `field: "iinHash"`, `field: "id"`, несуществующим полем или моделью → `FORBIDDEN`/`VALIDATION`, ни изменения, ни строки аудита. Тест — задача 7.
2. **Утечка скрытых полей через связи и поиск.** Карточка `ExecutorProfile` со связью на `User`; поиск `q`, равный значению `iinHash`/`iinLast4`; фильтр `?f.iinHash=…` → в ответе нет ни одного скрытого поля и совпадений по скрытым полям нет. Тест — задача 6.
3. **Администратор без второго фактора.** Сессия ADMIN без пройденного TOTP: страницы → экран второго фактора, действия и модуль → `MFA_REQUIRED`; identity отдаёт `mfa_required = true` для активной роли ADMIN. Тесты — задачи 1 и 3.
4. **Оператор в админке.** Оператор (с 2FA) на `/v2/admin…` и в действиях → отказ; в модуле — `FORBIDDEN`. Тест — задачи 3, 6, 7.
5. **Одновременная правка.** Две правки одного поля с одинаковым `from` → одна применена, вторая `CONFLICT`, аудит — одна запись. Тест — задача 7.

---

### Task 1: identity — роль ADMIN, сотрудник со вторым фактором

**Files:**
- Modify: `proto/senim/identity/v1/identity.proto` (`ROLE_ADMIN = 5;` с комментарием), затем `go tool buf generate` (обновит `gen/go/...` и `apps/web/src/gen/senim/identity/v1/identity_pb.ts`)
- Create: `services/identity/migrations/0013_admin_role.sql` (goose up/down: CHECK `roles <@ ARRAY['CLIENT','EXECUTOR','OPERATOR','MEASURER','ADMIN']`, `NOT (roles && ARRAY['OPERATOR','MEASURER','ADMIN']) OR cardinality(roles) = 1`, `active_role IN (…,'ADMIN')` — пересоздать ограничения из `0002`/`0003` с теми же именами)
- Modify: `services/identity/internal/session.go` (`isStaff` + `ADMIN`; `MfaRequired: needsMfa(s.ActiveRole)`), `services/identity/internal/mfa.go` (`needsMfa(role string) bool` — `OPERATOR` или `ADMIN`; `operatorSession`/`lockedOperatorSession` проверяют `needsMfa`; константа `mfaRole` остаётся `OPERATOR` для переходов KYC и согласий), `services/identity/internal/stand.go` (проверка «сотрудник — одна роль» включает `ADMIN`; TOTP-секрет сида допустим для ролей с `needsMfa`), `services/identity/internal/roles.go` (`GrantRole` по-прежнему не выдаёт `ADMIN`)
- Test: `services/identity/internal/roles_test.go`, `mfa_test.go` (или где проверяется второй фактор), `stand_test.go`, `store_test.go`/миграции

**Interfaces:**
- Produces: `identityv1.Role_ROLE_ADMIN`; `needsMfa(role string) bool`; TS `Role.ADMIN` в `@/gen/senim/identity/v1/identity_pb`.

- [ ] **Step 1: Написать падающие тесты Go.**
  - сессия с активной ролью `ADMIN` → `mfa_required = true`; `StartTotpEnrollment`/`VerifySecondFactor` работают для ADMIN;
  - переходы KYC и отзыва согласия администратором → `role_forbidden` (остаются за OPERATOR);
  - `SeedUsers` с ролями `[ADMIN, CLIENT]` → `invalid_request`; `[ADMIN]` с TOTP — проходит;
  - `GrantRole(ROLE_ADMIN)` → `role_forbidden`;
  - миграция: вставка пользователя с `roles = {ADMIN}` проходит, `{ADMIN, CLIENT}` — нарушение CHECK; сессия ADMIN — `staffSessionTTL` (8 ч).
- [ ] **Step 2: Запустить** `cd /d/senim-platform/services/identity && go test ./...`. Expected: FAIL на новых случаях.
- [ ] **Step 3: Реализовать** по Files; `go tool buf generate` из корня.
- [ ] **Step 4: Запустить** DoD Go (`go vet ./...`, `go tool golangci-lint run ./...`, `go tool buf lint`, `go test ./...`) и `npm --prefix apps/web run typecheck` (TS-генерация не ломает web). Expected: PASS.
- [ ] **Step 5: Commit** `feat(identity): роль администратора — сотрудник с обязательным вторым фактором`.

### Task 2: identity — команда `grant-admin`

**Files:**
- Modify: `services/identity/internal/run.go` (подкоманда `grant-admin` по образцу `mfa-reset`: флаг `--phone`, `parsePhone`, `LoadMfaReset`-подобная конфигурация с `AppDSN`, таймаут)
- Create: `services/identity/internal/grant_admin.go` (`grantAdmin(ctx, pool, phone, now) (uuid.UUID, error)`), `grant_admin_test.go`
- Modify: `services/identity/README.md` (или где описан `mfa-reset`) — абзац о `grant-admin`

**Interfaces:**
- Produces: `identity grant-admin --phone +7XXXXXXXXXX`.

- [ ] **Step 1: Написать падающие тесты** (реальная БД стенда identity, как у тестов `mfa-reset`):
  - нового номера нет → создаётся пользователь `roles {ADMIN}`, `default_role ADMIN`; аудит `user.role_granted` с `actor_kind "cli"` и событие `RoleGranted` в outbox — в одной транзакции;
  - номер уже ADMIN → без изменений, без второго события (повтор);
  - номер с другими ролями (CLIENT, OPERATOR…) → ошибка «у номера уже есть роли — администратор не совмещает роли», без изменений;
  - заблокированный пользователь → ошибка.
- [ ] **Step 2: Запустить** `go test ./internal/ -run GrantAdmin`. Expected: FAIL.
- [ ] **Step 3: Реализовать.** Телефон в лог не пишется (только `user_id`).
- [ ] **Step 4: Запустить** DoD Go. Expected: PASS.
- [ ] **Step 5: Commit** `feat(identity): команда grant-admin — выдача роли администратора из терминала`.

### Task 3: web — роль ADMIN, вход, второй фактор, оболочка, сид

**Files:**
- Modify: `apps/web/prisma/schema.prisma` (`enum Role { … ADMIN }` с комментарием), Create: `apps/web/prisma/migrations/20261120120000_admin_role/migration.sql` (`ALTER TYPE "Role" ADD VALUE 'ADMIN';`)
- Modify: `src/modules/identity/projection.ts` (обе карты ролей), `src/modules/identity/roles.ts` (`STAFF_ROLES` + `ADMIN`), прочие исчерпывающие карты `Record<Role, …>` — по ошибкам typecheck (v1 — минимально, только чтобы компилировалось)
- Modify: `src/app/(app)/_shell/auth.ts` (`homeFor`: `ADMIN` → `/admin`; `requireAdmin(next: string): Promise<CurrentUser>` = `requireV2User(next, "ADMIN")`), экран `src/app/(app)/v2/operator/mfa/` (`requireMfaUser` и действия допускают `ADMIN`; после — `homeFor`), `src/app/(app)/_shell/nav.ts` (`navFor` для `ADMIN`: вкладки `stats` `/v2/admin`, `data` `/v2/admin/data`, `profile`; без «Заказать мебель»)
- Modify: `src/seed/data.ts` (`ADMIN = { fullName: "Санжар Администратор", phone: "+77000000002", … }`, `ADMIN_TOTP_SECRET` — 32 символа base32, отличный от операторского), сид web, передающий его в `SeedUsers` с `[ROLE_ADMIN]`; `docs/agents/STAND_DATA.md` (строка администратора)
- Modify: `src/i18n/ru/app/shell.ts` (подписи вкладок: «Статистика», «Данные»)
- Test: `src/modules/identity/projection.int.test.ts`, `src/app/(app)/_shell/auth.test.ts` (или где `homeFor`), `nav.test.ts`, тест экрана второго фактора (`second-factor.dom.test.tsx`/`mfa` int), `src/modules/identity/roles.test.ts`

**Interfaces:**
- Consumes: `Role.ADMIN` (Task 1).
- Produces: `requireAdmin(next)`, `homeFor` → `/v2/admin` для ADMIN, `ADMIN`/`ADMIN_TOTP_SECRET` в `src/seed/data.ts`.

- [ ] **Step 1: Написать падающие тесты.**
  - проекция: пользователь identity с `ROLE_ADMIN` → `User.role = ADMIN`, `roles = [ADMIN]`;
  - `homeFor({role:"ADMIN"})` → `/v2/admin`; `navFor` ADMIN — вкладки `[stats, data, profile]`, `action` нет;
  - ADMIN с `mfa.required && verifiedAt === null` → `requireUser("ADMIN")` даёт `MFA_REQUIRED`; барьер ведёт на `/v2/operator/mfa`; экран второго фактора открывается администратору;
  - `requireUser("ADMIN")` оператором → `FORBIDDEN`.
- [ ] **Step 2: Запустить.** Expected: FAIL.
- [ ] **Step 3: Реализовать.** Миграцию применить к `senim_v2web_test` (`DATABASE_URL=… npx prisma migrate deploy`), `npx prisma generate`.
- [ ] **Step 4: Запустить** тесты, typecheck, lint. Expected: PASS.
- [ ] **Step 5: Commit** `feat(web): роль администратора — вход со вторым фактором, дом и меню`.

### Task 4: Метаданные моделей из `schema.prisma`

**Files:**
- Create: `src/modules/admin/schema-parse.ts` (чистая функция), `scripts/admin-schema.ts` (читает `prisma/schema.prisma`, пишет `src/modules/admin/schema.gen.ts`), `src/modules/admin/schema.gen.ts` (сгенерированный, в git), `src/modules/admin/schema-parse.test.ts`, `src/modules/admin/schema-sync.test.ts`
- Modify: `apps/web/package.json` (`"admin:schema": "tsx scripts/admin-schema.ts"`)

**Interfaces:**
- Produces:
  - `type AdminField = { name: string; kind: "scalar" | "enum" | "object"; type: string; required: boolean; list: boolean; id: boolean; updatedAt: boolean; hasDefault: boolean; relationFields: readonly string[] }` — `relationFields` у поля-связи — скалярные поля из `@relation(fields: [...])`.
  - `type AdminModel = { name: string; fields: readonly AdminField[]; idField: string | null }` — `idField` — единственное поле с `@id`, иначе `null` (у такой модели нет карточки и правки).
  - `parseSchema(source: string): AdminModel[]`; `ADMIN_MODELS: readonly AdminModel[]` в `schema.gen.ts`; `ENUMS: Readonly<Record<string, readonly string[]>>` там же.

- [ ] **Step 1: Написать падающие тесты.**
  - разбор фрагмента: `id String @id @default(cuid())`, `note String?`, `tags String[]`, `status DealStatus @default(CREATED)`, `updatedAt DateTime @updatedAt`, `client User @relation("X", fields: [clientId], references: [id])`, `@@index` и комментарии `//`/`///` игнорируются; `enum` разбирается в `ENUMS`;
  - `schema-sync`: `parseSchema(readFileSync("prisma/schema.prisma"))` равен `ADMIN_MODELS`; множество имён моделей равно `Object.values(Prisma.ModelName)`.
- [ ] **Step 2: Запустить.** Expected: FAIL.
- [ ] **Step 3: Реализовать**, сгенерировать `schema.gen.ts` командой `npm run admin:schema`.
- [ ] **Step 4: Запустить.** Expected: PASS.
- [ ] **Step 5: Commit** `feat(web): метаданные моделей для админки из schema.prisma`.

### Task 5: Реестр правил доступа

**Files:**
- Create: `src/modules/admin/rules.ts`, `src/modules/admin/rules.test.ts`

**Interfaces:**
- Consumes: `ADMIN_MODELS`, `ENUMS` (Task 4).
- Produces:
  - `type Access = "hidden" | "readonly" | "editable"`;
  - `OVERRIDES: Readonly<Record<string, Readonly<Record<string, Access>>>>` — явные исключения (ключ `"*"` — вся модель); правит владелец после показа;
  - `fieldAccess(model: string, field: string): Access` — неизвестные модель или поле → `"hidden"`;
  - `visibleFields(model: string): readonly AdminField[]`; `editableFields(model: string): readonly AdminField[]`; `modelReadonly(model: string): boolean`.
- Правила по умолчанию — дословно раздел «Правила доступа к данным» спеки (порядок: `OVERRIDES` → модель → признак поля; `hidden` сильнее всего).

- [ ] **Step 1: Написать падающие тесты.**
  - каждое поле всех моделей с окончанием `Enc`, `Hash`, `Last4` → `hidden` (перебор `ADMIN_MODELS` — новое поле такого вида ловится автоматически);
  - каждое поле с типом-перечислением на `Status` → не `editable`;
  - все поля `MoneyTransaction`, `AuditEvent`, `PaymentWebhookEvent`, `Document`, `Signature`, `HandSignature`, `User`, `Session`, `OtpCode`, `Job`, `RateLimitBucket`, `AiUsage`, `PushSubscription` → не `editable`; `PushSubscription.p256dh|auth|endpoint` → `hidden`;
  - `id`, `createdAt`, `updatedAt`, `@updatedAt`, `BigInt`, `Json`, списки, скалярные FK, `DateTime` моделей со статусной машиной (список из спеки) → `readonly`;
  - `FurnitureType.name`, `active`, `sortOrder` → `editable`, `FurnitureType.slug` → `editable` (решение исполнителя плана: адрес раздела; владелец может закрыть); `MaterialPrice.priceKzt` (`Int`, тенге справочника, не тиыны сделки) и `name` → `editable`, `MaterialPrice.updatedById` → `readonly` (FK);
  - `fieldAccess("Nope","x")` и `fieldAccess("Deal","nope")` → `hidden`.
- [ ] **Step 2: Запустить.** Expected: FAIL.
- [ ] **Step 3: Реализовать.**
- [ ] **Step 4: Запустить.** Expected: PASS.
- [ ] **Step 5: Commit** `feat(web): правила доступа админки к таблицам и полям`.

### Task 6: Чтение — список моделей, записи, карточка, связи

**Files:**
- Create: `src/modules/admin/read.ts`, `src/modules/admin/values.ts` (сериализация), `src/modules/admin/access.ts` (`assertAdmin(user: CurrentUser): void` — `user.role === "ADMIN"` и пройденный второй фактор, иначе `fail.forbidden`/`fail.mfaRequired`), `src/modules/admin/index.ts`
- Test: `src/modules/admin/read.int.test.ts`, `src/modules/admin/values.test.ts`

**Interfaces:**
- Produces:
  - `type AdminValue = string | number | boolean | null | readonly string[]` — `BigInt` → строка цифр, `Date` → ISO, `Json` → `JSON.stringify`, enum → строка.
  - `type AdminRow = Readonly<Record<string, AdminValue>>`.
  - `listModels(user: CurrentUser): Promise<{ name: string; count: number; readonly: boolean }[]>`.
  - `listRecords(user: CurrentUser, model: string, query: { q?: string; filters?: Readonly<Record<string, string>>; where?: { field: string; value: string }; page?: number }): Promise<{ rows: AdminRow[]; total: number; page: number; pageSize: 50; columns: readonly string[] }>` — `where` — переход по связи «один ко многим» (поле должно быть видимым скалярным FK модели); сортировка — `createdAt desc`, если поле есть, иначе по `idField`.
  - `getRecord(user: CurrentUser, model: string, id: string): Promise<{ row: AdminRow; fields: readonly { name: string; type: string; access: "readonly" | "editable"; enumValues?: readonly string[]; required: boolean }[]; relations: readonly AdminRelation[] }>`, где `type AdminRelation = { name: string; model: string; kind: "one"; targetId: string | null } | { name: string; model: string; kind: "many"; count: number; field: string }` — неизвестная модель, модель без `idField`, нет записи → `fail.notFound`.
  - Доступ к Prisma-делегату — через `db[lowerFirst(model)]` с типом, сужённым через карту делегатов; без `any`.

- [ ] **Step 1: Написать падающие тесты** (реальная БД, фабрики `test/factories`):
  - оператор и покупатель → `FORBIDDEN`; ADMIN без второго фактора → `MFA_REQUIRED`;
  - `listRecords("User")` и `getRecord("ExecutorProfile", id)`: в `JSON.stringify(result)` нет значений и имён `iinEnc`, `iinHash`, `iinLast4`, `binIinLast4`, `payoutIbanLast4`, `payoutIbanEnc`;
  - поиск `q` = значение `iinHash` или `iinLast4` записи → 0 строк; поиск по `fullName` — находит;
  - `filters: { iinHash: "…" }` и `where: { field: "iinHash", … }` → `VALIDATION`/игнор без утечки (выбери отказ `VALIDATION`), фильтр по `status` — работает;
  - связь «один» у `Deal` → `targetId` клиента; связь «много» `Request.offers` → `count`; связанная запись открывается своей карточкой со своими правилами;
  - `BigInt` суммы `Deal` приходят строкой.
- [ ] **Step 2: Запустить.** Expected: FAIL.
- [ ] **Step 3: Реализовать.** `select` строится только из `visibleFields`; связи — `select` только `idField` связанной модели (для «один») и `_count` (для «много»).
- [ ] **Step 4: Запустить** тесты `src/modules/admin`. Expected: PASS.
- [ ] **Step 5: Commit** `feat(web): админка — чтение таблиц без скрытых полей`.

### Task 7: Правка записи с аудитом

**Files:**
- Create: `src/modules/admin/update.ts`, экспорт в `index.ts`
- Test: `src/modules/admin/update.int.test.ts`

**Interfaces:**
- Produces:
  - `updateRecord(user: CurrentUser, input: { model: string; id: string; changes: readonly { field: string; from: string | null; to: string | null }[] }): Promise<{ changed: number }>`.
  - Разбор значения по типу поля: `String` — как есть (`null`/пустая строка у необязательного → `null`, у обязательного → `VALIDATION` с `fieldErrors[field]`); `Int` — целое в пределах int32; `Boolean` — `"true"`/`"false"`; enum — член `ENUMS[type]`; `DateTime` — ISO-строка; прочие типы — `FORBIDDEN` (они не `editable`).
  - Порядок: `assertAdmin` → модель известна и не `modelReadonly` → каждое поле `editable` (иначе `fail.forbidden`, ничего не пишется) → разбор `from`/`to` → поля с `from === to` отбрасываются (нет изменений → `{changed: 0}` без аудита) → `transaction`: `recordAudit(tx, { actor: { kind: "user", id: user.id, role: "ADMIN" }, action: "admin.record.updated", entity: { type: model, id }, before: {поле: from}, after: {поле: to} })`, затем `updateMany({ where: { [idField]: id, ...from }, data: to })`, `expectOneUpdated` (иначе `fail.conflict(ru…conflict)`).

- [ ] **Step 1: Написать падающие тесты.**
  - правка `FurnitureType.name`: значение изменено, одна запись `AuditEvent` с `before`/`after` только этого поля, `actorRole: "ADMIN"`;
  - подмены (Review Focus 1): `MoneyTransaction.*`, `Deal.status`, `User.fullName`, `ExecutorProfile.binIinHash`, `id`, `createdAt`, `Deal.<BigInt-сумма>`, неизвестное поле, неизвестная модель → отказ, данные и число строк `AuditEvent` не изменились; в тексте ошибки нет значения скрытого поля;
  - одновременно две правки с одинаковым `from` (`Promise.all`) → одна успешна, вторая `CONFLICT`, аудит — одна запись;
  - `from` не совпал с текущим значением → `CONFLICT`, без аудита;
  - оператор → `FORBIDDEN`; ADMIN без второго фактора → `MFA_REQUIRED`;
  - обязательное поле в пустую строку → `VALIDATION` с `fieldErrors`.
- [ ] **Step 2: Запустить.** Expected: FAIL.
- [ ] **Step 3: Реализовать.**
- [ ] **Step 4: Запустить** тесты `src/modules/admin`. Expected: PASS.
- [ ] **Step 5: Commit** `feat(web): админка — правка поля с аудитом и защитой от одновременной правки`.

### Task 8: Статистика

**Files:**
- Create: `src/modules/admin/stats.ts`, экспорт в `index.ts`; Test: `src/modules/admin/stats.int.test.ts`
- Может потребоваться: вынести чистые агрегаты из `src/modules/operator/report.ts` в общий для `operator` и `admin` вид (через `@/modules/operator` экспорт без проверки роли или общий модуль) — без изменения поведения операторского отчёта; тесты `report.int.test.ts` остаются зелёными.

**Interfaces:**
- Produces:
  - `type AdminPeriod = "7d" | "30d" | "all"`.
  - `adminStats(user: CurrentUser, period: AdminPeriod, now?: Date): Promise<{ requests: { status: RequestStatus; count: number }[]; deals: { status: DealStatus; count: number }[]; masters: { status: RegistrationStatus; count: number }[]; money: { paidTiyn: bigint; payoutTiyn: bigint; refundTiyn: bigint; incomeTiyn: bigint }; funnel: { published: number; withOffer: number; dealCreated: number; paid: number; accepted: number; paidOut: number } }>` — период по `createdAt` сущности; деньги — только `MoneyTransaction` (тип и статус — как в `incomeReport` оператора; доход = оплачено − выплата по сделкам с выплатой, как там).

- [ ] **Step 1: Написать падающие тесты** на фабриках: две заявки, сделка до `SPLIT_PAYOUT` с проводками → числа воронки и денег точные (тиыны); период `7d` отсекает запись `createdAt` 10 дней назад; оператор → `FORBIDDEN`.
- [ ] **Step 2: Запустить.** Expected: FAIL.
- [ ] **Step 3: Реализовать.**
- [ ] **Step 4: Запустить** тесты `src/modules/admin`, `src/modules/operator/report.int.test.ts`. Expected: PASS.
- [ ] **Step 5: Commit** `feat(web): админка — статистика платформы из журнала денег`.

### Task 9: Экраны админки

**Files:**
- Create: `src/i18n/ru/app/admin.ts` (подключить в `src/i18n/ru/app/index.ts`)
- Create: `src/app/(app)/v2/admin/page.tsx` (статистика, выбор периода — ссылки `?period=`), `src/app/(app)/v2/admin/data/page.tsx` (модели: имя, число записей, «только чтение»), `src/app/(app)/v2/admin/data/[model]/page.tsx` (таблица `DataTable`/`TableOrCards`, поиск `q`, фильтры `f.<поле>`, `where`, `Pagination`), `src/app/(app)/v2/admin/data/[model]/[id]/page.tsx` (карточка, связи, форма правки), `src/app/(app)/v2/admin/data/[model]/[id]/RecordForm.tsx` (клиентская форма: редактируемые поля — `TextField`/`Checkbox`/`Select` kit по типу; скрытые поля `from`; одно главное действие «Сохранить»), `src/app/(app)/v2/admin/data/[model]/[id]/actions.ts`
- Test: `src/app/(app)/v2/admin/admin.int.test.ts` (страницы и действие), `RecordForm.dom.test.tsx`

**Interfaces:**
- Consumes: `requireAdmin` (Task 3), `listModels`, `listRecords`, `getRecord` (Task 6), `updateRecord` (Task 7), `adminStats` (Task 8).
- Produces: `updateRecordAction = action("app.admin.updateRecord", z.strictObject({ model: z.string().min(1).max(64), id: z.string().min(1).max(100), changes: z.array(z.strictObject({ field: z.string().min(1).max(64), from: z.string().max(10000).nullable(), to: z.string().max(10000).nullable() })).min(1).max(50) }), …)` — первой строкой `requireUser("ADMIN")`, затем `updateRecord`, `revalidatePath` карточки.
- Тексты `ru.app.admin` — точные главные:
  - `stats.title`: «Статистика»; `stats.period`: `{ "7d": "7 дней", "30d": "30 дней", all: "Всё время" }`; `stats.money.paid`: «Оплачено покупателями»; `stats.money.payout`: «Выплачено мастерам»; `stats.money.refund`: «Возвраты»; `stats.money.income`: «Доход платформы»; `stats.funnel.title`: «Воронка»; шаги: «Заявки опубликованы», «Есть предложение», «Сделка создана», «Оплачена», «Принята», «Выплачено».
  - `data.title`: «Данные»; `data.readonly`: «Только чтение»; `data.search`: «Поиск»; `data.empty`: «Записей нет».
  - `record.save`: «Сохранить»; `record.saved`: «Сохранено. Изменение записано в журнал»; `record.conflict`: «Запись уже изменили. Обновите страницу и повторите»; `record.relations`: «Связи».
  - Имена моделей и полей — как в схеме (это экран владельца; перевод — по желанию владельца после показа).

- [ ] **Step 1: Написать падающие тесты.**
  - страницы: гость → вход; оператор → отказ (нет роли); ADMIN без второго фактора → экран второго фактора; ADMIN — статистика, список моделей, таблица, карточка;
  - HTML карточки `ExecutorProfile` не содержит значений скрытых полей;
  - действие: подмена `model`/`field` → ошибка, без изменений; успешная правка → `revalidatePath`; неверный ввод → `VALIDATION`;
  - форма: у редактируемых полей высота kit ≥ 48 px (`min-h-control`), одно главное действие, `readonly`-поля — текстом.
- [ ] **Step 2: Запустить.** Expected: FAIL.
- [ ] **Step 3: Реализовать.**
- [ ] **Step 4: Запустить** тесты, typecheck, lint. Expected: PASS.
- [ ] **Step 5: Commit** `feat(web): экраны админки — статистика, таблицы, карточка с правкой`.

### Task 10: Стенд и e2e администратора

**Files:**
- Create: `apps/web/e2e-v2/flows/admin.spec.ts` (в `flows`: перед ним пересев стенда, где появляется администратор сида)
- Modify: `apps/web/e2e-v2/README.md` (строка об админе), при необходимости `e2e-v2/operator-support.ts` (`passAdminTotpV2` по образцу оператора с `ADMIN_TOTP_SECRET`)

- [ ] **Step 1: Пересобрать identity стенда** после задач 1–2: `docker build -f services/identity/Dockerfile -t senim-v2-identity:dev .`, затем `docker compose … up -d --no-build --wait identity` (как в `deploy/compose`; миграция `0013` применяется при старте/`migrate`). Проверка: `docker compose … ps identity` — healthy.
- [ ] **Step 2: Сценарий.**
  1. Администратор (`+77000000002`) входит по коду с экрана, вводит TOTP → `/v2/admin`, видны «Статистика» и «Доход платформы».
  2. «Данные» → `FurnitureType` → запись → меняет название → «Сохранено…»; в «Данные» → `AuditEvent` — строка `admin.record.updated`.
  3. Карточка `ExecutorProfile` засеянного мастера — нет текста ИИН/IBAN и их последних цифр.
  4. Оператор входит (с TOTP) и открывает `/v2/admin` → не админка (отказ/свой дом).
- [ ] **Step 3: Запустить** по `e2e-v2/README.md` с `E2E_FLOWS=1 … --project flows-desktop` (порт сервера — свой, 3112, `E2E_PORT=3112`; стенд 3110 не трогать). Expected: PASS. Пересев стирает данные стенда — запуск согласует контролёр.
- [ ] **Step 4: Полная проверка** `cd /d/senim-platform && cd apps/web && U=postgresql://postgres:postgres@localhost:5442/senim_v2web_test && DATABASE_URL=$U TEST_DATABASE_URL=$U npm run check` и DoD Go. Expected: PASS.
- [ ] **Step 5: Commit** `test(web): e2e администратора — вход с TOTP, правка с аудитом, без ПДн`.
