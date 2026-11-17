package internal

import (
	"bytes"
	"context"
	"errors"
	"fmt"
	"slices"
	"strings"

	"connectrpc.com/connect/v2"
	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgtype"

	identityv1 "github.com/CemeteryPlaya/senim-platform/gen/go/senim/identity/v1"
	"github.com/CemeteryPlaya/senim-platform/gen/go/senim/identity/v1/identityv1connect"
	"github.com/CemeteryPlaya/senim-platform/pkg/config"
	"github.com/CemeteryPlaya/senim-platform/pkg/pii"
	"github.com/CemeteryPlaya/senim-platform/services/identity/internal/store"
)

// maxSeedUsers — предел числа пользователей в одном SeedUsers, maxSeedConsents — согласий в
// одном SeedConsents.
const (
	maxSeedUsers    = 200
	maxSeedConsents = 500
)

// standDisabled — отказ методов стенда (SeedUsers, SeedConsents, ResetStand) при APP_ENV=prod.
func standDisabled() error {
	return rpcError(connect.CodeFailedPrecondition, "stand_disabled", nil)
}

func userNotFound() error { return rpcError(connect.CodeNotFound, "user_not_found", nil) }

func invalidRequest() error { return rpcError(connect.CodeInvalidArgument, "invalid_request", nil) }

// standGate — общее начало методов стенда: вызывающий — web, затем окружение. Демо-режима
// нет; стенд — любое окружение, кроме prod. Разрешены только dev и staging (пустое значение —
// тоже отказ, безопасное умолчание); иначе stand_disabled, и база не затрагивается.
func (s *Service) standGate(ctx context.Context) error {
	if err := requireCaller(ctx, webCaller); err != nil {
		return err
	}
	if !s.standEnv() {
		return standDisabled()
	}
	return nil
}

// standEnv — окружение стенда: dev или staging. Не prod и не пустое значение (безопасное
// умолчание). Решает сид, сброс стенда и показ кода на экране.
func (s *Service) standEnv() bool {
	return s.cfg.Env == config.Dev || s.cfg.Env == config.Staging
}

// seedRow — проверенная запись сида.
type seedRow struct {
	phone, defaultRole string
	roles              []string
	createdAt          pgtype.Timestamptz
	// Личность (persons); пустое поле — не задано.
	fullName, iin, instagram, email string
	// Сторона (parties); nil — не задана.
	party *seedParty
	// Согласие на обработку ПДн (версия и SHA-256 текста); пустая версия — согласия нет.
	consentVersion string
	consentSum     []byte
	// Секрет TOTP оператора стенда; nil — фактор не меняется.
	totpSecret []byte
}

// seedParty — проверенная сторона сида: реквизиты, счёт выплаты (пусто — не указан) и
// состояние KYC с файлами и причиной отказа.
type seedParty struct {
	in                      partyInput
	payoutIBAN              string
	kycStatus               string
	kycIDFiles, kycRegFiles []string
	kycRejectReason         string
}

// hasPerson — в записи сида есть хотя бы одно поле личности.
func (r seedRow) hasPerson() bool {
	return r.fullName != "" || r.iin != "" || r.instagram != "" || r.email != ""
}

// validateSeedPerson проверяет поля личности сида теми же правилами, что RecordPerson и
// UpdateContacts; пустое поле — не задано.
func validateSeedPerson(u *identityv1.SeedUser, row *seedRow) error {
	if raw := u.GetFullName(); raw != "" {
		row.fullName = normalizeFullName(raw)
		if !validFullName(row.fullName) {
			return fullNameInvalid()
		}
	}
	if iin := u.GetIin(); iin != "" {
		if !validIIN(iin) {
			return iinInvalid()
		}
		row.iin = iin
	}
	instagram, tooLong, ok := checkInstagram(u.GetInstagram())
	if !ok {
		return instagramInvalid(tooLong)
	}
	row.instagram = instagram
	email, ok := normalizeEmail(u.GetEmail())
	if !ok {
		return emailInvalid()
	}
	row.email = email
	return nil
}

