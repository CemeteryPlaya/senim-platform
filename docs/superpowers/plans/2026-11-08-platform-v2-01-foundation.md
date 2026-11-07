# «Сенім» v2 — план 1: фундамент. Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Новый репозиторий `D:\senim-platform`, в котором одной командой поднимается вся инфраструктура v2, а запрос из браузера проходит edge-Envoy → web (Next.js) → mesh-Envoy (gRPC, mTLS, балансировка по запросам) → Go-сервис `identity` (пока только health) — с трейсами, проверками безопасности конфига и ролей БД, outbox/inbox и CI.

**Architecture:** Один Go-модуль в корне (`pkg/` — инфраструктурные пакеты, `services/<имя>` — сервисы, `gen/go` — сгенерированный код), `apps/web` — текущий Next.js, импортированный с историей через `git subtree`. Контракты — protobuf в `proto/`, генерация `buf` для Go (connect-go v2) и TypeScript (protoc-gen-es v2). Локально — docker compose с профилями `core` и `full`.

**Tech Stack:** Go ≥ 1.25 (актуальная стабильная), `connectrpc.com/connect/v2` + `connecthttp` + `grpchealth`, `pgx/v5`, `sqlc`, `goose`, `nats.go` (JetStream), `testcontainers-go`, `log/slog`, OpenTelemetry Go SDK; `buf`; `@connectrpc/connect` + `@connectrpc/connect-node` + `@bufbuild/protobuf` v2 в `apps/web`; Envoy; PostgreSQL 17; NATS 2.x; MinIO; `grafana/otel-lgtm`; ClamAV.

**Spec:** `docs/superpowers/specs/2026-11-08-platform-v2-architecture-design.md` (утверждён 08.11.2026). Это **план 1 из серии**; следующие планы пишутся после завершения предыдущего: 2 — identity (вход, сессии, токен, ПДн, 2FA, согласия) и переключение `web`; 3 — deal (ядро, деньги, споры, `mock`/`manual`); 4 — documents + files; 5 — marketplace; 6 — notify (Telegram Gateway), operator, audit; 7 — Kubernetes, стенд, удаление перенесённых модулей, e2e. Фронтенд — отдельный документ и план.

## Global Constraints

