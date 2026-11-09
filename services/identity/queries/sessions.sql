-- name: InsertSession :one
INSERT INTO sessions (token_hash, user_id, active_role, user_agent, created_at, last_seen_at, expires_at)
VALUES ($1, $2, $3, $4, $5, $5, $6)
RETURNING *;

-- name: SessionTokenExists :one
SELECT EXISTS (SELECT 1 FROM sessions WHERE token_hash = $1);

-- name: GetSessionByTokenHash :one
SELECT * FROM sessions WHERE token_hash = $1;

-- name: LockSessionByTokenHash :one
SELECT * FROM sessions WHERE token_hash = $1 FOR UPDATE;

-- Обновляет last_seen_at не чаще раза в throttle: before = now - throttle.
-- name: TouchSession :execrows
UPDATE sessions SET last_seen_at = @now
WHERE id = @id AND revoked_at IS NULL AND last_seen_at < @before;

-- name: RevokeSessionByTokenHash :execrows
UPDATE sessions SET revoked_at = $2 WHERE token_hash = $1 AND revoked_at IS NULL;

-- name: RevokeUserSessions :execrows
UPDATE sessions SET revoked_at = $2 WHERE user_id = $1 AND revoked_at IS NULL;

-- name: SetSessionActiveRole :one
UPDATE sessions SET active_role = $2 WHERE id = $1 RETURNING *;

-- Сброс стенда (ResetDemo): таблица sessions помечена senim:app-delete.
-- name: DeleteAllSessions :execrows
DELETE FROM sessions;
