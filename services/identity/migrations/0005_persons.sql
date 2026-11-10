-- +goose Up

-- Данные человека (ADR-013, план 2б): ФИО, ИИН, Instagram, e-mail. Строка появляется при
-- первой записи личности или контактов.
--
-- ИИН — только шифртекст pkg/pii (AAD "identity.persons.iin:<user_id>"), слепой индекс
-- HMAC (домен "iin") для уникальности и поиска без расшифровки и последние 4 цифры для
-- показа. Один ИИН — один человек: уникальный iin_hash; конфликт 23505 сервис отвечает
-- кодом iin_taken. Три столбца ИИН заданы вместе или пусты вместе.
CREATE TABLE persons (
    user_id    uuid PRIMARY KEY REFERENCES users (id),
    full_name  text,
    iin_enc    text,
    iin_hash   bytea UNIQUE,
    iin_last4  text,
    instagram  text,
    email      text,
    updated_at timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT persons_iin_complete CHECK (
        (iin_enc IS NULL) = (iin_hash IS NULL) AND (iin_hash IS NULL) = (iin_last4 IS NULL)
    )
);

-- +goose Down
DROP TABLE persons;
