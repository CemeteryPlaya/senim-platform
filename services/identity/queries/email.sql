-- name: RetireEmailCodes :exec
-- Гасит непогашенные коды почты пользователя: перед выдачей нового (в той же транзакции —
-- у пользователя не больше одного действующего кода) и при смене адреса в UpdateContacts
-- (прежний кандидат не подтверждается поверх нового адреса).
UPDATE email_codes SET consumed_at = sqlc.arg(now)::timestamptz
WHERE user_id = $1 AND consumed_at IS NULL;

-- name: InsertEmailCode :exec
INSERT INTO email_codes (user_id, email, code_hash, expires_at, created_at)
VALUES ($1, $2, $3, $4, $5);

-- name: GetActiveEmailCode :one
-- Непогашенный и неистёкший код пользователя; RetireEmailCodes оставляет не больше одного.
SELECT * FROM email_codes
WHERE user_id = $1 AND consumed_at IS NULL AND expires_at > sqlc.arg(now)::timestamptz
ORDER BY created_at DESC
LIMIT 1;

-- name: CountEmailAttempt :one
-- Засчитывает попытку до сравнения кода (атомарно: параллельный перебор не обходит
-- предел). Нет строки в ответе — попытки исчерпаны или код уже погашен.
UPDATE email_codes SET attempts = attempts + 1
WHERE id = $1 AND consumed_at IS NULL AND attempts < sqlc.arg(max_attempts)::int
RETURNING attempts;

-- name: ConsumeEmailCode :execrows
-- Условный UPDATE: из двух одновременных вводов одного кода погасит ровно один.
UPDATE email_codes SET consumed_at = sqlc.arg(now)::timestamptz
WHERE id = $1 AND consumed_at IS NULL;

-- Подтверждённый адрес (VerifyEmailCode): адрес-кандидат и время подтверждения вместе.
-- name: SetVerifiedEmail :one
INSERT INTO persons (user_id, email, email_verified_at, updated_at)
VALUES (@user_id, @email, @now, @now)
ON CONFLICT (user_id) DO UPDATE SET
    email             = EXCLUDED.email,
    email_verified_at = EXCLUDED.email_verified_at,
    updated_at        = EXCLUDED.updated_at
RETURNING *;

-- name: DeleteOldEmailCodes :execrows
-- Срок хранения (retention.go): как DeleteOldOtpCodes.
DELETE FROM email_codes
WHERE id IN (SELECT e.id FROM email_codes e WHERE e.created_at < sqlc.arg(cutoff)::timestamptz LIMIT sqlc.arg(batch_size)::int);

-- Сброс стенда (ResetDemo): таблица email_codes помечена senim:app-delete.
-- name: DeleteAllEmailCodes :execrows
DELETE FROM email_codes;