- Инварианты и Definition of Done из `CLAUDE.md` текущего репозитория переносятся в `CLAUDE.md` v2 без изменений по смыслу (деньги в тиынах, таблица переходов, аудит в той же транзакции, конкурентные переходы условным `UPDATE` или `FOR UPDATE`, тексты только в `ru.ts`, никаких `console.log`/`fmt.Println` в рабочем коде).
- Сервисы возвращают коды ошибок, не тексты: деталь ошибки — `senim.common.v1.ErrorDetail`.
- Ни одного вызова без дедлайна; дедлайн по умолчанию в `web` — 5 с.
- Агент не делает `git push`, не создаёт удалённые репозитории и не регистрирует внешние сервисы.
- Хуки запрещают любые пути и команды, содержащие `.env`: файлы переменных называются `*.vars`.
- Порты хоста: edge `8180`, Postgres v2 `5452`, NATS `4222`, MinIO `9100`/`9101`, Grafana `3300`. Не занимать `3000`, `3100`, `5440`, `5442`.
- Бюджет памяти: профиль `core` ≤ 3 ГБ, `full` ≤ 6 ГБ, Go-сервис в простое ≤ 64 МБ.
- Все файлы с LF (`.gitattributes`: `* text=auto eol=lf`), иначе скрипты в контейнерах ломаются на Windows.
- Commit messages — Conventional Commits, тело «почему / что / как проверено», последняя строка `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.

## Review Focus

1. `APP_ENV=prod` со слабым, пустым или повторяющимся секретом, моком или `DEMO_MODE` → сервис **не стартует** и называет переменную (тест в Task 2).
2. Клиент без сертификата нашего CA или с сертификатом чужого CA → соединение отклонено до вызова метода (тест в Task 5).
3. Повторная доставка события и падение релея между публикацией и отметкой «опубликовано» → обработчик выполняется ровно один раз (тесты в Task 8).
4. Роль `<svc>_app` пытается `TRUNCATE`, `DROP TRIGGER`, `ALTER TABLE` или читает базу другого сервиса → отказ прав (тест в Task 7).
5. `SIGTERM` во время выполняющегося вызова → вызов завершается, новые не принимаются, процесс выходит за ≤ 20 с; ИИН, IBAN и телефон в логах — замаскированы (тесты в Task 3 и Task 6).

---

### Task 0: Инструменты на машине

**Files:** нет (окружение).

- [ ] **Step 1: Спросить владельца разрешения** и установить Go: `winget install --id GoLang.Go -e`. Остальные инструменты (`buf`, `sqlc`, `goose`, `golangci-lint`, `protoc-gen-go`, `protoc-gen-connect-go`, `govulncheck`) — как `tool`-зависимости в `go.mod` (Task 1), отдельная установка не нужна.
- [ ] **Step 2: Запустить Docker Desktop** (помнить про баг bind-mount из памяти проекта: при `mkdir /run/desktop/mnt/host/d: file exists` — перезапуск Docker Desktop).
- [ ] **Step 3: Проверить**

Run: `go version; docker version --format '{{.Server.Version}}'`
Expected: `go1.25` или новее; версия сервера Docker без ошибки.

---

### Task 1: Репозиторий, импорт web, правила

**Files:**
- Create: `D:\senim-platform\` — `go.mod`, `.gitattributes`, `.gitignore`, `package.json` (только скрипты), `CLAUDE.md`, `README.md`, `docs/` (копия спеки, этого плана, `docs/legal/*`), `docs/adr/010-microservices-grpc.md`
- Create (subtree): `apps/web/**` — история `mvp-scale-arna@main`

- [ ] **Step 1:** `git init D:\senim-platform`, первый коммит с `.gitattributes` (`* text=auto eol=lf`, `*.png binary`, `*.jpg binary`, `*.pdf binary`, `*.ttf binary`) и `.gitignore` (`node_modules/`, `.next*/`, `/bin/`, `/tmp/`, `*.vars.local`, `deploy/compose/certs/`).
- [ ] **Step 2:** `git subtree add --prefix=apps/web D:/mvp-scale-arna main` (без `--squash` — история нужна для `subtree pull`).
- [ ] **Step 3:** `go.mod`: модуль `github.com/CemeteryPlaya/senim-platform`, `go 1.25`, блок `tool` с `github.com/bufbuild/buf/cmd/buf`, `github.com/sqlc-dev/sqlc/cmd/sqlc`, `github.com/pressly/goose/v3/cmd/goose`, `github.com/golangci/golangci-lint/v2/cmd/golangci-lint`, `google.golang.org/protobuf/cmd/protoc-gen-go`, генератор connect-go v2 (`connectrpc.com/connect/v2/cmd/protoc-gen-connect-go` — сверить путь по документации v2), `golang.org/x/vuln/cmd/govulncheck`.
- [ ] **Step 4:** Корневой `package.json` без workspaces (у `apps/web` свои `node_modules`), скрипты: `"web": "npm --prefix apps/web"`, `"v2:certs": "go run ./tools/devcerts -out deploy/compose/certs"`, `"v2:gen": "go tool buf generate"`, `"v2:up": "docker compose -f deploy/compose/compose.yaml --profile core up -d --wait"`, `"v2:up:full": "… --profile core --profile full up -d --wait"`, `"v2:down": "docker compose -f deploy/compose/compose.yaml --profile core --profile full down"`, `"v2:test": "go test -race ./..."`, `"v2:lint": "go tool golangci-lint run ./... && go tool buf lint"`, `"v2:smoke": "go test -tags smoke ./test/smoke/..."`.
- [ ] **Step 5:** `CLAUDE.md` v2: перенести инварианты и Definition of Done из `apps/web/CLAUDE.md`, добавить: архитектура из спеки (раздел 4), правило «сервис-владелец сам проверяет права», «изменяющий метод принимает `idempotency_key`», «событие пишется в outbox в той же транзакции», порты и бюджет памяти из Global Constraints, правило `*.vars`. `README.md`: требования (Go, Docker), команды из Step 4. `docs/adr/010-microservices-grpc.md`: решение, ссылки на спеку, последствия (раздел 12 спеки).
- [ ] **Step 6: Проверить, что web не сломан импортом**

Run: `npm --prefix apps/web ci && npm --prefix apps/web run typecheck && npm --prefix apps/web run lint`
Expected: без ошибок. `git -C D:/senim-platform log --oneline -- apps/web | wc -l` > 100 (история на месте).

- [ ] **Step 7: Commit** — `chore: репозиторий v2, web с историей, правила и ADR-010`.

---

### Task 2: `pkg/config` — строгая проверка конфигурации

**Files:**
- Create: `pkg/config/config.go`, `pkg/config/secrets.go`
- Test: `pkg/config/config_test.go`

**Interfaces:**
- Produces:
  - `type AppEnv string` с константами `Dev = "dev"`, `Staging = "staging"`, `Prod = "prod"`
  - `type Source func(key string) (string, bool)` (в проде — `os.LookupEnv`)
  - `type Loader struct{…}`; `func NewLoader(src Source) *Loader`
  - `func (l *Loader) Env() AppEnv` (обязательна `APP_ENV`; неизвестное значение — ошибка)
  - `func (l *Loader) String(key, def string) string`, `func (l *Loader) Required(key string) string`
  - `func (l *Loader) Secret(key string, minBytes int) []byte` — значение base64 (std) или сырые байты для dev; в `prod`/`staging` длина после декодирования ≥ `minBytes`
  - `func (l *Loader) Provider(key string, allowed []string, mocks []string) string` — в `prod` значения из `mocks` запрещены
  - `func (l *Loader) Distinct(keys ...string)` — секреты по этим ключам попарно различны
  - `func (l *Loader) Err() error` — все накопленные ошибки разом (`errors.Join`), каждая называет переменную, **не** значение
  - Правило `DEMO_MODE=true` при `APP_ENV=prod` — ошибка (проверяется в `Env()`).

- [ ] **Step 1: Write the failing tests** (`config_test.go`, табличные):
  - `TestProdRejectsShortSecret`: `APP_ENV=prod`, `PII_HASH_KEY` = 16 байт, `Secret("PII_HASH_KEY", 32)` → `Err()` содержит `PII_HASH_KEY` и не содержит само значение.
  - `TestProdRejectsDuplicateKeys`: два ключа с одинаковым значением 32 байта, `Distinct` → ошибка с обоими именами.
  - `TestProdRejectsMockProvider`: `PAYMENT_PROVIDER=mock`, `Provider(..., []string{"mock","manual"}, []string{"mock"})` → ошибка.
  - `TestProdRejectsDemoMode`: `APP_ENV=prod`, `DEMO_MODE=true` → ошибка.
  - `TestMissingAppEnv`: нет `APP_ENV` → ошибка `APP_ENV`.
  - `TestDevAllowsShortSecrets`: `APP_ENV=dev`, короткий секрет → `Err() == nil`.
  - `TestErrorsAccumulate`: три нарушения → `Err()` перечисляет все три.
- [ ] **Step 2:** Run `go test ./pkg/config/...` — Expected: FAIL (`undefined: NewLoader`).
- [ ] **Step 3:** Реализовать интерфейсы выше.
- [ ] **Step 4:** Run `go test ./pkg/config/...` — Expected: PASS.
- [ ] **Step 5: Commit** — `feat(pkg/config): строгая проверка конфигурации и запреты для prod`.

---

### Task 3: `pkg/logging` — JSON-логи с маской ПДн

**Files:**
- Create: `pkg/logging/logging.go`, `pkg/logging/redact.go`
- Test: `pkg/logging/redact_test.go`
- Reference: `apps/web/src/platform/logger.ts` — перенести список скрываемых ключей и шаблонов значений **один к одному**, затем дополнить ключами из ревью: `email`, `instagram`, `lat`, `lng`, `ip`.

**Interfaces:**
- Produces: `func New(w io.Writer, service string, level slog.Level) *slog.Logger` (JSON, поля `service`, `trace_id`/`span_id` из контекста, если есть); `func Redact(v string) string`.

- [ ] **Step 1: Write the failing tests:**
  - `TestRedactsSensitiveKeys`: `logger.Info("x", "iin", "900101300123", "email", "a@b.kz", "lat", 43.2)` → в выводе нет `900101300123`, `a@b.kz`, `43.2`; есть `"[redacted]"`.
  - `TestRedactsPatternsInMessage`: сообщение с `KZ86125KZT5004100100`, `+77011234567`, `900101300123` → все три замаскированы.
  - `TestNestedGroupRedacted`: `slog.Group("user", "phone", "+77011234567")` → замаскировано.
  - `TestKeepsOrdinaryFields`: `"deal_id", "d_123"` остаётся как есть.
- [ ] **Step 2:** Run `go test ./pkg/logging/...` — FAIL.
- [ ] **Step 3:** Реализовать через `slog.HandlerOptions.ReplaceAttr` (ключи) + обёртку handler-а для текста сообщения (шаблоны).
- [ ] **Step 4:** Run — PASS.
- [ ] **Step 5: Commit** — `feat(pkg/logging): JSON-логи slog с маской ПДн`.

---

### Task 4: Контракты и генерация

**Files:**
- Create: `buf.yaml` (v2, `modules: [{path: proto}]`, lint `STANDARD`, breaking `FILE`), `buf.gen.yaml`, `proto/senim/common/v1/error.proto`, `apps/web/src/gen/.gitkeep`
- Generated: `gen/go/senim/common/v1/*.go`, `apps/web/src/gen/senim/common/v1/*_pb.ts`

**Interfaces:**
- Produces: `senim.common.v1.ErrorDetail { string code = 1; map<string, string> params = 2; }` — единственный способ передать причину ошибки клиенту. Коды — `snake_case`, перечень растёт в следующих планах.
- `buf.gen.yaml` (v2): плагины `local: ["go","tool","protoc-gen-go"]` → `gen/go` (`paths=source_relative`); connect-go v2 → `gen/go` (`paths=source_relative`); `local: apps/web/node_modules/.bin/protoc-gen-es` → `apps/web/src/gen` (`target=ts`, `include_imports: true`).

- [ ] **Step 1:** В `apps/web`: `npm i @connectrpc/connect @connectrpc/connect-node @bufbuild/protobuf` и `npm i -D @bufbuild/protoc-gen-es` (v2).
- [ ] **Step 2:** Написать `error.proto` и конфиги.
- [ ] **Step 3: Проверить**

Run: `go tool buf lint && go tool buf generate && go build ./gen/... && npm --prefix apps/web run typecheck`
Expected: без ошибок; файлы `gen/go/senim/common/v1/error.pb.go` и `apps/web/src/gen/senim/common/v1/error_pb.ts` существуют.

- [ ] **Step 4: Commit** — `feat(proto): buf, генерация Go и TS, ErrorDetail` (сгенерированный код коммитится).

---

### Task 5: `pkg/tlsx` и `tools/devcerts` — mTLS

**Files:**
- Create: `pkg/tlsx/tlsx.go`, `tools/devcerts/main.go`
- Test: `pkg/tlsx/tlsx_test.go`

**Interfaces:**
- Produces:
  - `func NewCA(commonName string, validFor time.Duration) (certPEM, keyPEM []byte, err error)` — ECDSA P-256
  - `func Issue(caCertPEM, caKeyPEM []byte, name string, dnsNames []string, validFor time.Duration) (certPEM, keyPEM []byte, err error)` — сертификат и для сервера, и для клиента (`ExtKeyUsageServerAuth` + `ClientAuth`), CN = имя сервиса
  - `func ServerConfig(certFile, keyFile, caFile string) (*tls.Config, error)` — TLS 1.3, `ClientAuth: RequireAndVerifyClientCert`, `NextProtos: ["h2"]`
  - `func ClientConfig(certFile, keyFile, caFile string) (*tls.Config, error)`
  - `tools/devcerts -out <dir>`: создаёт `ca.pem`, `ca-key.pem` и пары для `edge`, `mesh`, `web`, `identity`, `deal`, `marketplace`, `documents`, `files`, `notify`, `operator`, `audit` (DNS: имя сервиса и `localhost`); срок 1 год; повторный запуск не перезаписывает существующий CA.

- [ ] **Step 1: Write the failing tests:**
  - `TestMutualTLSAccepts`: сервер на `ServerConfig`, клиент на `ClientConfig` того же CA → рукопожатие успешно, сервер видит CN клиента `web`.
  - `TestRejectsClientWithoutCert`: клиент без сертификата → ошибка рукопожатия.
  - `TestRejectsForeignCA`: клиент с сертификатом другого CA → ошибка рукопожатия.
- [ ] **Step 2:** Run `go test ./pkg/tlsx/...` — FAIL.
- [ ] **Step 3:** Реализовать.
- [ ] **Step 4:** Run — PASS; `go run ./tools/devcerts -out tmp/certs` создаёт 24 файла.
- [ ] **Step 5: Commit** — `feat(pkg/tlsx): mTLS и генератор dev-сертификатов`.

---

### Task 6: `pkg/server` — каркас gRPC-сервиса

**Files:**
- Create: `pkg/server/server.go`, `pkg/server/telemetry.go`
- Test: `pkg/server/server_test.go`

**Interfaces:**
- Consumes: `pkg/config.Loader`, `pkg/logging.New`, `pkg/tlsx.ServerConfig`.
- Produces:
  - `type Options struct { Name string; GRPCAddr string /* ":8443" */; ProbeAddr string /* ":8081" */; CertFile, KeyFile, CAFile string; ShutdownTimeout time.Duration /* 20s */; Logger *slog.Logger }`
  - `func Run(ctx context.Context, opt Options, register func(s *connect.Server) error, ready func(context.Context) error) error`
    - `connect.NewServer(...)` с интерсепторами: восстановление после паники → `CodeInternal` без деталей; логирование метода, кода и длительности; OpenTelemetry (трейсы и метрики RED; `otelconnect` для v2, если доступен, иначе свой интерсептор на OTel SDK).
    - `grpchealth.Register(server, checker)`; статус `SERVING` после того, как `ready` вернул nil; `NOT_SERVING` при остановке.
    - Ответный заголовок `x-senim-instance: <hostname>` (для проверки балансировки).
    - gRPC-порт: TLS из `tlsx.ServerConfig`, только HTTP/2. Порт проверок: HTTP без TLS, `/healthz` (процесс жив) и `/readyz` (вызывает `ready`).
    - `SIGTERM`/отмена `ctx`: `NOT_SERVING` → `http.Server.Shutdown` с `ShutdownTimeout`.
  - `func InitTelemetry(ctx context.Context, service string, endpoint string) (shutdown func(context.Context) error, err error)` — пустой `endpoint` → no-op.

- [ ] **Step 1: Write the failing tests** (сервер в процессе, сертификаты из `tlsx` во временной папке):
  - `TestHealthServingAfterReady`: gRPC-клиент connect-go (`connect.WithGRPC()`, HTTP/2 + mTLS) → `grpc.health.v1.Health/Check` = `SERVING`.
  - `TestNotServingUntilReady`: `ready` возвращает ошибку → `/readyz` = 503, health = `NOT_SERVING`.
  - `TestGracefulShutdown`: зарегистрировать тестовый обработчик, который спит 2 с; начать вызов, отменить `ctx` → вызов завершается успешно; новый вызов после отмены → ошибка соединения; `Run` возвращается < 20 с.
  - `TestPanicBecomesInternal`: обработчик паникует → код `internal`, в теле нет текста паники.
  - `TestInstanceHeader`: ответ содержит `x-senim-instance`.
  - Для тестового обработчика — `proto/senim/testing/v1/echo.proto` (`EchoService.Echo`), генерируется вместе с остальными, используется только в тестах.
- [ ] **Step 2:** Run `go test ./pkg/server/...` — FAIL.
- [ ] **Step 3:** Реализовать.
- [ ] **Step 4:** Run `go test -race ./pkg/server/...` — PASS.
- [ ] **Step 5: Commit** — `feat(pkg/server): каркас connect-go v2 с mTLS, health, трейсами и плавной остановкой`.

---

### Task 7: `pkg/dbx`, роли БД и миграции

**Files:**
- Create: `pkg/dbx/dbx.go`, `pkg/dbx/migrate.go`, `deploy/compose/postgres/init/00-roles.sql` (генерируется), `tools/dbinit/main.go`
- Test: `pkg/dbx/roles_test.go`

**Interfaces:**
- Produces:
  - `func Connect(ctx context.Context, dsn string, service string) (*pgxpool.Pool, error)` — `application_name = service`, трассировка запросов
  - `func InTx(ctx context.Context, pool *pgxpool.Pool, fn func(pgx.Tx) error) error` — откат при ошибке и панике
  - `func Migrate(ctx context.Context, ownerDSN string, migrations fs.FS) error` — `goose` на встроенных `embed.FS`, после миграций выдаёт роли `<svc>_app` права `SELECT, INSERT, UPDATE` (и `USAGE` на последовательности) на все таблицы схемы `public`, кроме перечисленных в `-- senim:append-only` (для них `SELECT, INSERT`)
  - `tools/dbinit -services identity,deal,marketplace,documents,files,notify,operator,audit -out deploy/compose/postgres/init/00-roles.sql`: на каждый сервис — база `<svc>`, роли `<svc>_owner` (владелец базы) и `<svc>_app` (`LOGIN`, без `CREATEDB`/`CREATEROLE`), `REVOKE ALL ON DATABASE <svc> FROM PUBLIC`, `GRANT CONNECT` только своим ролям. Пароли dev-only, читаются из `deploy/compose/dev.vars`.

- [ ] **Step 1: Write the failing tests** (testcontainers `postgres:17`, применить сгенерированный `00-roles.sql`, затем `Migrate` с тестовой миграцией: таблица `items`, таблица `ledger` с пометкой `-- senim:append-only`):
  - `TestAppRoleCannotTruncate`: от `identity_app` `TRUNCATE items` → SQLSTATE `42501`.
  - `TestAppRoleCannotDDL`: `ALTER TABLE items ADD COLUMN x int` и `DROP TRIGGER …` → `42501`.
  - `TestAppendOnlyGrant`: `UPDATE ledger` от `_app` → `42501`; `INSERT` — успешно.
  - `TestNoCrossServiceAccess`: `identity_app` подключается к базе `deal` → ошибка прав подключения.
  - `TestInTxRollsBackOnError`: `fn` вернул ошибку → вставка не видна.
- [ ] **Step 2:** Run `go test ./pkg/dbx/...` — FAIL.
- [ ] **Step 3:** Реализовать.
- [ ] **Step 4:** Run — PASS.
- [ ] **Step 5: Commit** — `feat(pkg/dbx): база на сервис, роли owner/app, миграции goose`.

---

### Task 8: `pkg/outbox` и `pkg/inbox` — события через NATS JetStream

**Files:**
- Create: `pkg/outbox/outbox.go`, `pkg/outbox/relay.go`, `pkg/outbox/migrations/0001_outbox.sql`, `pkg/inbox/inbox.go`, `pkg/inbox/migrations/0001_inbox.sql`, `proto/senim/events/v1/envelope.proto`
- Test: `pkg/outbox/outbox_test.go`, `pkg/inbox/inbox_test.go`

**Interfaces:**
- Produces:
  - `envelope.proto`: `message Envelope { string event_id = 1; string type = 2; string source = 3; google.protobuf.Timestamp occurred_at = 4; string trace_parent = 5; bytes payload = 6; }`
  - Таблица `outbox(id uuid pk, subject text, envelope bytea, created_at timestamptz, published_at timestamptz null)`; индекс по `published_at IS NULL`.
  - `func Add(ctx context.Context, tx pgx.Tx, subject string, eventType string, payload proto.Message) (eventID string, err error)` — UUIDv7, `trace_parent` из контекста.
  - `type Relay struct{…}`; `func NewRelay(pool *pgxpool.Pool, js jetstream.JetStream, log *slog.Logger) *Relay`; `func (r *Relay) Run(ctx context.Context) error` — батч `SELECT … WHERE published_at IS NULL ORDER BY id LIMIT 100 FOR UPDATE SKIP LOCKED`, публикация с заголовком `Nats-Msg-Id = event_id` (дедупликация JetStream), затем `published_at = now()`; пауза 200 мс при пустой очереди.
  - Таблица `inbox(consumer text, event_id text, processed_at timestamptz, primary key(consumer, event_id))`.
  - `func Handle(ctx context.Context, pool *pgxpool.Pool, consumer string, msg jetstream.Msg, fn func(ctx context.Context, tx pgx.Tx, env *eventsv1.Envelope) error) error` — в одной транзакции: `INSERT … ON CONFLICT DO NOTHING`; если вставки не было — `Ack` без вызова `fn`; иначе `fn`, коммит, `Ack`; ошибка `fn` → откат, `Nak` с задержкой.
  - Имена потоков: `SENIM_<SOURCE>` (например `SENIM_IDENTITY`), субъекты `senim.<source>.<event>`; окно дедупликации потока — 2 ч.

- [ ] **Step 1: Write the failing tests** (testcontainers: `postgres:17`, `nats:2` с `-js`):
  - `TestAddIsPartOfTransaction`: `Add` в транзакции, которая откатилась → в `outbox` пусто.
  - `TestRelayPublishesOnce`: две записи → в потоке ровно 2 сообщения; оба `published_at` заполнены.
  - `TestRelayCrashAfterPublish`: опубликовать, **не** отметить (тестовый хук), перезапустить релей → в потоке по-прежнему 2 сообщения (дедупликация по `Nats-Msg-Id`).
  - `TestInboxProcessesOnce`: доставить одно сообщение дважды → `fn` вызван 1 раз, оба раза `Ack`.
  - `TestInboxRetriesOnError`: `fn` падает первый раз → `Nak`; при повторной доставке `fn` вызывается снова и коммитится; запись в `inbox` одна.
  - `TestTwoRelaysNoDuplicates`: два релея параллельно на 500 записей → в потоке ровно 500 сообщений.
- [ ] **Step 2:** Run `go test ./pkg/outbox/... ./pkg/inbox/...` — FAIL.
- [ ] **Step 3:** Реализовать.
- [ ] **Step 4:** Run `go test -race …` — PASS.
- [ ] **Step 5: Commit** — `feat(pkg/outbox,inbox): события через outbox и JetStream без двойного эффекта`.

---

### Task 9: Сервис `identity` — каркас

**Files:**
- Create: `services/identity/cmd/identity/main.go`, `services/identity/internal/config.go`, `services/identity/migrations/0001_init.sql` (подключает миграции outbox/inbox), `services/identity/Dockerfile`, `proto/senim/identity/v1/identity.proto` (пустой `service IdentityService {}` — методы в плане 2)
- Test: `services/identity/main_test.go`

**Interfaces:**
- Consumes: `config`, `logging`, `server.Run`, `dbx.Connect/Migrate`, `outbox.NewRelay`.
- Produces: бинарь `identity` с подкомандами `serve` (gRPC `:8443`, проверки `:8081`, релей outbox в фоне) и `migrate` (DSN из `IDENTITY_OWNER_DSN`). Переменные: `APP_ENV`, `IDENTITY_APP_DSN`, `IDENTITY_OWNER_DSN`, `NATS_URL`, `TLS_CERT_FILE`, `TLS_KEY_FILE`, `TLS_CA_FILE`, `OTEL_EXPORTER_OTLP_ENDPOINT`. `ready` = пинг БД + соединение с NATS.
- Dockerfile: сборка `golang:<версия>` с `CGO_ENABLED=0`, итог `gcr.io/distroless/static-debian12:nonroot`.

- [ ] **Step 1: Write the failing test** `TestServeBecomesReady` (testcontainers Postgres + NATS, роли из Task 7): `migrate`, затем `serve` в горутине → health `SERVING` по mTLS ≤ 10 с; `/readyz` = 200.
- [ ] **Step 2:** Run `go test ./services/identity/...` — FAIL.
- [ ] **Step 3:** Реализовать.
- [ ] **Step 4:** Run — PASS. `docker build -f services/identity/Dockerfile .` — успешно, образ ≤ 30 МБ.
- [ ] **Step 5: Commit** — `feat(identity): каркас сервиса — serve, migrate, health, образ distroless`.

---

### Task 10: `web` — gRPC-клиент и проверка пути

**Files:**
- Create: `apps/web/src/platform/rpc.ts`, `apps/web/src/app/api/v2/healthz/route.ts`
- Modify: `apps/web/src/platform/env.ts` (новые переменные)
- Test: `apps/web/src/platform/rpc.test.ts`

**Interfaces:**
- Produces:
  - `export function meshTransport(): Transport` — `createGrpcTransport` из `@connectrpc/connect-node`, `baseUrl` = `MESH_URL` (`https://mesh:9443`), mTLS из `MESH_TLS_CERT_FILE`/`MESH_TLS_KEY_FILE`/`MESH_TLS_CA_FILE` (параметры TLS для HTTP/2 передаются через `nodeOptions` транспорта — сверить по документации connect-node), интерсептор дедлайна 5 с по умолчанию, интерсептор `traceparent`. Транспорт создаётся один раз на процесс.
  - `export function rpcErrorCode(err: unknown): string | null` — достаёт `ErrorDetail.code` из `ConnectError`.
  - `GET /api/v2/healthz` → вызывает `grpc.health.v1.Health/Check` для `senim.identity.v1.IdentityService`; ответ `{"identity":"SERVING","instance":"<x-senim-instance>"}`, 200; при ошибке 503 с кодом, без текста ошибки. Переменные `MESH_*` необязательны, пока `V2_ENABLED` не равна `true`; при `APP_ENV=prod` и `V2_ENABLED=true` — обязательны.