// validateSeedParty проверяет сторону сида теми же правилами, что ProvisionExecutor и
// SetPayoutIban. Сторона — только у исполнителя (роль EXECUTOR в roles). ИП и самозанятый
// без bin_iin работают по ИИН личности сида (как RegisterParty); его нет — person_missing.
func validateSeedParty(sp *identityv1.SeedParty, row *seedRow) error {
	if !slices.Contains(row.roles, executorRole) {
		return invalidRequest()
	}
	own := sp.GetBinIin() == "" && sp.GetLegalForm() != identityv1.LegalForm_LEGAL_FORM_TOO
	in, err := checkParty(sp.GetLegalForm(), sp.GetLegalName(), sp.GetBinIin(), sp.GetSignerFullName(), sp.GetSignerIin(), own)
	if err != nil {
		return err
	}
	if own {
		if row.iin == "" {
			return personMissing()
		}
		in.binIIN = row.iin
	}
	party := &seedParty{in: in, kycStatus: "NOT_SUBMITTED"}
	if raw := sp.GetPayoutIban(); raw != "" {
		iban, reason, ok := parseKzIban(raw)
		if !ok {
			return ibanInvalid(reason)
		}
		party.payoutIBAN = iban
	}
	if st := sp.GetKycStatus(); st != identityv1.KycStatus_KYC_STATUS_UNSPECIFIED {
		name, known := identityv1.KycStatus_name[int32(st)]
		if !known {
			return invalidRequest()
		}
		party.kycStatus = strings.TrimPrefix(name, "KYC_STATUS_")
	}
	if err := validateSeedKyc(sp, party); err != nil {
		return err
	}
	row.party = party
	return nil
}

// validateSeedKyc проверяет файлы и причину отказа KYC стороны сида правилами SubmitKyc и
// ReviewKyc: файлы — UUID, не больше kycMaxFiles каждого вида (invalid_request), и только при
// поданных документах (у NOT_SUBMITTED файлов нет — invalid_request); причина — только у
// REJECTED и обязательна там: 3–500 символов (kyc_reason_invalid).
func validateSeedKyc(sp *identityv1.SeedParty, party *seedParty) error {
	idFiles, ok := kycFileIDs(sp.GetKycIdFileIds())
	if !ok {
		return invalidRequest()
	}
	regFiles, ok := kycFileIDs(sp.GetKycRegistrationFileIds())
	if !ok {
		return invalidRequest()
	}
	if party.kycStatus == "NOT_SUBMITTED" && (len(idFiles) > 0 || len(regFiles) > 0) {
		return invalidRequest()
	}
	party.kycIDFiles, party.kycRegFiles = idFiles, regFiles
	raw := sp.GetKycRejectReason()
	if party.kycStatus != "REJECTED" {
		if raw != "" {
			return invalidRequest()
		}
		return nil
	}
	reason, ok := kycReason(raw)
	if !ok {
		return kycReasonInvalid()
	}
	party.kycRejectReason = reason
	return nil
}

// seedPartyRow пишет сторону пользователя сида целиком (повтор сида перезаписывает её).
// Номера — шифртекстом под текущим ключом; ИИН/БИН, занятый другим, — iin_taken. Время
// подачи и проверки KYC — сейчас, если состояние их предполагает.
func (s *Service) seedPartyRow(ctx context.Context, q *store.Queries, userID uuid.UUID, sp *seedParty, now pgtype.Timestamptz) error {
	in := sp.in
	binEnc, err := s.cfg.PII.Seal([]byte(in.binIIN), partyBinIINAAD(userID))
	if err != nil {
		return fmt.Errorf("шифрование ИИН/БИН: %w", err)
	}
	params := store.UpsertSeedPartyParams{
		UserID: userID, LegalForm: in.legalForm, LegalName: in.legalName,
		BinIinEnc: binEnc, BinIinHash: s.cfg.PIIIndex.Of(pii.DomainBINIIN, in.binIIN), BinIinLast4: pii.Last4(in.binIIN),
		SignerFullName: text(in.signerName), KycStatus: sp.kycStatus, KycRejectReason: text(sp.kycRejectReason),
		KycIDFileIds: sp.kycIDFiles, KycRegistrationFileIds: sp.kycRegFiles, Now: now,
	}
	if in.signerIIN != "" {
		enc, err := s.cfg.PII.Seal([]byte(in.signerIIN), partySignerIINAAD(userID))
		if err != nil {
			return fmt.Errorf("шифрование ИИН подписанта: %w", err)
		}
		params.SignerIinEnc, params.SignerIinHash, params.SignerIinLast4 = text(enc), s.signerHash(in), text(pii.Last4(in.signerIIN))
	}
	if sp.payoutIBAN != "" {
		enc, err := s.cfg.PII.Seal([]byte(sp.payoutIBAN), partyPayoutIBANAAD(userID))
		if err != nil {
			return fmt.Errorf("шифрование IBAN: %w", err)
		}
		params.PayoutIbanEnc, params.PayoutIbanLast4 = text(enc), text(pii.Last4(sp.payoutIBAN))
	}
	if sp.kycStatus != "NOT_SUBMITTED" {
		params.KycSubmittedAt = now
	}
	if sp.kycStatus == "VERIFIED" || sp.kycStatus == "REJECTED" {
		params.KycReviewedAt = now
	}
	_, err = q.UpsertSeedParty(ctx, params)
	if isUniqueViolation(err, partyBinIINConstraint) {
		return iinTaken()
	}
	return err
}

