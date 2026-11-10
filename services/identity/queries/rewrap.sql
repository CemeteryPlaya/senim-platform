-- Ключи шифртекстов ПДн (kid — второе поле «v2.<kid>.…»). Проверка при старте serve:
-- каждый kid должен быть в PII_KEKS. Столбцы — все *_enc таблиц persons, parties,
-- mfa_factors (тот же список обходит identity rewrap-pii).
-- name: ListPIIKIDs :many
SELECT DISTINCT kid::text FROM (
    SELECT split_part(iin_enc, '.', 2) AS kid FROM persons WHERE iin_enc IS NOT NULL
    UNION ALL
    SELECT split_part(bin_iin_enc, '.', 2) FROM parties
    UNION ALL
    SELECT split_part(signer_iin_enc, '.', 2) FROM parties WHERE signer_iin_enc IS NOT NULL
    UNION ALL
    SELECT split_part(payout_iban_enc, '.', 2) FROM parties WHERE payout_iban_enc IS NOT NULL
    UNION ALL
    SELECT split_part(secret_enc, '.', 2) FROM mfa_factors
) k
ORDER BY 1;

-- Пачка личностей, чей ИИН зашифрован не текущим ключом, после user_id = @after (обход
-- по возрастанию user_id: повреждённая строка, которую не перешифровать, не попадает в
-- следующую пачку); строки блокируются до конца транзакции пачки.
-- name: PersonsToRewrap :many
SELECT user_id, iin_enc FROM persons
WHERE iin_enc IS NOT NULL AND split_part(iin_enc, '.', 2) <> @kid::text AND user_id > @after
ORDER BY user_id
LIMIT @batch
FOR UPDATE;

-- name: SetPersonIINEnc :exec
UPDATE persons SET iin_enc = @iin_enc WHERE user_id = @user_id;

-- name: PartiesToRewrap :many
SELECT user_id, bin_iin_enc, signer_iin_enc, payout_iban_enc FROM parties
WHERE user_id > @after AND (
    split_part(bin_iin_enc, '.', 2) <> @kid::text
    OR (signer_iin_enc IS NOT NULL AND split_part(signer_iin_enc, '.', 2) <> @kid::text)
    OR (payout_iban_enc IS NOT NULL AND split_part(payout_iban_enc, '.', 2) <> @kid::text)
)
ORDER BY user_id
LIMIT @batch
FOR UPDATE;

-- name: SetPartyEnc :exec
UPDATE parties SET bin_iin_enc = @bin_iin_enc, signer_iin_enc = sqlc.narg('signer_iin_enc'),
    payout_iban_enc = sqlc.narg('payout_iban_enc')
WHERE user_id = @user_id;

-- name: MfaFactorsToRewrap :many
SELECT user_id, secret_enc FROM mfa_factors
WHERE split_part(secret_enc, '.', 2) <> @kid::text AND user_id > @after
ORDER BY user_id
LIMIT @batch
FOR UPDATE;

-- name: SetMfaSecretEnc :exec
UPDATE mfa_factors SET secret_enc = @secret_enc WHERE user_id = @user_id;
