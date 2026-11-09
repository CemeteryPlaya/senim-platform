-- name: CreateUser :one
INSERT INTO users (phone, roles, default_role, is_demo)
VALUES ($1, $2, $3, $4)
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
