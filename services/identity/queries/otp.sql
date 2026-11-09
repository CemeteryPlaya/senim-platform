-- name: InsertOtpCode :exec
INSERT INTO otp_codes (phone, code_hash, expires_at, created_at)
VALUES ($1, $2, $3, $4);
