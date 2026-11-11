# senim-platform

Сенім v2: Go-микросервисы + `apps/web` (Next.js 16). Архитектура — `docs/superpowers/specs/2026-11-08-platform-v2-architecture-design.md`, правила — `CLAUDE.md`.

## Требования

- Go: минимум 1.26.7 (директива `go` в `go.mod`), сборка и CI — на `toolchain go1.27.3` из `go.mod` (Go сам скачает этот toolchain); образы сервисов собираются на `golang:1.27.3-bookworm` — тот же патч. Инструменты (`buf`, `sqlc`, `goose`, `golangci-lint`, `govulncheck`, генераторы protobuf и connect-go) подключены как `tool` в `go.mod`, отдельно ставить не нужно: `go tool buf ...`.
- Docker с Compose v2.
- Node.js и npm для `apps/web` (`npm --prefix apps/web ci`).

Если Go не в PATH (Git Bash на Windows): `export PATH="/c/Program Files/Go/bin:$HOME/go/bin:$PATH"`.

## Команды (корневой `package.json`)

```bash
npm run web -- <команда>   # npm --prefix apps/web, напр.: npm run web -- run typecheck
npm run v2:certs           # dev-сертификаты mTLS в deploy/compose/certs
npm run v2:config          # перегенерировать 00-roles.sql (dbinit) и nats/nats.conf (natsconf) из dev.vars
npm run v2:gen             # buf generate (Go + TypeScript)
npm run v2:up              # docker compose, профиль core
npm run v2:up:full         # профили core и full
npm run v2:down            # остановить всё
npm run v2:test            # go test ./... (без -race: на Windows нет gcc; -race в CI)
npm run v2:lint            # golangci-lint и buf lint
npm run v2:smoke           # сквозная проверка (тег smoke) на поднятом compose
```

Часть команд заработает по мере выполнения плана 1 (`docs/superpowers/plans/`).

## Локальный стенд (`deploy/compose`)

- Путь запроса: браузер → edge `http://localhost:8180` → web → mesh (gRPC, mTLS) → identity ×2. Проверка — `npm run v2:certs && npm run v2:up && npm run v2:smoke`.
- Стенд, поднятый до финальной волны плана 1 (08.11.2026): выполните `npm run v2:down`, удалите тома `senim-v2_pg-data` и `senim-v2_nats-data` (`docker volume rm senim-v2_pg-data senim-v2_nats-data`) и снова `npm run v2:certs` — иначе роли БД останутся без тайм-аутов (`00-roles.sql` выполняется только на новом томе), а у NATS не будет сертификата `nats`.
- Профили: `core` — postgres, nats, identity, mesh, edge, web; `full` — плюс Grafana (otel-lgtm, `http://localhost:3300`, Explore → Tempo) и clamav; `storage` — MinIO (`9100`/`9101`), запускается отдельно и не входит в core: образ `minio/minio` больше не скачивается, S3-совместимый образ выбирает план 4 (files).
- Все порты хоста — только на 127.0.0.1. OTLP `4317` наружу не публикуется: телеметрию шлют только контейнеры внутри сети compose.
- Трассы в Grafana: спаны edge и mesh, и с плана 2 — спаны RPC `identity` (`senim.identity.v1.IdentityService/…` с дочерними `db.query`) и метрика `rpc_server_call_duration_seconds`. Спан identity пока — корень своей трассы со ссылкой (span link) на спан mesh, а не его дочерний: одной трассой edge → mesh → identity они станут в плане 3 (`WithTrustRemote` в `pkg/server`). У web OTel SDK нет (он только передаёт `traceparent`); вызовы gRPC-health identity не трассирует.
- e2e `apps/web` (план 2): вход, сессии и люди сида — в identity стенда, поэтому сначала `npm run v2:certs` (один раз) и `npm run v2:up`, затем `E2E_DATABASE_URL=… npm --prefix apps/web run test:e2e`. Переменные web к mesh (`V2_ENABLED`, `MESH_URL=https://localhost:9443`, `MESH_TLS_*` — сертификат `web` из `deploy/compose/certs`) берутся из `apps/web/e2e/v2.vars.example`, если не заданы в командной строке. Без стенда сид (`npm --prefix apps/web run db:seed`) и `global-setup` падают с подсказкой `npm run v2:up`. `ResetDemo` стирает сессии и лимиты кодов identity, пользователей оставляет: `SeedUsers` возвращает те же `id` по телефону.
- План 2б (ADR-014): ПДн, KYC, согласия и 2FA операторов — в identity. Ключи ПДн сервиса — `PII_KEKS` (`kid:base64,…`), `PII_KEK_CURRENT`, `PII_INDEX_KEY` (на стенде — из `IDENTITY_PII_*` в `deploy/compose/dev.vars`); identity не стартует, если в базе есть шифртекст под `kid`, которого нет в `PII_KEKS`. Подкоманды образа: `identity rewrap-pii [--batch 500]` — перешифровать ключи данных на текущий `kid` после смены ключа (код выхода 1 — были повреждённые значения); `identity mfa-reset --phone +77001234567` — сбросить TOTP оператора (запускает владелец). Окно повторной 2FA для денежных действий — `MFA_STEP_UP_WINDOW` в env web (по умолчанию `5m`, 1–30 мин). Демо-сид web шлёт ФИО, ИИН, реквизиты, KYC и согласия в identity (`SeedUsers`, `SeedConsents`), поэтому сид и e2e требуют поднятого стенда.
- После перезапуска Docker Desktop сборка стенда может требовать `BUILDX_BAKE_ENTITLEMENTS_FS=0 npm run v2:up` (buildx bake просит `--allow=fs.read`).
- Docker Desktop на Windows иногда ломает bind mounts (`mkdir /run/desktop/mnt/host/d: file exists`) — лечится перезапуском Docker Desktop.

## Обновления web из демо

`git subtree pull --prefix=apps/web D:/mvp-scale-arna main`

## Контракты и кодогенерация

- Схема лежит в `proto/senim/...`; сторонние протоколы — в `proto/thirdparty/` (отдельный модуль buf, не линтуется). Там лежит `grpc.health.v1`, скопированный из grpc/grpc-proto (Apache-2.0).
- `npm run v2:gen` запускает два шаблона: `buf.gen.yaml` (свои схемы: Go в `gen/go`, TypeScript в `apps/web/src/gen`) и `buf.gen.thirdparty.yaml` (сторонние: только TypeScript; в Go health берётся из `connectrpc.com/grpchealth`, поэтому Go для него не генерируется — иначе конфликт в реестре protobuf).
- Сгенерированный код коммитится; руками не править.
- `protoc-gen-es` вызывается как `node apps/web/node_modules/@bufbuild/protoc-gen-es/bin/protoc-gen-es`, а не через `node_modules/.bin/...`: на Windows buf запускает плагин через `cmd`, и путь со слэшами ему не подходит (`.cmd`-обёртка тоже). Перед генерацией нужен `npm ci` в `apps/web`.
- Перед `npm --prefix apps/web run typecheck` выполняйте `npx next typegen` в `apps/web`.
