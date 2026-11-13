-- name: GetPerson :one
SELECT * FROM persons WHERE user_id = $1;

-- Запись ИИН (RecordPerson): строки нет — вставка; есть без ИИН — дописывается ИИН, уже
-- указанное ФИО не меняется. ИИН уже записан — 0 строк (pgx.ErrNoRows). Тот же ИИН у
-- другого человека — 23505 на persons_iin_hash_key.
-- name: RecordPersonIIN :one
INSERT INTO persons (user_id, full_name, iin_enc, iin_hash, iin_last4, updated_at)
VALUES (@user_id, @full_name, @iin_enc, @iin_hash, @iin_last4, @now)
ON CONFLICT (user_id) DO UPDATE SET
    full_name  = COALESCE(persons.full_name, EXCLUDED.full_name),
    iin_enc    = EXCLUDED.iin_enc,
    iin_hash   = EXCLUDED.iin_hash,
    iin_last4  = EXCLUDED.iin_last4,
    updated_at = EXCLUDED.updated_at
WHERE persons.iin_hash IS NULL
RETURNING *;

-- Контакты (UpdateContacts): Instagram и e-mail целиком, пусто — NULL. Другой адрес (и
-- пустой) сбрасывает подтверждение, тот же — оставляет.
-- name: UpsertContacts :one
INSERT INTO persons (user_id, instagram, email, updated_at)
VALUES (@user_id, sqlc.narg('instagram'), sqlc.narg('email'), @now)
ON CONFLICT (user_id) DO UPDATE SET
    instagram         = EXCLUDED.instagram,
    email             = EXCLUDED.email,
    email_verified_at = CASE WHEN persons.email = EXCLUDED.email THEN persons.email_verified_at END,
    updated_at        = EXCLUDED.updated_at
RETURNING *;

-- Сид демо-стенда (SeedUsers): заданные поля перезаписываются, незаданные (NULL) остаются.
-- ИИН задаётся тремя столбцами вместе.
-- name: UpsertSeedPerson :one
INSERT INTO persons (user_id, full_name, iin_enc, iin_hash, iin_last4, instagram, email, updated_at)
VALUES (@user_id, sqlc.narg('full_name'), sqlc.narg('iin_enc'), sqlc.narg('iin_hash'), sqlc.narg('iin_last4'),
        sqlc.narg('instagram'), sqlc.narg('email'), @now)
ON CONFLICT (user_id) DO UPDATE SET
    full_name  = COALESCE(EXCLUDED.full_name, persons.full_name),
    iin_enc    = COALESCE(EXCLUDED.iin_enc, persons.iin_enc),
    iin_hash   = COALESCE(EXCLUDED.iin_hash, persons.iin_hash),
    iin_last4  = COALESCE(EXCLUDED.iin_last4, persons.iin_last4),
    instagram  = COALESCE(EXCLUDED.instagram, persons.instagram),
    email      = COALESCE(EXCLUDED.email, persons.email),
    -- Сид сменил адрес — подтверждение прежнего к новому не относится.
    email_verified_at = CASE WHEN EXCLUDED.email IS NULL OR EXCLUDED.email = persons.email
                             THEN persons.email_verified_at END,
    updated_at = EXCLUDED.updated_at
RETURNING *;
