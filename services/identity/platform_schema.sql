-- Таблицы платформенных пакетов (pkg/outbox.Schema, pkg/idem.Schema), которых нет в
-- migrations/: только для генерации sqlc, в базу не применяется. При изменении колонок
-- этих таблиц в pkg — обновить здесь и выполнить go tool sqlc generate.
CREATE TABLE outbox (
    id              uuid        PRIMARY KEY,
    subject         text        NOT NULL,
    envelope        bytea       NOT NULL,
    created_at      timestamptz NOT NULL DEFAULT now(),
    published_at    timestamptz,
    attempts        int         NOT NULL DEFAULT 0,
    last_error      text,
    next_attempt_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE idempotency (
    method       text        NOT NULL,
    key          text        NOT NULL,
    request_hash bytea       NOT NULL,
    response     bytea       NOT NULL,
    created_at   timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (method, key)
);

-- Индексы не влияют на генерацию sqlc; для сверки с pkg/outbox.Schema:
CREATE INDEX outbox_published_idx ON outbox (published_at) WHERE published_at IS NOT NULL;
