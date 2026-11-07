# senim-platform

Сенім v2: Go-микросервисы + `apps/web` (Next.js 16). Архитектура — `docs/superpowers/specs/2026-11-08-platform-v2-architecture-design.md`, правила — `CLAUDE.md`.

## Требования

- Go (нижняя граница задана в `go.mod`; проверено на 1.27). Инструменты (`buf`, `sqlc`, `goose`, `golangci-lint`, `govulncheck`, генераторы protobuf и connect-go) подключены как `tool` в `go.mod`, отдельно ставить не нужно: `go tool buf ...`.
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

## Обновления web из демо

`git subtree pull --prefix=apps/web D:/mvp-scale-arna main`
