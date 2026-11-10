-- +goose Up

-- Сторона сделки — исполнитель (план 2б): правовая форма, реквизиты, подписант договора,
-- счёт выплаты и проверка документов (KYC). Строка появляется при RegisterParty
-- (исполнитель сам) или ProvisionExecutor (оператор).
--
-- ИИН/БИН, ИИН подписанта и IBAN — только шифртекст pkg/pii; AAD
-- "identity.parties.<поле>:<user_id>" (bin_iin, signer_iin, payout_iban). ИИН/БИН — со
-- слепым индексом HMAC домена "bin_iin": один номер — одна сторона (уникальный
-- bin_iin_hash; конфликт 23505 сервис отвечает кодом iin_taken). ИИН подписанта — с
-- индексом домена "iin", чтобы сверять его с ИИН сертификата ЭЦП (VerifySignerIin), без
-- уникальности: один директор бывает у нескольких ТОО. Для показа — последние 4 символа
-- (bin_iin_last4, signer_iin_last4, payout_iban_last4).
--
-- Подписант (ADR-003): у ТОО — директор, ФИО и ИИН обязательны; у ИП и самозанятого —
-- владелец, его ИИН — ИИН/БИН стороны, поэтому signer_iin пуст.
CREATE TABLE parties (
    user_id                   uuid PRIMARY KEY REFERENCES users (id),
    legal_form                text NOT NULL CHECK (legal_form IN ('SELF_EMPLOYED', 'IP', 'TOO')),
    legal_name                text NOT NULL,
    bin_iin_enc               text NOT NULL,
    bin_iin_hash              bytea NOT NULL UNIQUE,
    bin_iin_last4             text NOT NULL,
    signer_full_name          text,
    signer_iin_enc            text,
    signer_iin_hash           bytea,
    signer_iin_last4          text,
    payout_iban_enc           text,
    payout_iban_last4         text,
    kyc_status                text NOT NULL DEFAULT 'NOT_SUBMITTED'
        CHECK (kyc_status IN ('NOT_SUBMITTED', 'PENDING', 'VERIFIED', 'REJECTED')),
    kyc_reject_reason         text,
    kyc_submitted_at          timestamptz,
    kyc_reviewed_at           timestamptz,
    kyc_id_file_ids           text[] NOT NULL DEFAULT '{}',
    kyc_registration_file_ids text[] NOT NULL DEFAULT '{}',
    created_at                timestamptz NOT NULL DEFAULT now(),
    updated_at                timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT parties_signer_iin_complete CHECK (
        (signer_iin_enc IS NULL) = (signer_iin_hash IS NULL) AND (signer_iin_hash IS NULL) = (signer_iin_last4 IS NULL)
    ),
    -- ТОО подписывает директор: ФИО и ИИН обязательны; у остальных ИИН подписанта пуст.
    CONSTRAINT parties_too_signer CHECK (
        CASE WHEN legal_form = 'TOO'
            THEN signer_full_name IS NOT NULL AND signer_iin_enc IS NOT NULL
            ELSE signer_iin_enc IS NULL
        END
    ),
    CONSTRAINT parties_payout_iban_complete CHECK ((payout_iban_enc IS NULL) = (payout_iban_last4 IS NULL))
);

-- +goose Down
DROP TABLE parties;
