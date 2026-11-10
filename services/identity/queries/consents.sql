-- Согласие, данное в сессии (GrantConsent). Действующее той же версии и предмета уже есть —
-- 23505 на consents_active_key (сервис сначала читает его под блокировкой пользователя).
-- name: InsertConsent :one
INSERT INTO consents (user_id, kind, version, text_sha256, purposes, reference_id, channel, session_id, granted_at)
VALUES (@user_id, @kind, @version, @text_sha256, @purposes::text[], @reference_id, @channel, sqlc.narg('session_id'), @granted_at)
RETURNING *;

-- Согласие сида демо-стенда: действующее той же версии уже есть — без изменений.
-- name: SeedConsent :exec
INSERT INTO consents (user_id, kind, version, text_sha256, purposes, reference_id, channel, granted_at)
VALUES (@user_id, 'PD_PROCESSING', @version, @text_sha256, '{}', '', 'seed', @granted_at)
ON CONFLICT (user_id, kind, version, reference_id) WHERE revoked_at IS NULL DO NOTHING;

-- name: GetActiveConsent :one
SELECT * FROM consents
WHERE user_id = @user_id AND kind = @kind AND version = @version AND reference_id = @reference_id AND revoked_at IS NULL;

-- Действующие согласия (Authenticate), старые первыми.
-- name: ListActiveConsents :many
SELECT * FROM consents WHERE user_id = $1 AND revoked_at IS NULL ORDER BY granted_at, id;

-- Все согласия с отозванными (ListMyConsents), старые первыми.
-- name: ListUserConsents :many
SELECT * FROM consents WHERE user_id = $1 ORDER BY granted_at, id;

-- Отметка отзыва всех действующих согласий вида (RevokeConsent): единственное изменение,
-- которое пропускает триггер неизменности.
-- name: RevokeActiveConsents :many
UPDATE consents SET revoked_at = @now
WHERE user_id = @user_id AND kind = @kind AND revoked_at IS NULL
RETURNING *;

-- Кто из пользователей дал действующее согласие вида к предмету (HasConsents).
-- name: UsersWithConsent :many
SELECT DISTINCT user_id FROM consents
WHERE user_id = ANY(@user_ids::uuid[]) AND kind = @kind AND reference_id = @reference_id AND revoked_at IS NULL;

-- name: GetOpenRevocation :one
SELECT * FROM consent_revocations WHERE user_id = @user_id AND kind = @kind AND status = 'REQUESTED';

-- name: CreateRevocation :one
INSERT INTO consent_revocations (user_id, kind, requested_at, due_at)
VALUES (@user_id, @kind, @requested_at, @due_at)
RETURNING *;

-- name: GetRevocation :one
SELECT * FROM consent_revocations WHERE id = $1;

-- Решение оператора (ResolveConsentRevocation): условный UPDATE по ожидаемому статусу; две
-- конкурентные команды дают одну строку, вторая и закрытая заявка — 0 строк.
-- name: ResolveRevocation :one
UPDATE consent_revocations SET
    status     = @to_status,
    decided_at = @now,
    decided_by = @decided_by,
    reason     = sqlc.narg('reason')
WHERE id = @id AND status = ANY(@allowed_from::text[])
RETURNING *;

-- Очередь оператора: открытые заявки, ближний срок первым.
-- name: ListOpenRevocations :many
SELECT * FROM consent_revocations WHERE status = 'REQUESTED' ORDER BY due_at, requested_at, id;

-- Заявки пользователя (ListMyConsents), новые первыми.
-- name: ListUserRevocations :many
SELECT * FROM consent_revocations WHERE user_id = $1 ORDER BY requested_at DESC, id;