// seedPerson пишет личность пользователя сида: заданные поля перезаписываются, остальные
// остаются. ИИН — шифртекстом, со слепым индексом; занятый другим — iin_taken.
func (s *Service) seedPerson(ctx context.Context, q *store.Queries, userID uuid.UUID, r seedRow, now pgtype.Timestamptz) error {
	params := store.UpsertSeedPersonParams{
		UserID: userID, FullName: text(r.fullName), Instagram: text(r.instagram), Email: text(r.email), Now: now,
		// Адрес сида подтверждён (спека редизайна, раздел 8): люди стенда не проходят шаг почты.
		EmailVerifiedAt: pgtype.Timestamptz{Time: now.Time, Valid: r.email != ""},
	}
	if r.iin != "" {
		enc, err := s.cfg.PII.Seal([]byte(r.iin), personIINAAD(userID))
		if err != nil {
			return fmt.Errorf("шифрование ИИН: %w", err)
		}
		params.IinEnc, params.IinHash, params.IinLast4 = text(enc), s.cfg.PIIIndex.Of(pii.DomainIIN, r.iin), text(pii.Last4(r.iin))
	}
	_, err := q.UpsertSeedPerson(ctx, params)
	if isUniqueViolation(err, personIINConstraint) {
		return iinTaken()
	}
	return err
}

// validateSeedConsent проверяет согласие сида: версия и хеш текста заданы вместе
// (invalid_request) и по правилам GrantConsent (consent_version_invalid); оба пусты —
// согласия нет.
func validateSeedConsent(u *identityv1.SeedUser, row *seedRow) error {
	version, sum := u.GetConsentVersion(), u.GetConsentTextSha256()
	if version == "" && sum == "" {
		return nil
	}
	if version == "" || sum == "" {
		return invalidRequest()
	}
	b, err := consentProof(version, sum)
	if err != nil {
		return err
	}
	row.consentVersion, row.consentSum = version, b
	return nil
}

