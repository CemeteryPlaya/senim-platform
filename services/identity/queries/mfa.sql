-- name: GetMfaFactor :one
SELECT * FROM mfa_factors WHERE user_id = $1;

-- name: LockMfaFactor :one
SELECT * FROM mfa_factors WHERE user_id = $1 FOR UPDATE;

-- Новый или заменённый неподтверждённый секрет. Подтверждённый фактор не меняется:
-- строк 0 — фактор уже подключён.
-- name: UpsertPendingMfaFactor :execrows
INSERT INTO mfa_factors (user_id, secret_enc, created_at)
VALUES (@user_id, @secret_enc, @now)
ON CONFLICT (user_id) DO UPDATE SET
    secret_enc     = EXCLUDED.secret_enc,
    created_at     = EXCLUDED.created_at,
    last_used_step = 0
WHERE mfa_factors.confirmed_at IS NULL;

-- Подтверждение подключения: тот же секрет, что проверялся, ещё не подтверждён, шаг новый.
-- name: ConfirmMfaFactor :execrows
UPDATE mfa_factors SET confirmed_at = @now, last_used_step = @step
WHERE user_id = @user_id AND secret_enc = @secret_enc AND confirmed_at IS NULL AND last_used_step < @step;

-- Принятый код: тот же секрет, что проверялся, шаг строго больше последнего (параллельный
-- ввод того же кода — 0 строк).
-- name: UseMfaStep :execrows
UPDATE mfa_factors SET last_used_step = @step
WHERE user_id = @user_id AND secret_enc = @secret_enc AND confirmed_at IS NOT NULL AND last_used_step < @step;

-- name: DeleteMfaFactor :execrows
DELETE FROM mfa_factors WHERE user_id = $1;

-- name: SetSessionMfaVerified :one
UPDATE sessions SET mfa_verified_at = @at WHERE id = @id RETURNING *;

-- name: ClearUserSessionsMfa :execrows
UPDATE sessions SET mfa_verified_at = NULL WHERE user_id = $1 AND mfa_verified_at IS NOT NULL;

-- Второй фактор оператора стенда из сида (SeedUsers): подключён сразу известным секретом.
-- Шаг последнего принятого кода не сбрасывается — уже введённый код не примется повторно.
-- name: UpsertSeedMfaFactor :exec
INSERT INTO mfa_factors (user_id, secret_enc, confirmed_at, created_at)
VALUES (@user_id, @secret_enc, @now, @now)
ON CONFLICT (user_id) DO UPDATE SET
    secret_enc   = EXCLUDED.secret_enc,
    confirmed_at = EXCLUDED.confirmed_at,
    created_at   = EXCLUDED.created_at;

-- Сброс стенда (ResetStand): факторы засеянных пользователей удаляются, чтобы повторный прогон
-- e2e подключал TOTP заново или получал секрет сида. Таблица mfa_factors помечена senim:app-delete.
-- name: DeleteSeededMfaFactors :execrows
DELETE FROM mfa_factors f USING users u WHERE f.user_id = u.id AND u.seeded;
