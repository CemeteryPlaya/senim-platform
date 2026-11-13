-- +goose Up

-- Подтверждение e-mail кодом (этап 2 нового интерфейса, задача A1): код уходит на
-- адрес-кандидат, в persons.email адрес попадает только после верного кода вместе с
-- email_verified_at.
--
-- email_codes — как otp_codes: код только HMAC (ключ IDENTITY_OTP_HMAC_KEY, домен
-- "email:v1", в составе user_id и адрес), не больше пяти попыток, у пользователя не больше
-- одного непогашенного кода. Адрес-кандидат — открыто, как persons.email (ADR-014: e-mail
-- не шифруется); срок хранения строк — IDENTITY_RETAIN_OTP, как у кодов SMS.
-- senim:app-delete email_codes
CREATE TABLE email_codes (
    id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id     uuid NOT NULL REFERENCES users (id),
    email       text NOT NULL,
    code_hash   bytea NOT NULL,
    attempts    integer NOT NULL DEFAULT 0,
    expires_at  timestamptz NOT NULL,
    consumed_at timestamptz,
    created_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX email_codes_user_created_idx ON email_codes (user_id, created_at DESC);

-- Уже записанные адреса (UpdateContacts v1) не подтверждены: NULL.
ALTER TABLE persons
    ADD COLUMN email_verified_at timestamptz,
    ADD CONSTRAINT persons_email_verified CHECK (email_verified_at IS NULL OR email IS NOT NULL);

-- +goose Down
ALTER TABLE persons
    DROP CONSTRAINT persons_email_verified,
    DROP COLUMN email_verified_at;
DROP TABLE email_codes;
