-- name: HitRateLimit :one
-- Фиксированное окно: атомарно, один INSERT ... ON CONFLICT на попытку. Время передаёт
-- вызывающий (часы сервиса), чтобы окна проверялись без ожидания.
INSERT INTO rate_limits (key, window_start, count)
VALUES (sqlc.arg(key), sqlc.arg(now)::timestamptz, 1)
ON CONFLICT (key) DO UPDATE SET
    window_start = CASE WHEN rate_limits.window_start < sqlc.arg(now)::timestamptz - make_interval(secs => sqlc.arg(window_secs)::float8)
                        THEN sqlc.arg(now)::timestamptz ELSE rate_limits.window_start END,
    count        = CASE WHEN rate_limits.window_start < sqlc.arg(now)::timestamptz - make_interval(secs => sqlc.arg(window_secs)::float8)
                        THEN 1 ELSE rate_limits.count + 1 END
RETURNING count;

-- Сброс стенда (ResetDemo): таблица rate_limits помечена senim:app-delete.
-- name: DeleteAllRateLimits :execrows
DELETE FROM rate_limits;

-- Возврат попытки: верный код не тратит лимит неверных (ключ mfa:<user_id>).
-- name: RefundRateLimit :exec
UPDATE rate_limits SET count = count - 1 WHERE key = $1 AND count > 0;
