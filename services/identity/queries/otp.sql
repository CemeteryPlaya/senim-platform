-- name: InsertOtpCode :exec
INSERT INTO otp_codes (phone, code_hash, expires_at, created_at)
VALUES ($1, $2, $3, $4);

-- name: GetActiveOtp :one
-- Самый свежий непогашенный и неистёкший код номера: действует только последний выданный.
SELECT * FROM otp_codes
WHERE phone = $1 AND consumed_at IS NULL AND expires_at > sqlc.arg(now)::timestamptz
ORDER BY created_at DESC
LIMIT 1;

-- name: CountOtpAttempt :one
-- Засчитывает попытку до сравнения кода (атомарно: параллельный перебор не обходит
-- предел). Нет строки в ответе — попытки исчерпаны или код уже погашен.
UPDATE otp_codes SET attempts = attempts + 1
WHERE id = $1 AND consumed_at IS NULL AND attempts < sqlc.arg(max_attempts)::int
RETURNING attempts;

-- name: ConsumeOtp :execrows
-- Условный UPDATE: из двух одновременных вводов одного кода погасит ровно один.
UPDATE otp_codes SET consumed_at = sqlc.arg(now)::timestamptz
WHERE id = $1 AND consumed_at IS NULL;

-- Сброс стенда (ResetDemo): таблица otp_codes помечена senim:app-delete.
-- name: DeleteAllOtpCodes :execrows
DELETE FROM otp_codes;
