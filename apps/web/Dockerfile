# syntax=docker/dockerfile:1
# Образ web для стенда v2. Контекст сборки — корень репозитория:
#   docker build -f apps/web/Dockerfile --target runner .
# Цели: runner — сервер Next (output: "standalone"), migrate — одноразовый `prisma migrate deploy`.

FROM node:24-bookworm-slim AS deps
WORKDIR /app
ENV NEXT_TELEMETRY_DISABLED=1
# Движку миграций Prisma нужен openssl (в slim-образе его нет).
RUN apt-get update && apt-get install -y --no-install-recommends openssl && rm -rf /var/lib/apt/lists/*
# postinstall выполняет prisma generate: схема и конфиг Prisma нужны до npm ci.
COPY apps/web/package.json apps/web/package-lock.json apps/web/prisma.config.ts ./
COPY apps/web/prisma ./prisma
RUN npm ci --no-audit --no-fund

FROM deps AS build
COPY apps/web/ ./
RUN npm run build

# Миграции legacy-базы web: полный node_modules с CLI Prisma, без исходников приложения.
FROM deps AS migrate
USER node
CMD ["node_modules/.bin/prisma", "migrate", "deploy"]

FROM node:24-bookworm-slim AS runner
WORKDIR /app
ENV NODE_ENV=production \
    NEXT_TELEMETRY_DISABLED=1 \
    PORT=3000 \
    HOSTNAME=0.0.0.0
COPY --from=build --chown=node:node /app/.next/standalone ./
COPY --from=build --chown=node:node /app/.next/static ./.next/static
COPY --from=build --chown=node:node /app/public ./public
# STORAGE_PROVIDER=local пишет файлы в ./storage.
RUN mkdir -p storage && chown node:node storage
USER node
EXPOSE 3000
CMD ["node", "server.js"]
