# «Сенім» v2 — план 2: identity, вход и сессии через gRPC. Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Go-сервис `identity` владеет пользователями (телефон, роли, блокировка, демо-признак), кодами входа, сессиями и внутренним токеном; `web` входит, выходит, переключает и выдаёт роли только через gRPC, а все 147 сценариев e2e проходят против стенда v2.

**Architecture:** `web` (BFF) зовёт `senim.identity.v1.IdentityService` через mesh с дедлайном 5 с; `identity` проверяет вызывающего (`server.Caller`), пишет изменения и событие аудита в одной транзакции (outbox), повтор с тем же `idempotency_key` даёт тот же результат. Токен сессии генерирует `web` и передаёт в `VerifyOtp`/`StartDemoSession`; `identity` хранит только его sha256. Старая база `web` продолжает работать: её таблица `User` становится **проекцией** пользователя `identity` (тот же `id`), которую `web` создаёт и обновляет из ответов `identity`. Внутренний токен — JWT EdDSA (Ed25519, 5 мин) с `kid`; проверка — `pkg/authz` по ключам из `GetSigningKeys`.

**Tech Stack:** Go 1.27 (toolchain из `go.mod`), connect-go v2, pgx v5 + sqlc + goose, `github.com/golang-jwt/jwt/v5` (EdDSA), testcontainers-go (Postgres 17, NATS); `@connectrpc/connect` в `apps/web`; Envoy mesh; Playwright.

**Spec:** `docs/superpowers/specs/2026-11-08-platform-v2-architecture-design.md` — §4.1 (identity), §4.2, §4.4, §5, §6 (`OtpChannel`), §8, §9.2 шаг 2. Образец — план 1 `docs/superpowers/plans/2026-11-08-platform-v2-01-foundation.md`. Решения плана 1: `docs/PROGRESS.md` (раздел «В план 2»), ADR-010…012.

### Объём плана и что вынесено (решение контроллера, можно оспорить)

План 1 называл план 2 «identity (вход, сессии, токен, ПДн, 2FA, согласия)». Это два независимых куска, поэтому:

- **План 2 (этот):** пользователь, вход по коду, сессии, роли, внутренний токен и его проверка, демо-персоны, сроки хранения, переключение `web`.
- **План 2б (следующий, до плана 3):** ПДн в `identity` — ФИО, ИИН/БИН, IBAN (envelope-шифрование с `kid`, HMAC-поиск), KYC, согласия на ПДн; 2FA операторов (TOTP/WebAuthn) и повторная 2FA. До плана 3 — потому что денежные действия оператора появляются в плане 3 и требуют повторной 2FA (§4.4).
- До плана 2б ФИО, ИИН, контакты, IBAN и KYC остаются в старой базе `web` без изменений.
- Доставка кода: в плане 2 только `mock` (`OtpSender` в `identity`). Telegram Gateway и SMS — в `notify` (план 6, спека §6); `identity` тогда будет звать `notify`, интерфейс `OtpSender` не меняется. Без настоящего канала `APP_ENV=prod` не стартует — это правило `config.Provider`.

## Global Constraints

