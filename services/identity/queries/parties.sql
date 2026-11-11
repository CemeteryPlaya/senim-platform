-- name: GetParty :one
SELECT * FROM parties WHERE user_id = $1;

-- name: LockParty :one
SELECT * FROM parties WHERE user_id = $1 FOR UPDATE;

-- Новая сторона (RegisterParty, ProvisionExecutor). Тот же ИИН/БИН у другой стороны —
-- 23505 на parties_bin_iin_hash_key; сторона у пользователя уже есть — 23505 на
-- parties_pkey (сервис проверяет это под блокировкой пользователя раньше).
-- name: InsertParty :one
INSERT INTO parties (
    user_id, legal_form, legal_name, bin_iin_enc, bin_iin_hash, bin_iin_last4,
    signer_full_name, signer_iin_enc, signer_iin_hash, signer_iin_last4, created_at, updated_at
) VALUES (
    @user_id, @legal_form, @legal_name, @bin_iin_enc, @bin_iin_hash, @bin_iin_last4,
    sqlc.narg('signer_full_name'), sqlc.narg('signer_iin_enc'), sqlc.narg('signer_iin_hash'), sqlc.narg('signer_iin_last4'),
    @now, @now
)
RETURNING *;

-- Перезапись реквизитов стороны повторной анкетой (RegisterParty): только пока KYC не подана
-- или отклонена; счёт выплаты и KYC остаются. Тот же ИИН/БИН у другой стороны — 23505 на
-- parties_bin_iin_hash_key.
-- name: ReplaceParty :one
UPDATE parties SET
    legal_form = @legal_form, legal_name = @legal_name,
    bin_iin_enc = @bin_iin_enc, bin_iin_hash = @bin_iin_hash, bin_iin_last4 = @bin_iin_last4,
    signer_full_name = sqlc.narg('signer_full_name'), signer_iin_enc = sqlc.narg('signer_iin_enc'),
    signer_iin_hash = sqlc.narg('signer_iin_hash'), signer_iin_last4 = sqlc.narg('signer_iin_last4'),
    updated_at = @now
WHERE user_id = @user_id AND kyc_status IN ('NOT_SUBMITTED', 'REJECTED')
RETURNING *;

-- name: SetPartyPayoutIban :one
UPDATE parties SET payout_iban_enc = @payout_iban_enc, payout_iban_last4 = @payout_iban_last4, updated_at = @now
WHERE user_id = @user_id
RETURNING *;

-- Сид демо-стенда (SeedUsers): сторона пользователя перезаписывается целиком; файлы KYC
-- остаются.
-- name: UpsertSeedParty :one
INSERT INTO parties (
    user_id, legal_form, legal_name, bin_iin_enc, bin_iin_hash, bin_iin_last4,
    signer_full_name, signer_iin_enc, signer_iin_hash, signer_iin_last4, payout_iban_enc, payout_iban_last4,
    kyc_status, kyc_submitted_at, kyc_reviewed_at, created_at, updated_at
) VALUES (
    @user_id, @legal_form, @legal_name, @bin_iin_enc, @bin_iin_hash, @bin_iin_last4,
    sqlc.narg('signer_full_name'), sqlc.narg('signer_iin_enc'), sqlc.narg('signer_iin_hash'), sqlc.narg('signer_iin_last4'),
    sqlc.narg('payout_iban_enc'), sqlc.narg('payout_iban_last4'),
    @kyc_status, sqlc.narg('kyc_submitted_at'), sqlc.narg('kyc_reviewed_at'), @now, @now
)
ON CONFLICT (user_id) DO UPDATE SET
    legal_form        = EXCLUDED.legal_form,
    legal_name        = EXCLUDED.legal_name,
    bin_iin_enc       = EXCLUDED.bin_iin_enc,
    bin_iin_hash      = EXCLUDED.bin_iin_hash,
    bin_iin_last4     = EXCLUDED.bin_iin_last4,
    signer_full_name  = EXCLUDED.signer_full_name,
    signer_iin_enc    = EXCLUDED.signer_iin_enc,
    signer_iin_hash   = EXCLUDED.signer_iin_hash,
    signer_iin_last4  = EXCLUDED.signer_iin_last4,
    payout_iban_enc   = EXCLUDED.payout_iban_enc,
    payout_iban_last4 = EXCLUDED.payout_iban_last4,
    kyc_status        = EXCLUDED.kyc_status,
    kyc_reject_reason = NULL,
    kyc_submitted_at  = EXCLUDED.kyc_submitted_at,
    kyc_reviewed_at   = EXCLUDED.kyc_reviewed_at,
    updated_at        = EXCLUDED.updated_at
RETURNING *;