- [ ] **Step 1: Write the failing tests** (`rpc.test.ts`, vitest): `rpcErrorCode` достаёт код из `ConnectError` с деталью `ErrorDetail{code:"deal_not_found"}`; возвращает `null` для обычной ошибки; транспорт без `MESH_URL` при `V2_ENABLED=true` → ошибка конфигурации с именем переменной.
- [ ] **Step 2:** Run `npm --prefix apps/web run test:unit -- rpc` — FAIL.
- [ ] **Step 3:** Реализовать.
- [ ] **Step 4:** Run — PASS; `npm --prefix apps/web run typecheck && npm --prefix apps/web run lint` — без ошибок.
- [ ] **Step 5: Commit** — `feat(web): gRPC-транспорт к mesh с mTLS и проверка пути до identity`.

---

### Task 11: docker compose, Envoy, наблюдаемость, дымовой тест

**Files:**
- Create: `deploy/compose/compose.yaml`, `deploy/compose/dev.vars`, `deploy/compose/envoy/edge.yaml`, `deploy/compose/envoy/mesh.yaml`, `apps/web/Dockerfile`, `test/smoke/smoke_test.go` (тег сборки `smoke`)

**Interfaces / значения:**
- Профиль `core`: `postgres` (`postgres:17`, хост `5452`, `init/00-roles.sql`), `nats` (`nats:2`, `-js`, том), `minio` (хост `9100/9101`), `identity` (**2 реплики**, `migrate` отдельным одноразовым сервисом `identity-migrate` до старта), `mesh` (Envoy), `web` (Next.js standalone, `V2_ENABLED=true`), `edge` (Envoy, хост `8180` → `web:3000`).
- Профиль `full`: `otel-lgtm` (`grafana/otel-lgtm`, Grafana на хосте `3300`, OTLP `4317`), `clamav`. В `core` `OTEL_EXPORTER_OTLP_ENDPOINT` пуст.
- `mesh.yaml`: listener `0.0.0.0:9443`, TLS с `require_client_certificate: true` (CA dev), HTTP/2; маршрут по префиксу `/senim.identity.v1.` и `/grpc.health.v1.Health/` с заголовком `x-senim-target: identity` → кластер `identity`: `STRICT_DNS` `identity:8443`, `ROUND_ROBIN`, `typed_extension_protocol_options` HTTP/2, upstream TLS с клиентским сертификатом `mesh`, активная gRPC-проверка здоровья, тайм-аут маршрута 10 с, ретраи только для `unavailable` × 2. **Важно:** у gRPC-health нет имени сервиса в пути — `web` при проверке ставит заголовок `x-senim-target`, остальные вызовы маршрутизируются по пакету.
- `edge.yaml`: listener `0.0.0.0:8180` → кластер `web:3000`; заголовки безопасности ответа: `Strict-Transport-Security` (в prod), `X-Content-Type-Options: nosniff`, `Referrer-Policy: strict-origin-when-cross-origin`; локальный лимит запросов (token bucket, 50 rps на соединение — dev-значение).
- Сертификаты монтируются из `deploy/compose/certs` (генерирует `npm run v2:certs`).

