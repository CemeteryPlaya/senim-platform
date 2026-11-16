-- name: CreateUser :one
INSERT INTO users (phone, roles, default_role)
VALUES ($1, $2, $3)
RETURNING *;

-- name: GetUserByPhone :one
SELECT * FROM users WHERE phone = $1;

-- name: GetUserByID :one
SELECT * FROM users WHERE id = $1;

-- name: LockUser :one
SELECT * FROM users WHERE id = $1 FOR UPDATE;

-- name: SetUserDefaultRole :one
UPDATE users SET default_role = $2, updated_at = $3 WHERE id = $1 RETURNING *;

-- name: AddUserRole :one
UPDATE users SET roles = array_append(roles, @role::text), updated_at = @now WHERE id = @id RETURNING *;

-- Сид стенда: upsert по телефону, пользователь помечается seeded. created_at не задан — при
-- вставке now(), при обновлении остаётся прежним. Блокировка снимается. Существующего
-- пользователя, созданного не сидом (seeded = false), сид не трогает: 0 строк
-- (pgx.ErrNoRows), сервис отказывает.
-- name: UpsertSeedUser :one
INSERT INTO users (phone, roles, default_role, seeded, created_at, updated_at)
VALUES (@phone, @roles, @default_role, true, COALESCE(sqlc.narg('created_at')::timestamptz, @now::timestamptz), @now::timestamptz)
ON CONFLICT (phone) DO UPDATE SET
    roles        = EXCLUDED.roles,
    default_role = EXCLUDED.default_role,
    created_at   = COALESCE(sqlc.narg('created_at')::timestamptz, users.created_at),
    blocked_at   = NULL,
    updated_at   = @now::timestamptz
WHERE users.seeded
RETURNING *;
