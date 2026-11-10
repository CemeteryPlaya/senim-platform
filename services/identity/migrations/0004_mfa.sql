-- +goose Up

-- Сброс фактора (identity mfa-reset) удаляет строку рабочей ролью.
-- senim:app-delete mfa_factors

-- Второй фактор оператора (TOTP). Секрет — только шифртекст pkg/pii, AAD
-- "identity.mfa_factors.secret:<user_id>". confirmed_at пуст, пока подключение не
-- подтверждено кодом; last_used_step — последний принятый шаг (код не принимается дважды).
CREATE TABLE mfa_factors (
    user_id        uuid PRIMARY KEY REFERENCES users (id),
    secret_enc     text NOT NULL,
    confirmed_at   timestamptz,
    last_used_step bigint NOT NULL DEFAULT 0,
    created_at     timestamptz NOT NULL DEFAULT now()
);

-- Когда в этой сессии пройден второй фактор; пусто — не пройден.
ALTER TABLE sessions ADD COLUMN mfa_verified_at timestamptz;

-- +goose Down
ALTER TABLE sessions DROP COLUMN mfa_verified_at;
DROP TABLE mfa_factors;