- [ ] **Step 1: Write the failing smoke test** `test/smoke/smoke_test.go`:
  - `TestPathThroughMesh`: 20 раз `GET http://localhost:8180/api/v2/healthz` → все 200, `identity == "SERVING"`, значений `instance` — **2 разных** (балансировка по запросам работает).
  - `TestMeshRejectsWithoutClientCert`: прямой TLS-запрос к `mesh` без клиентского сертификата (порт mesh опубликован только на `127.0.0.1:9443`) → ошибка рукопожатия.
  - `TestMemoryBudgetCore`: суммарная память контейнеров профиля `core` по `docker stats --no-stream --format json` ≤ 3 ГБ; каждый Go-сервис ≤ 64 МБ.
- [ ] **Step 2:** Run `npm run v2:smoke` без поднятого стенда — FAIL (соединение отклонено).
- [ ] **Step 3:** Написать compose, конфиги Envoy, `apps/web/Dockerfile` (`output: "standalone"` в `next.config.ts`).
- [ ] **Step 4:** Run `npm run v2:certs && npm run v2:up && npm run v2:smoke` — PASS. Затем `npm run v2:up:full`, открыть Grafana `http://localhost:3300` → трейс `web → mesh → identity` виден (проверка глазами, скриншот в отчёт шага).
- [ ] **Step 5: Commit** — `feat(deploy): docker compose v2, Envoy edge и mesh, наблюдаемость, дымовой тест`.

