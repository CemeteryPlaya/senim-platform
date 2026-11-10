-- Подача документов (SubmitKyc): переход по таблице kycTransitions; статус не из from —
-- 0 строк (pgx.ErrNoRows), сервис отвечает kyc_transition_forbidden. Причина прошлого
-- отказа снимается, дата решения остаётся прежней.
-- name: SubmitPartyKyc :one
UPDATE parties SET
    kyc_status                = 'PENDING',
    kyc_reject_reason         = NULL,
    kyc_submitted_at          = @now,
    kyc_id_file_ids           = @id_file_ids::text[],
    kyc_registration_file_ids = @registration_file_ids::text[],
    updated_at                = @now
WHERE user_id = @user_id AND kyc_status = ANY(@allowed_from::text[])
RETURNING *;

-- Решение оператора (ReviewKyc): условный UPDATE по ожидаемому статусу; две конкурентные
-- команды дают одну строку, вторая — 0 строк.
-- name: ReviewPartyKyc :one
UPDATE parties SET
    kyc_status        = @to_status,
    kyc_reject_reason = sqlc.narg('reject_reason'),
    kyc_reviewed_at   = @now,
    updated_at        = @now
WHERE user_id = @user_id AND kyc_status = ANY(@allowed_from::text[])
RETURNING *;

-- Очередь проверки: на проверке и с обоими видами файлов, давно ждущие первыми.
-- name: ListKycQueue :many
SELECT * FROM parties
WHERE kyc_status = 'PENDING'
  AND cardinality(kyc_id_file_ids) > 0
  AND cardinality(kyc_registration_file_ids) > 0
ORDER BY kyc_submitted_at ASC NULLS LAST, user_id;

-- name: ListPersonsByIDs :many
SELECT * FROM persons WHERE user_id = ANY(@user_ids::uuid[]);