- Всё из `CLAUDE.md` (Definition of Done, продуктовые инварианты, «Окружение агента») действует для каждой задачи.
- Сервис возвращает коды ошибок, не тексты: `senim.common.v1.ErrorDetail{code, params}`, коды `snake_case`; тексты — только в `apps/web/src/i18n/ru/identity.ts`.
- Каждый изменяющий метод принимает `idempotency_key` (непустой, ≤ 128 символов); повтор с тем же ключом и тем же запросом — тот же ответ без второго эффекта; тот же ключ с другим запросом — `InvalidArgument`, код `idempotency_key_reused`.
- Изменение и событие аудита — в одной транзакции (`outbox.Add`), субъекты только `senim.identity.>`.
- Первая строка каждого обработчика — проверка вызывающего (`server.Caller`): все методы, кроме `GetSigningKeys`, — только `web`; `GetSigningKeys` — любой сервис из `tools/services`. Чужой — `PermissionDenied`, код `caller_forbidden`.
- Секреты в лог не попадают: номер телефона, код, токен сессии, внутренний токен (`pkg/logging` маскирует ключи `phone`, `code`, `token` — не называть поля иначе).
- Деньги не затрагиваются. Названия ролей — как в Prisma: `CLIENT`, `EXECUTOR`, `OPERATOR`, `MEASURER`; сотрудники (`OPERATOR`, `MEASURER`) не совмещают роли.
- Значения из спеки (§4.4): сессия пользователя — 30 мин простоя и 7 дней абсолютно; сотрудника — 8 ч абсолютно (и те же 30 мин простоя); внутренний токен — 5 мин, Ed25519; cookie — `__Host-senim_session` (httpOnly, Secure, SameSite=Lax), в `APP_ENV=dev` по http — `senim_session` без Secure.
- Значения из текущего web (переносятся один к одному): код — 6 цифр, срок 5 мин, 5 попыток; лимиты — повтор раз в 60 с, 5 кодов в час и 10 в сутки на номер, 20 проверок в сутки на номер, 20 запросов и 50 проверок в час с IP, потолки для новых номеров `OTP_DAILY_PREFIX_LIMIT=50` (первые 6 цифр) и `OTP_DAILY_GLOBAL_LIMIT=500`.
- Порты, бюджет памяти, правило `*.vars`, Go вне PATH, тесты без `-race` локально — `CLAUDE.md`. Тесты `apps/web` — только базы `senim_v2web_test` и `senim_v2web_e2e` на `localhost:5442`.
- Схема Prisma старой базы не меняется (таблицы `Session`, `OtpCode` перестают использоваться, удаляются в плане 7): это уменьшает конфликты `git subtree pull`.
- Коммиты — Conventional Commits на русском, тело «почему / что / как проверено», последняя строка `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.

## Review Focus

1. **Обрыв связи после `VerifyOtp`**: `identity` создал сессию, а `web` ответа не получил и повторил вызов с тем же ключом → тот же пользователь, одна сессия, без ошибки «код устарел» (тест в Task 5).
2. **Сессия истекла по простою посреди формы**: Server Action получает `UNAUTHENTICATED`, страница уводит на вход с возвратом; граница простоя — ровно 30 мин (тесты в Task 6 и Task 12).
3. **`identity` недоступен** (обе реплики): `web` отвечает «сервис временно недоступен», cookie не удаляется и человек не «выходит» сам собой; страницы гостя работают (тест в Task 12).
4. **В старой базе есть строка `User` с тем же телефоном, но другим `id`** (dev-база до перехода): проекция не создаёт дубль и не падает молча — ошибка с понятной записью в лог (тест в Task 12).
5. **Переключение или отзыв роли на другом устройстве**: активная роль этой сессии не меняется от чужого переключения, а отозванная роль не действует даже в сессии, которая её помнит (тесты в Task 6).

---

### Task 1: Контракт `IdentityService` и событие аудита

**Files:**
- Modify: `proto/senim/identity/v1/identity.proto`
- Create: `proto/senim/events/v1/audit.proto`, `proto/senim/events/v1/identity.proto`
- Generated: `gen/go/senim/identity/v1/**`, `gen/go/senim/events/v1/*`, `apps/web/src/gen/senim/identity/v1/*`, `apps/web/src/gen/senim/events/v1/*`

**Interfaces — Produces:**
- `enum Role { ROLE_UNSPECIFIED = 0; ROLE_CLIENT = 1; ROLE_EXECUTOR = 2; ROLE_OPERATOR = 3; ROLE_MEASURER = 4; }`
- `message User { string id; string phone; Role default_role; repeated Role roles; bool is_demo; google.protobuf.Timestamp blocked_at; google.protobuf.Timestamp created_at; }` (`phone` — E.164)
- `message Session { string id; Role active_role; google.protobuf.Timestamp expires_at; google.protobuf.Timestamp idle_expires_at; }`
- RPC (все запросы с `idempotency_key`, кроме помеченных «чтение»):
  - `RequestOtp{phone, client_ip, idempotency_key} → {phone, expires_at, demo_code}` — `demo_code` пуст, кроме `DEMO_MODE=true` и `OTP_PROVIDER=mock`
  - `VerifyOtp{phone, code, client_ip, user_agent, session_token, idempotency_key} → {user, session, is_new}`
  - `Authenticate{session_token} → {user, session, access_token, access_expires_at}` — чтение
  - `SignOut{session_token, idempotency_key} → {}`; `SignOutEverywhere{session_token, idempotency_key} → {}`
  - `SwitchRole{session_token, role, idempotency_key} → {user, session}`
  - `GrantRole{session_token, role, idempotency_key} → {user, granted}`
  - `StartDemoSession{user_id, as_role, session_token, user_agent, idempotency_key} → {user, session}`
  - `SeedUsers{repeated SeedUser users, idempotency_key} → {repeated User users}`; `SeedUser{phone, default_role, roles, is_demo, created_at}`
  - `ResetDemo{idempotency_key} → {}`
  - `GetSigningKeys{} → {repeated SigningKey keys}`; `SigningKey{kid, bytes public_key, string alg = "EdDSA"}` — чтение
- `session_token` — base64url без `=` от 32 случайных байт (ровно 43 символа), иначе `InvalidArgument`, `session_token_invalid`.
- Коды ошибок (перечислить в комментарии сервиса): `invalid_phone`, `otp_too_often`, `otp_too_many_requests`, `otp_too_many_today`, `otp_global_limit`, `otp_expired`, `otp_wrong_code` (`params.left`), `otp_attempts_exhausted`, `user_blocked`, `session_invalid`, `session_token_invalid`, `role_not_granted`, `role_forbidden`, `demo_disabled`, `user_not_found`, `caller_forbidden`, `idempotency_key_reused`.
- `events/v1/audit.proto`: `AuditEvent{actor_kind, actor_id, actor_role, action, entity_type, entity_id, string before_json, string after_json, google.protobuf.Timestamp at}` — общий для всех сервисов (план 6 сцепляет хэши).
- `events/v1/identity.proto`: `UserRegistered{user_id, role}`, `RoleGranted{user_id, role}`, `RoleSwitched{user_id, from, to}`, `OtpGlobalLimitReached{limit, date}`.

- [ ] **Step 1:** Написать proto по интерфейсам выше.
- [ ] **Step 2:** Run `go tool buf lint && go tool buf breaking --against '.git#ref=HEAD~1' && go tool buf generate && go build ./gen/... && npm --prefix apps/web run typecheck` — Expected: без ошибок (пустой сервис плана 1 расширяется — `breaking` не ругается).
- [ ] **Step 3: Commit** — `feat(proto): контракт identity v1 и события аудита`.

---

### Task 2: `pkg/idem` и право удаления для app-роли

**Files:**
- Create: `pkg/idem/idem.go`, `pkg/idem/idem_test.go`
- Modify: `pkg/dbx/migrate.go` (маркер), `pkg/dbx/*_test.go`

**Interfaces — Produces:**
- `const idem.Schema` — `CREATE TABLE IF NOT EXISTS idempotency (method text, key text, request_hash bytea NOT NULL, response bytea NOT NULL, created_at timestamptz NOT NULL DEFAULT now(), PRIMARY KEY (method, key))` с маркером `-- senim:app-delete idempotency`; применяется как платформенная схема (как `outbox.Schema`).
- `func idem.Do(ctx context.Context, tx pgx.Tx, method, key string, req proto.Message, resp proto.Message, fn func() error) (replayed bool, err error)` — в транзакции вызывающего: `INSERT … ON CONFLICT DO NOTHING` строки-заявки с `request_hash = sha256(proto.MarshalOptions{Deterministic: true})`; есть готовый ответ с тем же хэшем — заполнить `resp`, `replayed = true`, `fn` не вызывать; хэш другой — `ErrKeyReused`; иначе `fn()`, затем сохранить `resp`. Параллельный второй вызов ждёт блокировку строки и получает сохранённый ответ.
- `type idem.Querier interface { QueryRow(ctx context.Context, sql string, args ...any) pgx.Row }` (подходят `pgx.Tx` и `*pgxpool.Pool`); `func idem.Lookup(ctx context.Context, q Querier, method, key string, req, resp proto.Message) (found bool, err error)` — готовый ответ без блокировки; обработчик зовёт его **до** проверки лимитов, чтобы повтор после успеха не упирался в лимит.
- `var idem.ErrKeyReused` — обработчик превращает в `InvalidArgument` / `idempotency_key_reused`.
- Право `EXECUTE` для app-роли (M7, вторая половина) в плане 2 не нужно: функций у сервисов нет; пункт остаётся в «В план 2» с пометкой «перенесено — нет функций».
- Маркер `-- senim:app-delete <table>` в миграции → `GRANT DELETE` app-роли на эту таблицу; таблица без маркера — DELETE по-прежнему запрещён. Опечатки в маркере — ошибка миграции, как у маркера append-only.

- [ ] **Step 1: Failing tests:** `TestReplayReturnsSavedResponse` (второй `Do` с тем же ключом — `replayed=true`, `fn` вызван один раз), `TestKeyReusedWithOtherRequest` (`ErrKeyReused`), `TestConcurrentSameKeyRunsOnce` (10 горутин — `fn` один раз, у всех одинаковый ответ), `TestFailedFnLeavesNoRecord` (ошибка `fn` → откат, следующий вызов выполняет `fn`); в `pkg/dbx`: `TestAppDeleteMarkerGrantsDelete`, `TestDeleteDeniedWithoutMarker`, `TestAppDeleteMarkerTyposFail`.
- [ ] **Step 2:** Run `go test ./pkg/idem/... ./pkg/dbx/...` — FAIL.
- [ ] **Step 3:** Реализовать.
- [ ] **Step 4:** Run — PASS; `go vet ./... && go tool golangci-lint run ./...` — 0 замечаний.
- [ ] **Step 5: Commit** — `feat(pkg): идемпотентность изменяющих методов и право удаления по маркеру`.

---

### Task 3: identity — схема, хранилище, конфигурация

**Files:**
- Create: `services/identity/migrations/0002_users_sessions.sql`, `services/identity/sqlc.yaml`, `services/identity/queries/*.sql`, `services/identity/internal/store/` (сгенерировано sqlc), `services/identity/internal/store_test.go`
- Modify: `services/identity/internal/config.go`, `services/identity/internal/run.go` (платформенные схемы `idem.Schema`), `services/identity/internal/config_test.go`, `deploy/compose/dev.vars`, `deploy/compose/compose.yaml`

**Interfaces — Produces:**
- Таблицы: `users(id uuid PK DEFAULT gen_random_uuid(), phone text UNIQUE NOT NULL, roles text[] NOT NULL, default_role text NOT NULL, is_demo bool NOT NULL DEFAULT false, blocked_at timestamptz, created_at, updated_at)` с CHECK: `default_role = ANY(roles)`, роли из четырёх значений, `OPERATOR`/`MEASURER` только в одиночку; `sessions(id uuid PK, token_hash bytea UNIQUE, user_id uuid REFERENCES users, active_role text, user_agent text, created_at, last_seen_at, expires_at, revoked_at)`; `otp_codes(id uuid PK, phone, code_hash bytea, attempts int, expires_at, consumed_at, created_at)` + индекс `(phone, created_at DESC)`; `rate_limits(key text PK, window_start timestamptz, count int)`. Маркер `senim:app-delete` — `sessions`, `otp_codes`, `rate_limits` (сроки хранения, Task 10).
- `ServeConfig` дополняется: `Env config.AppEnv`, `DemoMode bool`, `OTPProvider string` (`Provider("IDENTITY_OTP_PROVIDER", ["mock"], ["mock"])`), `OTPHMACKey []byte` (`Secret("IDENTITY_OTP_HMAC_KEY", 32)`), `TokenSigningKey ed25519.PrivateKey` (из `Secret("IDENTITY_TOKEN_SIGNING_KEY", 32)` — seed), `TokenKID string` (`Required`), `TokenPreviousKey *SigningKey` (необязательно, `kid:base64(public)`), `OTPDailyGlobalLimit` (`Int(..., 500, 1, 1_000_000)`), `OTPDailyPrefixLimit` (`50`), `Distinct("IDENTITY_OTP_HMAC_KEY", "IDENTITY_TOKEN_SIGNING_KEY")`.
- Prod-проверки из PROGRESS «В план 2» (M3): вне `dev` DSN Postgres обязан содержать `sslmode=verify-full`, OTLP-эндпоинт — `https://`; иначе ошибка с именем переменной. Реализовать в `pkg/config` как `func (l *Loader) PostgresDSN(key string) string` и `func (l *Loader) OTLPEndpoint(key string) string` и применить к `IDENTITY_APP_DSN`, `IDENTITY_OWNER_DSN`, `OTEL_EXPORTER_OTLP_ENDPOINT`.
- `dev.vars`: dev-значения новых переменных; `IDENTITY_DEMO_MODE=true` для стенда (e2e и smoke зависят от демо-кода); compose передаёт их сервису.
- Перенос тестов «ограничения БД» из `apps/web/src/modules/identity/roles.int.test.ts` (4 шт.) — как `TestDB…` в `store_test.go` на настоящем Postgres.

- [ ] **Step 1: Failing tests:** `TestDBDefaultRoleMustBeGranted`, `TestDBOperatorIsAlone`, `TestDBMeasurerIsAlone`, `TestDBMeasurerCannotBeClient`, `TestAppRoleCanDeleteMarkedTables` (и не может — `users`), `TestProdRequiresVerifyFullDSN`, `TestProdRequiresHTTPSOTLP`, `TestProdRejectsMockOTP`, `TestOTPKeyAndSigningKeyDistinct`.
- [ ] **Step 2:** Run `go test ./services/identity/... ./pkg/config/...` — FAIL.
- [ ] **Step 3:** Миграция, `go tool sqlc generate` (запросы — по мере задач 4–10; здесь только CRUD пользователя), конфиг.
- [ ] **Step 4:** Run — PASS; `npm run v2:config` не меняет `nats.conf`; `go test ./tools/...` (сверка `dev.vars` и `mesh.yaml`) — PASS.
- [ ] **Step 5: Commit** — `feat(identity): схема пользователей, сессий и кодов; строгий конфиг`.

---

### Task 4: identity — `RequestOtp`

**Files:**
- Create: `services/identity/internal/otp.go`, `services/identity/internal/ratelimit.go`, `services/identity/internal/phone.go`, `services/identity/internal/caller.go`, `services/identity/internal/errors.go`, `services/identity/internal/otp_sender.go`, тесты `otp_request_test.go`, `phone_test.go`
- Reference: `apps/web/src/modules/identity/otp.ts`, `phone.ts`, `apps/web/src/platform/rate-limit.ts` — перенести поведение один к одному.

**Interfaces — Produces:**
- `func requireCaller(ctx context.Context, allowed ...string) error` — первая строка каждого обработчика; `Caller` нет или чужой → `PermissionDenied` / `caller_forbidden`.
- `func rpcError(code connect.Code, reason string, params map[string]string) error` — ошибка с `ErrorDetail`.
- `func parsePhone(raw string) (string, bool)` — казахстанский мобильный в E.164 (`+7 7xx …`), правила `phone.ts`.
- `type OtpSender interface { Send(ctx context.Context, phone, code string) error }`; `mockSender` ничего не отправляет и пишет в лог только факт отправки (без кода).
- `type limiter` с `hit(ctx, tx, key string, limit int, window time.Duration) (allowed bool, err error)` — фиксированное окно, атомарно (`INSERT … ON CONFLICT … RETURNING`).
- Код: `crypto/rand`, 6 цифр; хранится `HMAC-SHA256(IDENTITY_OTP_HMAC_KEY, "otp:v1:"+phone+":"+code)`.
- Первое за сутки достижение общего потолка — `OtpGlobalLimitReached` в outbox ровно один раз (счётчик `otp:global:day:alert` с лимитом 1) и `log.Warn`. Уведомление операторам в приложении — после плана 6 (`notify`); до этого — только событие и лог (решение контроллера, см. журнал).
- Порядок в обработчике: `requireCaller` → `idem.Lookup` (повтор — сразу сохранённый ответ) → лимиты отдельными командами вне транзакции (как в `otp.ts`: отказанный запрос тоже засчитывается; отказ по лимиту номера и IP не расходует потолки) → `idem.Do` (код, `Send`, ответ).

- [ ] **Step 1: Failing tests** — Go-аналог каждого `it` из блока `describe("requestOtp")` в `apps/web/src/modules/identity/otp.int.test.ts` (14 тестов, названия — те же по смыслу, например `TestRequestStoresOnlyHMACFor5Min`, `TestNoDemoCodeOutsideDemo`, `TestCooldown60s`, `TestIPHourlyLimit`, `TestUnknownIPUsesPhoneLimits`, `TestPhoneDailyLimit10`, `TestGlobalCeiling`, `TestCeilingDefaults500And50`, `TestCeilingSkipsRegisteredUsers`, `TestGlobalCeilingEventOncePerDay`, `TestPrefixCeiling`, `TestPhoneRefusalDoesNotSpendCeiling`, `TestOnlyLatestCodeValid`, `TestRejectsNonKZMobile`); плюс `TestRequestOtpReplaySameKey` (тот же ключ — тот же `expires_at`, второй код не создан, `Send` вызван один раз) и `TestRequestOtpCallerMustBeWeb`.
- [ ] **Step 2:** Run `go test ./services/identity/...` — FAIL.
- [ ] **Step 3:** Реализовать обработчик `RequestOtp` в порядке выше.
- [ ] **Step 4:** Run — PASS.
- [ ] **Step 5: Commit** — `feat(identity): запрос кода входа с лимитами и потолками`.

---

### Task 5: identity — `VerifyOtp` и создание сессии

**Files:**
- Create: `services/identity/internal/verify.go`, `services/identity/internal/session.go`, тест `otp_verify_test.go`

**Interfaces:**
- Consumes: `requireCaller`, `rpcError`, `limiter`, `idem.Do` (Task 2, 4).
- Produces: `func createSession(ctx context.Context, tx pgx.Tx, user store.User, token string, userAgent string, asRole string, now time.Time) (store.Session, error)` — `token_hash = sha256(token)`, `expires_at = now + 7 дней` (или `8 ч`, если у пользователя роль сотрудника), `active_role = asRole` или `default_role`, `user_agent` обрезается до 300 символов. Используют Task 5 и Task 9.
- Порядок: `requireCaller` → `idem.Lookup` → лимит проверок по номеру и IP и засчёт попытки (вне транзакции, как в `otp.ts`) → `idem.Do` (погасить код, пользователь, сессия, события).
- Попытка засчитывается до сравнения условным `UPDATE … WHERE attempts < 5 AND consumed_at IS NULL`; код гасится условным `UPDATE`; новый телефон → пользователь `CLIENT`, событие `UserRegistered` и `AuditEvent{action: "user.registered"}` в outbox в той же транзакции.

- [ ] **Step 1: Failing tests** — аналог каждого `it` из `describe("verifyOtp")` в `otp.int.test.ts` (11 тестов: новый телефон → заказчик и сессия; существующий входит своей ролью; неверный код — `otp_wrong_code` с `left`; после 5 неверных не принимает верный; 20 проверок в сутки на номер; истёкший; одноразовый; два одновременных ввода → ровно одна сессия; заблокированный не входит). Ответ `VerifyOtp` про профиль исполнителя не знает — тест «статус профиля исполнителя» переносится в web (Task 13). Плюс:
  - `TestVerifyReplayAfterLostResponse` (Review Focus 1): тот же `idempotency_key` и `session_token` → тот же `user.id` и `session.id`, в `sessions` одна строка, ошибки `otp_expired` нет.
  - `TestVerifyKeyReusedWithOtherCode` → `idempotency_key_reused`.
  - `TestStaffSessionLasts8h`: оператор → `expires_at - created_at = 8h`; клиент → `7*24h`.
  - `TestSessionTokenFormat`: 42 и 44 символа, не base64url → `session_token_invalid`.
- [ ] **Step 2:** Run — FAIL. **Step 3:** Реализовать. **Step 4:** Run — PASS.
- [ ] **Step 5: Commit** — `feat(identity): проверка кода и сессия от токена web`.

---

### Task 6: identity — `Authenticate`, выход, роли

**Files:**
- Create: `services/identity/internal/authenticate.go`, `services/identity/internal/roles.go`, тесты `authenticate_test.go`, `roles_test.go`
- Reference: `apps/web/src/modules/identity/session.ts`, `roles.ts`, `roles.int.test.ts`, `session.int.test.ts`

**Interfaces:**
- Consumes: `createSession` (Task 5); `accessToken` — заглушка до Task 7 (`""`), Task 7 подставляет подпись.
- Produces: `func activeRole(granted []string, defaultRole string, sessionRole *string) string` — правило `activeRoleOf` из `roles.ts`; `const idleTimeout = 30 * time.Minute`, `const lastSeenThrottle = time.Minute`.
- `Authenticate`: сессия действительна, если не отозвана, `now < expires_at`, `now < last_seen_at + 30 мин`, пользователь не заблокирован; иначе `Unauthenticated` / `session_invalid` (заблокированный — тоже `session_invalid`: человек видит вход). `last_seen_at` обновляется условным `UPDATE … WHERE last_seen_at < now - 1 мин`. `idle_expires_at = last_seen_at + 30 мин`.
- `SwitchRole`: `SELECT … FOR UPDATE` пользователя, роль должна быть выдана (`role_not_granted`), меняются `sessions.active_role` этой сессии и `users.default_role`; одна запись `RoleSwitched` + аудит; та же роль — без изменений и без события.
- `GrantRole`: только `CLIENT` или `EXECUTOR` себе (`role_forbidden` для ролей сотрудников и для сотрудника), уже выданная — `granted=false` без события; иначе `RoleGranted` + аудит.
- `SignOut` — отзывает эту сессию; `SignOutEverywhere` — все сессии пользователя. Неизвестный или уже отозванный токен — успех (выход идемпотентен).

- [ ] **Step 1: Failing tests** — аналоги `it` из `session.int.test.ts` (`describe("сессия")`, 6 шт.; «lastSeenAt не чаще раза в 10 минут» → раз в минуту) и `roles.int.test.ts` (`describe("активная роль")`, `describe("switchRole")`, `describe("grantRole и becomeClient")` — кроме `becomeClient`, он в web). Плюс:
  - `TestIdleBoundary` (Review Focus 2): `last_seen_at = now - 29m59s` → действительна; `now - 30m` → `session_invalid`.
  - `TestAbsoluteExpiry7dAnd8h`.
  - `TestSwitchOnOtherDeviceKeepsThisSession` и `TestRevokedRoleNotActive` (Review Focus 5).
  - `TestConcurrentSwitchOneEvent`: два `SwitchRole` с разными ключами одновременно → одно событие `RoleSwitched`.
- [ ] **Step 2:** Run — FAIL. **Step 3:** Реализовать. **Step 4:** Run — PASS.
- [ ] **Step 5: Commit** — `feat(identity): проверка сессии, выход, переключение и выдача ролей`.

---

### Task 7: Внутренний токен и ключи подписи

**Files:**
- Create: `services/identity/internal/token.go`, `services/identity/internal/token_test.go`
- Modify: `services/identity/internal/authenticate.go`

**Interfaces — Produces:**
- JWT (compact JWS), заголовок `{"alg":"EdDSA","typ":"JWT","kid":<TokenKID>}`; claims: `iss="senim-identity"`, `aud="senim"`, `sub=<user_id>`, `sid=<session_id>`, `role=<активная роль>`, `roles=[…]`, `mfa=false` (2FA — план 2б), `iat`, `exp = min(now + 5 мин, expires_at сессии)`.
- `func signAccessToken(key ed25519.PrivateKey, kid string, c accessClaims, now time.Time) (string, time.Time, error)` — через `github.com/golang-jwt/jwt/v5` (`SigningMethodEdDSA`; зависимость перевести из `// indirect` в прямую).
- `GetSigningKeys` → текущий ключ и (если задан) `TokenPreviousKey`; только публичные ключи.

- [ ] **Step 1: Failing tests:** `TestAuthenticateIssuesVerifiableToken` (подпись проверяется публичным ключом из `GetSigningKeys`, claims совпадают с сессией); `TestTokenExpiryCappedBySession` (до конца сессии 2 мин → `exp` через 2 мин); `TestSigningKeysOnlyPublic` (в ответе 32 байта на ключ, приватного нет); `TestPreviousKeyListed`; `TestGetSigningKeysAnyServiceCaller` (`deal` — можно; `edge` — `caller_forbidden`).
- [ ] **Step 2:** Run — FAIL. **Step 3:** Реализовать. **Step 4:** Run — PASS.
- [ ] **Step 5: Commit** — `feat(identity): внутренний токен Ed25519 и публикация ключей`.

---

### Task 8: `pkg/rpcclient` и `pkg/authz`

**Files:**
- Create: `pkg/rpcclient/rpcclient.go`, `pkg/rpcclient/rpcclient_test.go`, `pkg/authz/authz.go`, `pkg/authz/keys.go`, `pkg/authz/authz_test.go`

**Interfaces — Produces:**
- `rpcclient.Config{MeshURL, CertFile, KeyFile, CAFile string}`; `func rpcclient.Load(l *config.Loader) Config` (`MESH_URL`, `TLS_*`; вне `dev` — только `https://`); `func rpcclient.New(cfg Config) (connect.HTTPClient, []connect.ClientOption, error)` — mTLS (`tlsx.ClientConfig`), HTTP/2, протокол gRPC, интерсептор: нет дедлайна в `ctx` → 5 с; `traceparent` через OTel-пропагатор.
- `authz.Claims{UserID, SessionID, Role string; Roles []string; MFA bool; ExpiresAt time.Time}`.
- `type authz.KeySource interface { Keys(ctx context.Context) (map[string]ed25519.PublicKey, error) }`; `func authz.IdentityKeys(client identityv1connect.IdentityServiceClient, refresh time.Duration) KeySource` — кэш на `refresh` (10 мин), неизвестный `kid` — внеочередное обновление не чаще раза в 30 с.
- `func authz.NewVerifier(src KeySource) *Verifier`; `func (v *Verifier) Verify(ctx context.Context, token string) (Claims, error)` — проверяет `alg=EdDSA`, `iss`, `aud`, `exp` (допуск часов 30 с), `kid`.
- `func authz.Interceptor(v *Verifier) connect.Interceptor` — заголовок `authorization: Bearer <token>`: есть и верен → `Claims` в контексте; есть и неверен → `Unauthenticated` / `token_invalid`; нет — без `Claims`. `func authz.FromContext(ctx) (Claims, bool)`. Решение о правах — в обработчике (CLAUDE.md), интерсептор только удостоверяет.

- [ ] **Step 1: Failing tests:** `TestDefaultDeadline5s`, `TestNonDevRequiresHTTPS`, `TestClientPresentsCert` (сервер `tlsx.ServerConfig` видит имя клиента); `TestVerifyAcceptsIdentityToken` (токен из Task 7 через тестовый `KeySource`), `TestRejectsWrongAlg` (`none`, `HS256`), `TestRejectsExpired`, `TestRejectsWrongAudience`, `TestUnknownKidRefreshesOnce`, `TestInterceptorMissingVsInvalid`.
- [ ] **Step 2:** Run `go test ./pkg/rpcclient/... ./pkg/authz/...` — FAIL. **Step 3:** Реализовать. **Step 4:** Run — PASS.
- [ ] **Step 5: Commit** — `feat(pkg): клиент mesh и проверка внутреннего токена`.

---

### Task 9: identity — демо и сид

**Files:**
- Create: `services/identity/internal/demo.go`, тест `demo_test.go`
- Reference: `apps/web/src/modules/identity/demo.ts`, `demo.int.test.ts`

**Interfaces — Produces:**
- Все три метода при `DemoMode=false` → `FailedPrecondition` / `demo_disabled`.
- `SeedUsers`: upsert по `phone` (существующий — обновить роли, `default_role`, `is_demo`, `created_at`, снять блокировку); ответ — пользователи в порядке запроса, `id` стабилен между запусками.
- `StartDemoSession`: пользователь с `is_demo` и без блокировки, иначе `NotFound` / `user_not_found`; `as_role` должна быть выдана (`role_not_granted`); сессия — `createSession` (Task 5).
- `ResetDemo`: удаляет все `otp_codes`, `rate_limits` и `sessions` (стенд с `DEMO_MODE` — только тестовые данные); пользователей не трогает.

- [ ] **Step 1: Failing tests** — аналоги `demo.int.test.ts` про вход (6 шт.: вход ставит сессию; вход в указанной роли; невыданная роль — сессии нет; не-демо недоступен по id; заблокированная персона недоступна; при `DEMO_MODE=false` вход невозможен). Список персон остаётся в web (Task 13). Плюс `TestSeedUsersIdempotentByPhone` (два запуска — те же `id`), `TestSeedRespectsStaffCheck` (оператор с `CLIENT` — ошибка), `TestResetDemoClearsLimits` (после сброса `RequestOtp` на номер с исчерпанным лимитом проходит).
- [ ] **Step 2:** Run — FAIL. **Step 3:** Реализовать. **Step 4:** Run — PASS.
- [ ] **Step 5: Commit** — `feat(identity): демо-персоны, сид и сброс стенда`.

---

### Task 10: identity — сроки хранения

**Files:**
- Create: `services/identity/internal/retention.go`, тест `retention_test.go`
- Modify: `services/identity/internal/config.go`, `run.go`

**Interfaces — Produces:**
- Конфиг (спека §5: «значения в конфиге с безопасными умолчаниями» до политики ПДн): `IDENTITY_RETAIN_OTP` = `24h`, `IDENTITY_RETAIN_SESSIONS` = `720h` (после окончания или отзыва), `IDENTITY_RETAIN_RATE_LIMITS` = `48h`, `IDENTITY_RETAIN_IDEMPOTENCY` = `48h`, `IDENTITY_RETAIN_OUTBOX` = `168h` (только опубликованные); `IDENTITY_RETENTION_EVERY` = `1h`. Добавить `func (l *Loader) Duration(key string, def, lo, hi time.Duration) time.Duration` в `pkg/config`.
- `func runRetention(ctx context.Context, pool *pgxpool.Pool, cfg RetentionConfig, now time.Time) (RetentionResult, error)` — удаляет пачками по 1000 в отдельных транзакциях; запуск из `Serve` по тикеру под `pg_try_advisory_lock` (две реплики не чистят одновременно); итог — в лог и метрику `senim.retention.deleted{table}`.
- `outbox`: для удаления опубликованных строк добавить маркер `senim:app-delete outbox` в `outbox.Schema` (Task 2 даёт механизм).

- [ ] **Step 1: Failing tests:** `TestRetentionDeletesOnlyOld` (по каждой таблице: старше срока — удалено, моложе — на месте; неопубликованный outbox не тронут), `TestRetentionKeepsActiveSessions`, `TestRetentionSingleReplica` (два запуска одновременно — один чистит), `TestDurationConfigBounds`.
- [ ] **Step 2:** Run — FAIL. **Step 3:** Реализовать. **Step 4:** Run — PASS.
- [ ] **Step 5: Commit** — `feat(identity): сроки хранения кодов, сессий, лимитов и outbox`.

---

### Task 11: identity — сборка сервиса и путь через mesh

**Files:**
- Modify: `services/identity/internal/run.go` (регистрация `identityv1connect.NewIdentityServiceHandler`, `OtpSender` по конфигу, тикер сроков хранения), `services/identity/main_test.go`, `test/smoke/smoke_test.go`, `deploy/compose/compose.yaml`
- Create: `test/smoke/identity_test.go`

**Interfaces:**
- Consumes: всё из Task 3–10; `rpcclient`, `authz` (Task 8).
- Produces: живой `IdentityService` за mesh; таблица «метод → кто может звать» (`web` для всех, кроме `GetSigningKeys`) — в комментарии `run.go` и в тесте.

- [ ] **Step 1: Failing tests:** в `main_test.go` — `TestServeRegistersIdentityService` (вызов `GetSigningKeys` своей репликой по mTLS отвечает); в `test/smoke/identity_test.go` (тег `smoke`, клиент — сертификат `web`, через `mesh:9443`): `TestLoginThroughMesh` — `RequestOtp` → `demo_code` → `VerifyOtp` (свой `session_token`) → `Authenticate` → `authz.Verifier` с `IdentityKeys` проверяет `access_token` (сертификат `identity` для чтения ключей); `TestEdgeCannotCallIdentity` — сертификат `edge` отвергнут mesh; `TestAuthenticateLoadBalanced` — 20 вызовов `Authenticate` распределены по двум репликам (заголовок экземпляра).
- [ ] **Step 2:** Run `go test ./services/identity/...` — FAIL; затем `npm run v2:certs && npm run v2:up && npm run v2:smoke` — FAIL (методов нет).
- [ ] **Step 3:** Собрать `Serve`.
- [ ] **Step 4:** Run оба — PASS; `docker stats --no-stream` — identity в простое ≤ 64 МБ на реплику (записать число в отчёт).
- [ ] **Step 5: Commit** — `feat(identity): сервис за mesh, дымовой тест входа`.

---

### Task 12: web — клиент identity и проекция пользователя

**Files:**
- Create: `apps/web/src/modules/identity/remote.ts` (клиент и интерфейс), `apps/web/src/modules/identity/remote-errors.ts`, `apps/web/src/modules/identity/projection.ts`, `apps/web/test/stubs/identity.ts` (подделка), тесты `remote-errors.test.ts`, `projection.int.test.ts`, `session.int.test.ts` (переписать)
- Modify: `apps/web/src/modules/identity/session.ts`, `apps/web/test/setup-integration.ts`, `apps/web/src/platform/env.ts` (`V2_ENABLED` обязателен вне тестов)

**Interfaces — Produces:**
- `type IdentityClient` — тип клиента `IdentityService` из `@connectrpc/connect` (`Client<typeof IdentityService>`); `function identity(): IdentityClient` — по `meshTransport()`; `function setIdentityForTests(c: IdentityClient | null): void`. Подделка `test/stubs/identity.ts` хранит пользователей и сессии в памяти, `id` = `u-<phone без +>`; подключается в `setup-integration.ts` для всех интеграционных тестов web.
- `function identityFailure(err: unknown): never` — `ErrorDetail.code` → `fail.*` с текстом из `ru.identity`; таблица кодов исчерпывающая (тест перебирает все коды из Task 1). `UNAVAILABLE` / `DEADLINE_EXCEEDED` → `fail.unavailable(ru.common.errors.serviceUnavailable)` (добавить текст «Сервис временно недоступен. Попробуйте через минуту»).
- `async function projectUser(user: User): Promise<void>` — по `id`: нет строки — `create` (`phone`, `role`, `roles`, `isDemo`, `blockedAt`); есть — `update` только изменившихся полей. Строка с тем же `phone`, но другим `id` → `logger.error("identity.projection.phone_conflict", { userId })` и `fail.conflict` (Review Focus 4).
- `roleFromProto(r: Role): PrismaRole` и `roleToProto(r: PrismaRole): Role` — `ROLE_UNSPECIFIED` → ошибка; тест — все четыре роли туда и обратно.
- `sessionCookieName(): string` — `__Host-senim_session` при `APP_ENV !== "dev"`, иначе `senim_session`; `newSessionToken(): string` — 32 байта `crypto.randomBytes`, base64url без `=`.
- `getCurrentUser` (сигнатура и тип `CurrentUser` прежние): `Authenticate` по cookie → `projectUser` → из старой базы `fullName`, `iinLast4`, профиль исполнителя → `CurrentUser`. `session_invalid` → `null` (cookie удаляется в Server Action / route handler, на странице — просто гость). `UNAVAILABLE` → ошибка «сервис недоступен», cookie **не** удаляется (Review Focus 3). Один вызов на HTTP-запрос (`cache`). Новая функция `getAccessToken(): Promise<string | null>` (server-only) — для вызовов сервисов в плане 3.

- [ ] **Step 1: Failing tests:** `remote-errors.test.ts` — каждый код → ожидаемый `AppError.code` и текст `ru`, `otp_wrong_code` с `left=3` → «Осталось попыток: 3»; `projection.int.test.ts` — создание, обновление ролей, конфликт телефона (лог и CONFLICT); `session.int.test.ts` (переписать на подделку): без cookie — `null`; `session_invalid` — `null`; `UNAVAILABLE` — ошибка, cookie на месте; `requireUserPage` — три сценария из старого файла без изменений.
- [ ] **Step 2:** Run `npm --prefix apps/web test -- src/modules/identity` (с `DATABASE_URL` тестовой базы) — FAIL.
- [ ] **Step 3:** Реализовать.
- [ ] **Step 4:** Run — PASS; `npm --prefix apps/web run typecheck && npm --prefix apps/web run lint` — без ошибок.
- [ ] **Step 5: Commit** — `feat(web): сессия через identity и проекция пользователя в старой базе`.

---

### Task 13: web — вход, выход, роли и демо через identity

**Files:**
- Modify: `apps/web/src/modules/identity/otp.ts`, `session.ts`, `demo.ts`, `registration.ts`, `index.ts`; `apps/web/src/app/login/actions.ts`, `apps/web/src/app/_components/auth/actions.ts`, `apps/web/src/app/register/executor/actions.ts`, `apps/web/src/app/demo/actions.ts`
- Delete: старые реализации на Prisma (`startSession`, `revokeAllSessions`, работа с `db.session` и `db.otpCode`, лимиты кода в `otp.ts`)
- Test: `otp.int.test.ts`, `roles.int.test.ts`, `demo.int.test.ts`, `registration.int.test.ts` — переписать на подделку; поведение, перенесённое в Go, здесь не дублировать.

**Interfaces:**
- Consumes: `identity()`, `identityFailure`, `projectUser`, `sessionCookieName`, `newSessionToken` (Task 12).
- Produces (публичный API модуля не меняется по именам): `requestOtp({phone, ip})` → `RequestOtp`; `verifyOtp({phone, code, ip, userAgent})` → отзывает прежнюю сессию браузера (`SignOut`, ошибку игнорировать), `VerifyOtp` с новым токеном и `idempotency_key = randomUUID()`; при `UNAVAILABLE` или `DEADLINE_EXCEEDED` — один повтор с **тем же** ключом и токеном (Review Focus 1), затем `projectUser`, cookie (`expires` = `session.expires_at`); возвращает `OtpVerified` как раньше (статус профиля исполнителя — из старой базы). `endSession`, `signOutEverywhere` → `SignOut`/`SignOutEverywhere`, cookie удаляется всегда. `switchRole(user, role)` → `SwitchRole` + `projectUser`. `becomeClient` → `GrantRole(CLIENT)` + `SwitchRole(CLIENT)`. `loginAsDemoPersona` → `StartDemoSession`. `listDemoPersonas` — без изменений (читает проекцию).
- `registerExecutor`: сначала `GrantRole(EXECUTOR, idempotency_key = "executor-registration:" + user.id)` (повтор безопасен), затем транзакция старой базы без `grantRole`; роль без профиля — человек видит экран регистрации (решение контроллера: обратный порядок оставил бы профиль без роли без способа повторить).
- Аудит `user.registered`, `user.role_switched`, `user.role_granted` больше не пишется в старую таблицу `AuditEvent` — он в outbox `identity` (журнал оператора покажет его после плана 6).

- [ ] **Step 1: Failing tests:** `otp.int.test.ts` — «обрыв после `VerifyOtp`: повтор с тем же ключом и токеном, вход один» (подделка отвечает `UNAVAILABLE` на первый вызов, уже создав сессию), «исполнителю возвращает статус профиля», «новый вход отзывает прежнюю сессию браузера», «cookie ставится с `expires` сессии», демо-код показывается только когда его вернул `identity`; `roles.int.test.ts` — `becomeClient` (2 теста старого файла), «после `switchRole` проекция в новой роли»; `registration.int.test.ts` — «сбой транзакции после выдачи роли: повтор регистрации проходит, роль выдана один раз»; `demo.int.test.ts` — список персон (2 теста старого файла).
- [ ] **Step 2:** Run — FAIL. **Step 3:** Реализовать, удалить старый код. **Step 4:** Run `npm --prefix apps/web run check` (с `DATABASE_URL` тестовой базы) — всё зелёное.
- [ ] **Step 5: Commit** — `feat(web): вход, выход, роли и демо через identity`.

---

### Task 14: web — сид, «Сбросить демо» и e2e против стенда v2

**Files:**
- Modify: `apps/web/src/demo/seed.ts` (`resetDemo` → `ResetDemo`, пользователи → `SeedUsers`, их `id` — в проекцию и дальше в сид), `apps/web/src/demo/seed.int.test.ts`, `apps/web/playwright.config.ts`, `apps/web/e2e/global-setup.ts`, `README.md`, `apps/web/CLAUDE.md` не трогать (subtree)
- Create: `apps/web/e2e/v2.vars.example` (переменные web для e2e: `V2_ENABLED=true`, `MESH_URL=https://localhost:9443`, `MESH_TLS_CERT_FILE` / `KEY` / `CA` → `deploy/compose/certs/web/*`)

**Interfaces:**
- Consumes: `identity()` (Task 12), `SeedUsers`, `ResetDemo` (Task 9).
- Produces: `npm run test:e2e` требует запущенного `npm run v2:up` (профиль core): `global-setup` первым делом вызывает `GetSigningKeys` и при отказе падает с подсказкой «запустите npm run v2:up». Сид без доступа к `identity` падает с той же подсказкой.

- [ ] **Step 1: Failing tests:** `seed.int.test.ts` — сид на подделке: каждый пользователь сида получен из `SeedUsers`, `id` в старой базе совпадают; повторный сид даёт те же `id`; `resetDemo` зовёт `ResetDemo` ровно один раз.
- [ ] **Step 2:** Run — FAIL. **Step 3:** Реализовать. **Step 4:** Run `npm --prefix apps/web run check` — PASS.
- [ ] **Step 5:** `npm run v2:up`, затем e2e (порт 3110, база `senim_v2web_e2e`) — Expected: 147 сценариев, упавших 0 (пропущенные — те же 3).
- [ ] **Step 6: Commit** — `feat(web): сид и сброс демо через identity, e2e против стенда v2`.

---

### Task 15: Финальная проверка, ADR и отчёт

**Files:**
- Create: `docs/adr/013-identity-login-and-user-projection.md`
- Modify: `docs/PROGRESS.md`, `CLAUDE.md` (строка про `identity` в архитектуре, если изменилась)

- [ ] **Step 1:** ADR-013: токен сессии генерирует web (почему: идемпотентный `VerifyOtp` без хранения секрета в ответе); проекция `User` в старой базе (тот же `id`, обновление из ответов `identity`, конфликт телефона — ошибка); порядок «роль, потом профиль» в регистрации исполнителя; что вынесено в план 2б и план 6; цена ошибки каждого решения.
- [ ] **Step 2:** Run `go vet ./... && go tool golangci-lint run ./... && go tool buf lint && go test ./... && go tool govulncheck ./...` — 0 ошибок; `npm --prefix apps/web run check` — зелёный; `npm run v2:smoke` — PASS; e2e — 147/0 упавших.
- [ ] **Step 3:** `npm run v2:up:full`, войти через web; в Grafana — трасса со спанами mesh и `identity` (RPC `Authenticate`; спана web нет — у web пока нет OTel, это известно) и метрика `rpc.server.duration` для `identity`. Снимок — `docs/progress/plan-02-grafana.png`; закрывает пункт «В план 2» про спан RPC.
- [ ] **Step 4:** `docs/PROGRESS.md`: раздел «План 2», что сделано, чем проверено, решения контроллера, отложенное, «Ждёт владельца»; пункты «В план 2» отметить сделанными или перенести с причиной.
- [ ] **Step 5: Commit** — `docs: итоги плана 2, ADR-013`; пуш; прогон CI — зелёный.