---

### Task 12: CI

**Files:**
- Create: `.github/workflows/v2.yml`, `.golangci.yml`
- Modify: удалить `apps/web/.github/` (рабочий CI web переезжает в корень)

**Jobs (все на `ubuntu-latest`, `on: [push, pull_request]`):**
- `proto`: `go tool buf lint`; `go tool buf breaking --against '.git#branch=main'` (пропускается, пока в `main` нет `proto/`); `go tool buf generate` + `git diff --exit-code` (сгенерированный код актуален).
- `go`: `go vet ./...`, `go tool golangci-lint run ./...`, `go test -race ./...` (testcontainers работают на раннере), `go tool govulncheck ./...`.
- `web`: как текущий `check.yml` (сервис postgres:17, `npm ci`, typecheck, lint, test) с `working-directory: apps/web`.
- `images`: сборка образов `identity` и `web`, SBOM (`anchore/sbom-action`, SPDX), проверка уязвимостей (`anchore/scan-action`, падать на `critical`).
- `smoke` (после `images`): `npm run v2:certs && npm run v2:up && npm run v2:smoke`.

- [ ] **Step 1:** Написать `.golangci.yml` (линтеры: `errcheck`, `govet`, `staticcheck`, `gosec`, `revive`, `bodyclose`, `contextcheck`, `forbidigo` с запретом `fmt.Print*` и `log.Print*` вне `tools/`).
- [ ] **Step 2:** Run локально `npm run v2:lint && npm run v2:test` — PASS.
- [ ] **Step 3:** Написать workflow; проверить синтаксис `go run github.com/rhysd/actionlint/cmd/actionlint@latest`.
- [ ] **Step 4: Commit** — `ci: проверки v2 — proto, Go, web, образы с SBOM, дымовой тест`. Пушит владелец; первый прогон CI смотрим вместе.

---

### Task 13: Отчёт шага

- [ ] **Step 1:** `docs/PROGRESS.md` v2: что сделано, команды проверки и их вывод (тесты, дымовой тест, память `docker stats`), скриншот трейса, открытые вопросы.
- [ ] **Step 2:** Проверить итог одной командой из чистого клона: `npm run v2:certs && npm run v2:up && npm run v2:smoke && npm run v2:test` — всё зелёное.
- [ ] **Step 3: Commit** — `docs: отчёт по плану 1 (фундамент v2)`.
