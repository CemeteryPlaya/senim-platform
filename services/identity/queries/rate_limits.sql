-- name: HitRateLimit :one
-- Фиксированное окно: атомарно, один INSERT ... ON CONFLICT на попытку. Время передаёт
-- вызывающий (часы сервиса), чтобы окна проверялись без ожидания.
-- $1 — ключ, $2 — текущее время, $3 — длина окна в секундах.
INSERT INTO rate_limits (key, window_start, count)
VALUES ($1, $2::timestamptz, 1)
ON CONFLICT (key) DO UPDATE SET
    window_start = CASE WHEN rate_limits.window_start < $2::timestamptz - make_interval(secs => $3::float8)
                        THEN $2::timestamptz ELSE rate_limits.window_start END,
    count        = CASE WHEN rate_limits.window_start < $2::timestamptz - make_interval(secs => $3::float8)
                        THEN 1 ELSE rate_limits.count + 1 END
RETURNING count;