// validateSeed разбирает и проверяет пользователей запроса в Go: ограничения базы (роли
// известны, роль по умолчанию выдана, оператор и замерщик одни) остаются второй линией.
func validateSeed(users []*identityv1.SeedUser) ([]seedRow, error) {
	if len(users) == 0 || len(users) > maxSeedUsers {
		return nil, invalidRequest()
	}
	rows := make([]seedRow, 0, len(users))
	seen := make(map[string]struct{}, len(users))
	for _, u := range users {
		phone, ok := parsePhone(u.GetPhone())
		if !ok {
			return nil, rpcError(connect.CodeInvalidArgument, "invalid_phone", nil)
		}
		if _, dup := seen[phone]; dup {
			return nil, invalidRequest()
		}
		seen[phone] = struct{}{}

		var roles []string
		for _, r := range u.GetRoles() {
			name, ok := roleName(r)
			if !ok {
				return nil, invalidRequest()
			}
			if !slices.Contains(roles, name) {
				roles = append(roles, name)
			}
		}
		def, ok := roleName(u.GetDefaultRole())
		if !ok || !slices.Contains(roles, def) {
			return nil, invalidRequest()
		}
		if (slices.Contains(roles, "OPERATOR") || slices.Contains(roles, "MEASURER")) && len(roles) != 1 {
			return nil, invalidRequest()
		}
		row := seedRow{phone: phone, defaultRole: def, roles: roles}
		if u.GetCreatedAt() != nil {
			row.createdAt = ts(u.GetCreatedAt().AsTime())
		}
		if err := validateSeedPerson(u, &row); err != nil {
			return nil, err
		}
		if sp := u.GetParty(); sp != nil {
			if err := validateSeedParty(sp, &row); err != nil {
				return nil, err
			}
		}
		if err := validateSeedConsent(u, &row); err != nil {
			return nil, err
		}
		if raw := u.GetTotpSecretBase32(); raw != "" {
			secret, ok := seedTotpSecret(raw, roles)
			if !ok {
				return nil, invalidRequest()
			}
			row.totpSecret = secret
		}
		rows = append(rows, row)
	}
	return rows, nil
}

// Пределы длины секрета TOTP сида в байтах: не короче 128 бит (RFC 4226), не длиннее 512.
const (
	minSeedTotpSecret = 16
	maxSeedTotpSecret = 64
)

// seedTotpSecret разбирает секрет TOTP сида: только у оператора (оператор не совмещается с
// другими ролями — проверено раньше), base32 без «=» (как отдаёт StartTotpEnrollment; регистр
// не важен), 16–64 байт.
func seedTotpSecret(raw string, roles []string) ([]byte, bool) {
	if !slices.Contains(roles, mfaRole) {
		return nil, false
	}
	secret, err := totpBase32.DecodeString(strings.ToUpper(raw))
	if err != nil || len(secret) < minSeedTotpSecret || len(secret) > maxSeedTotpSecret {
		return nil, false
	}
	return secret, true
}

// seedMfaFactor подключает оператору стенда второй фактор известным секретом: шифртекст тем
// же ключом и AAD, что у StartTotpEnrollment, фактор сразу подтверждён (как после
// ConfirmTotpEnrollment). Отметки второго фактора в сессиях пользователя снимаются — как при
// mfa-reset: прежний секрет больше не действует.
func (s *Service) seedMfaFactor(ctx context.Context, q *store.Queries, userID uuid.UUID, secret []byte, now pgtype.Timestamptz) error {
	enc, err := s.cfg.PII.Seal(secret, mfaSecretAAD(userID))
	if err != nil {
		return fmt.Errorf("шифрование секрета TOTP: %w", err)
	}
	if err := q.UpsertSeedMfaFactor(ctx, store.UpsertSeedMfaFactorParams{UserID: userID, SecretEnc: enc, Now: now}); err != nil {
		return err
	}
	_, err = q.ClearUserSessionsMfa(ctx, userID)
	return err
}

