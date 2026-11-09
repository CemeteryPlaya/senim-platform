-- name: InsertSession :one
INSERT INTO sessions (token_hash, user_id, active_role, user_agent, created_at, last_seen_at, expires_at)
VALUES ($1, $2, $3, $4, $5, $5, $6)
RETURNING *;

-- name: SessionTokenExists :one
SELECT EXISTS (SELECT 1 FROM sessions WHERE token_hash = $1);
