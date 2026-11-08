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
- Профили: `core` — postgres, nats, identity, mesh, edge, web; `full` — плюс Grafana (otel-lgtm, `http://localhost:3300`, Explore → Tempo) и clamav; `storage` — MinIO (`9100`/`9101`), запускается отдельно и не входит в core: образ `minio/minio` больше не скачивается, S3-совместимый образ выбирает план 4 (files).
- Все порты хоста — только на 127.0.0.1. OTLP `4317` наружу не публикуется: телеметрию шлют только контейнеры внутри сети compose.
- Трасса в Grafana сейчас — edge → mesh (upstream `identity`): у web пока нет OTel SDK (он только передаёт `traceparent`), а вызовы gRPC-health identity не трассирует.
- Docker Desktop на Windows иногда ломает bind mounts (`mkdir /run/desktop/mnt/host/d: file exists`) — лечится перезапуском Docker Desktop.

## Обновления web из демо

`git subtree pull --prefix=apps/web D:/mvp-scale-arna main`

## Контракты и кодогенерация

- Схема лежит в `proto/senim/...`; сторонние протоколы — в `proto/thirdparty/` (отдельный модуль buf, не линтуется). Там лежит `grpc.health.v1`, скопированный из grpc/grpc-proto (Apache-2.0).
- `npm run v2:gen` запускает два шаблона: `buf.gen.yaml` (свои схемы: Go в `gen/go`, TypeScript в `apps/web/src/gen`) и `buf.gen.thirdparty.yaml` (сторонние: только TypeScript; в Go health берётся из `connectrpc.com/grpchealth`, поэтому Go для него не генерируется — иначе конфликт в реестре protobuf).
- Сгенерированный код коммитится; руками не править.
- `protoc-gen-es` вызывается как `node apps/web/node_modules/@bufbuild/protoc-gen-es/bin/protoc-gen-es`, а не через `node_modules/.bin/...`: на Windows buf запускает плагин через `cmd`, и путь со слэшами ему не подходит (`.cmd`-обёртка тоже). Перед генерацией нужен `npm ci` в `apps/web`.
- Перед `npm --prefix apps/web run typecheck` выполняйте `npx next typegen` в `apps/web`.