// SeedUsers — upsert пользователей стенда по телефону в одной транзакции: каждый помечается
// seeded; существующему обновляются роли, роль по умолчанию, created_at (если задан),
// блокировка снимается; id остаётся прежним. Личность (full_name, iin, instagram, email)
// пишется, если задано хотя бы одно поле; сторона (party) — целиком, со счётом выплаты и
// состоянием KYC; согласие на обработку ПДн (consent_version и consent_text_sha256) —
// действующая запись канала seed, если такой версии ещё нет; секрет TOTP оператора
// (totp_secret_base32) — подключённый второй фактор. Ответ — в порядке запроса.
// Телефон человека, созданного не сидом (seeded = false), — весь сид отклоняется
// (invalid_request): сид не перезаписывает настоящих людей, и сброс стенда их не трогает.
//
// Ни аудита, ни событий: это данные стенда (вне prod), не рабочие учётные записи.
func (s *Service) SeedUsers(ctx context.Context, req *identityv1.SeedUsersRequest) (*identityv1.SeedUsersResponse, error) {
	if err := s.standGate(ctx); err != nil {
		return nil, err
	}
	if !validIdempotencyKey(req.GetIdempotencyKey()) {
		return nil, invalidRequest()
	}
	rows, err := validateSeed(req.GetUsers())
	if err != nil {
		return nil, err
	}
	resp := &identityv1.SeedUsersResponse{}
	err = s.idempotent(ctx, "seed_users", identityv1connect.IdentityServiceSeedUsersProcedure, req.GetIdempotencyKey(), req, resp, func(tx pgx.Tx) error {
		q := store.New(tx)
		now := ts(s.now())
		for _, r := range rows {
			u, err := q.UpsertSeedUser(ctx, store.UpsertSeedUserParams{
				Phone: r.phone, Roles: r.roles, DefaultRole: r.defaultRole,
				CreatedAt: r.createdAt, Now: now,
			})
			if errors.Is(err, pgx.ErrNoRows) {
				// Телефон настоящего пользователя (seeded = false): засеянным он не становится —
				// иначе сброс стенда считал бы его данные данными сида.
				return invalidRequest()
			}
			if err != nil {
				return err
			}
			if r.hasPerson() {
				if err := s.seedPerson(ctx, q, u.ID, r, now); err != nil {
					return err
				}
			}
			if r.party != nil {
				if err := s.seedPartyRow(ctx, q, u.ID, r.party, now); err != nil {
					return err
				}
			}
			if r.consentVersion != "" {
				err := q.SeedConsent(ctx, store.SeedConsentParams{UserID: u.ID, Version: r.consentVersion, TextSha256: r.consentSum, GrantedAt: now})
				if err != nil {
					return err
				}
			}
			if r.totpSecret != nil {
				if err := s.seedMfaFactor(ctx, q, u.ID, r.totpSecret, now); err != nil {
					return err
				}
			}
			resp.Users = append(resp.Users, userProto(u))
		}
		return nil
	})
	if err != nil {
		return nil, err
	}
	return resp, nil
}

// seedConsentRow — проверенное согласие SeedConsents.
type seedConsentRow struct {
	userID             uuid.UUID
	kind, version, ref string
	sum                []byte
}

// validateSeedConsents разбирает согласия SeedConsents по правилам GrantConsent: 1–500
// записей, user_id — UUID, вид указан, предмет по правилам вида (invalid_request); версия и
// SHA-256 текста — consent_version_invalid.
func validateSeedConsents(raw []*identityv1.SeedConsent) ([]seedConsentRow, error) {
	if len(raw) == 0 || len(raw) > maxSeedConsents {
		return nil, invalidRequest()
	}
	rows := make([]seedConsentRow, 0, len(raw))
	for _, c := range raw {
		id, err := uuid.Parse(c.GetUserId())
		if err != nil || len(c.GetUserId()) != 36 {
			return nil, invalidRequest()
		}
		kind, ok := consentKindName(c.GetKind())
		if !ok || !validConsentReference(kind, c.GetReferenceId()) {
			return nil, invalidRequest()
		}
		sum, err := consentProof(c.GetVersion(), c.GetTextSha256())
		if err != nil {
			return nil, err
		}
		rows = append(rows, seedConsentRow{userID: id, kind: kind, version: c.GetVersion(), ref: c.GetReferenceId(), sum: sum})
	}
	return rows, nil
}

