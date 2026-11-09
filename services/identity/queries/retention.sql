-- Сроки хранения (retention.go). Каждый запрос удаляет не больше sqlc.arg(batch_size)
-- строк за вызов: вызывающий повторяет, пока удалено меньше пачки. Таблицы помечены
-- senim:app-delete (outbox — в pkg/outbox, idempotency — в pkg/idem).

-- name: DeleteOldOtpCodes :execrows
DELETE FROM otp_codes
WHERE id IN (SELECT o.id FROM otp_codes o WHERE o.created_at < sqlc.arg(cutoff)::timestamptz LIMIT sqlc.arg(batch_size)::int);

-- Живая сессия (не отозвана и не истекла) под условие не попадает: cutoff всегда в прошлом.
-- name: DeleteOldSessions :execrows
DELETE FROM sessions
WHERE id IN (
    SELECT s.id FROM sessions s
    WHERE (s.revoked_at IS NOT NULL AND s.revoked_at < sqlc.arg(cutoff)::timestamptz)
       OR s.expires_at < sqlc.arg(cutoff)::timestamptz
    LIMIT sqlc.arg(batch_size)::int
);

-- name: DeleteOldRateLimits :execrows
DELETE FROM rate_limits
WHERE key IN (SELECT r.key FROM rate_limits r WHERE r.window_start < sqlc.arg(cutoff)::timestamptz LIMIT sqlc.arg(batch_size)::int);

-- name: DeleteOldIdempotency :execrows
DELETE FROM idempotency
WHERE (method, key) IN (SELECT i.method, i.key FROM idempotency i WHERE i.created_at < sqlc.arg(cutoff)::timestamptz LIMIT sqlc.arg(batch_size)::int);

-- Только опубликованные: неопубликованная запись ещё нужна релею, каким бы старым ни было cutoff.
-- name: DeleteOldPublishedOutbox :execrows
DELETE FROM outbox
WHERE id IN (SELECT o.id FROM outbox o WHERE o.published_at IS NOT NULL AND o.published_at < sqlc.arg(cutoff)::timestamptz LIMIT sqlc.arg(batch_size)::int);

-- Сброс стенда (ResetDemo): оставляет только запись самого вызова, чтобы его повтор был идемпотентным.
-- name: DeleteIdempotencyExcept :execrows
DELETE FROM idempotency WHERE NOT (method = sqlc.arg(method)::text AND key = sqlc.arg(key)::text);