// SeedConsents — согласия стенда (канал seed, без сессии и целей): например, передача банку к
// сделке сида, которую сид оплачивает без входа сторон. Только вне prod и вызывающий web
// (standGate). Пользователь должен существовать (user_not_found) и быть засеянным (иначе invalid_request:
// настоящему человеку на стенде сид согласий не пишет). Действующее согласие той же версии и предмета уже есть — без новой записи; та же
// версия с другим текстом — consent_version_invalid (как GrantConsent). Всё или ничего — одна
// транзакция.
//
// Ни аудита, ни событий, как у SeedUsers: это данные стенда, а не согласия людей.
func (s *Service) SeedConsents(ctx context.Context, req *identityv1.SeedConsentsRequest) (*identityv1.SeedConsentsResponse, error) {
	if err := s.standGate(ctx); err != nil {
		return nil, err
	}
	if !validIdempotencyKey(req.GetIdempotencyKey()) {
		return nil, invalidRequest()
	}
	rows, err := validateSeedConsents(req.GetConsents())
	if err != nil {
		return nil, err
	}
	resp := &identityv1.SeedConsentsResponse{}
	err = s.idempotent(ctx, "seed_consents", identityv1connect.IdentityServiceSeedConsentsProcedure, req.GetIdempotencyKey(), req, resp, func(tx pgx.Tx) error {
		q := store.New(tx)
		now := ts(s.now())
		known := make(map[uuid.UUID]bool, len(rows))
		for _, r := range rows {
			if !known[r.userID] {
				u, err := q.GetUserByID(ctx, r.userID)
				if errors.Is(err, pgx.ErrNoRows) {
					return userNotFound()
				} else if err != nil {
					return err
				}
				// Только люди сида: настоящему человеку на стенде сид не пишет неудаляемое согласие (как SeedUsers
				// отказывает по телефону незасеянного).
				if !u.Seeded {
					return invalidRequest()
				}
				known[r.userID] = true
			}
			existing, err := q.GetActiveConsent(ctx, store.GetActiveConsentParams{UserID: r.userID, Kind: r.kind, Version: r.version, ReferenceID: r.ref})
			switch {
			case err == nil:
				if !bytes.Equal(existing.TextSha256, r.sum) {
					return consentVersionInvalid()
				}
				continue
			case !errors.Is(err, pgx.ErrNoRows):
				return err
			}
			if _, err := q.InsertConsent(ctx, store.InsertConsentParams{
				UserID: r.userID, Kind: r.kind, Version: r.version, TextSha256: r.sum, Purposes: []string{},
				ReferenceID: r.ref, Channel: channelSeed, GrantedAt: now,
			}); err != nil {
				return err
			}
		}
		return nil
	})
	if err != nil {
		return nil, err
	}
	return resp, nil
}

// ResetStand чистит одноразовое и временное состояние стенда: коды (SMS и e-mail), счётчики
// лимитов, сессии, вторые факторы засеянных пользователей (повторный прогон e2e подключает
// TOTP заново или получает секрет сида, а не упирается в mfa_already_enrolled), согласия и
// заявки на отзыв засеянных (по признаку seeded записи; функция identity_purge_seeded_consents,
// миграция 0012) и сохранённые ответы идемпотентности (иначе повтор вернул бы вход с уже
// несуществующей сессией). Пользователи остаются. Только вне prod и только web (standGate);
// из интерфейса не вызывается — только сид из терминала. Сам вызов остаётся идемпотентным:
// запись его ключа в idempotency не удаляется, а ответ сохраняется после очистки.
func (s *Service) ResetStand(ctx context.Context, req *identityv1.ResetStandRequest) (*identityv1.ResetStandResponse, error) {
	if err := s.standGate(ctx); err != nil {
		return nil, err
	}
	if !validIdempotencyKey(req.GetIdempotencyKey()) {
		return nil, invalidRequest()
	}
	const method = identityv1connect.IdentityServiceResetStandProcedure
	resp := &identityv1.ResetStandResponse{}
	err := s.idempotent(ctx, "reset_stand", method, req.GetIdempotencyKey(), req, resp, func(tx pgx.Tx) error {
		q := store.New(tx)
		if _, err := q.DeleteAllSessions(ctx); err != nil {
			return err
		}
		if _, err := q.DeleteAllOtpCodes(ctx); err != nil {
			return err
		}
		if _, err := q.DeleteAllEmailCodes(ctx); err != nil {
			return err
		}
		if _, err := q.DeleteAllRateLimits(ctx); err != nil {
			return err
		}
		if _, err := q.DeleteSeededMfaFactors(ctx); err != nil {
			return err
		}
		// Согласия и заявки на отзыв засеянных (иначе повторный e2e получает прежнюю заявку);
		// SeedUsers после сброса пишет согласие сида заново.
		if _, err := q.PurgeSeededConsents(ctx); err != nil {
			return err
		}
		_, err := q.DeleteIdempotencyExcept(ctx, store.DeleteIdempotencyExceptParams{Method: method, Key: req.GetIdempotencyKey()})
		return err
	})
	if err != nil {
		return nil, err
	}
	return resp, nil
}
