package internal

import (
	"bytes"
	"context"
	"crypto/sha256"
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
	"github.com/CemeteryPlaya/senim-platform/pkg/pii"
	"github.com/CemeteryPlaya/senim-platform/services/identity/internal/store"
)

// maxSeedUsers — предел числа пользователей в одном SeedUsers, maxSeedConsents — согласий в
// одном SeedConsents.
const (
	maxSeedUsers    = 200
	maxSeedConsents = 500
)

func demoDisabled() error {
	return rpcError(connect.CodeFailedPrecondition, "demo_disabled", nil)
}

func userNotFound() error { return rpcError(connect.CodeNotFound, "user_not_found", nil) }

func invalidRequest() error { return rpcError(connect.CodeInvalidArgument, "invalid_request", nil) }

// demoGate — общее начало демо-методов: вызывающий — web, затем режим. Без DemoMode база
// не затрагивается.
func (s *Service) demoGate(ctx context.Context) error {
	if err := requireCaller(ctx, webCaller); err != nil {
		return err
	}
	if !s.cfg.DemoMode {
		return demoDisabled()
	}
	return nil
}

// seedRow — проверенная запись сида.
type seedRow struct {
	phone, defaultRole string
	roles              []string
	isDemo             bool
	createdAt          pgtype.Timestamptz
	// Личность (persons); пустое поле — не задано.
	fullName, iin, instagram, email string
	// Сторона (parties); nil — не задана.
	party *seedParty
	// Согласие на обработку ПДн (версия и SHA-256 текста); пустая версия — согласия нет.
	consentVersion string
	consentSum     []byte
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
		row := seedRow{phone: phone, defaultRole: def, roles: roles, isDemo: u.GetIsDemo()}
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
		rows = append(rows, row)
	}
	return rows, nil
}

// SeedUsers — upsert пользователей по телефону в одной транзакции: существующему
// обновляются роли, роль по умолчанию, is_demo, created_at (если задан), блокировка
// снимается; id остаётся прежним. Личность (full_name, iin, instagram, email) пишется,
// если задано хотя бы одно поле; сторона (party) — целиком, со счётом выплаты и состоянием
// KYC; согласие на обработку ПДн (consent_version и consent_text_sha256) — действующая
// запись канала seed, если такой версии ещё нет. Ответ — в порядке запроса.
// is_demo существующего пользователя не поднимается с false на true: такой сид целиком
// отклоняется (invalid_request) — настоящий человек не становится демо-персоной, и сброс
// демо не трогает его данные. Опустить is_demo (true → false) можно.
//
// Ни аудита, ни событий: это данные демо-стенда (DemoMode), не рабочие учётные записи.
func (s *Service) SeedUsers(ctx context.Context, req *identityv1.SeedUsersRequest) (*identityv1.SeedUsersResponse, error) {
	if err := s.demoGate(ctx); err != nil {
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
				Phone: r.phone, Roles: r.roles, DefaultRole: r.defaultRole, IsDemo: r.isDemo,
				CreatedAt: r.createdAt, Now: now,
			})
			if errors.Is(err, pgx.ErrNoRows) {
				// Телефон настоящего пользователя (is_demo = false) в демо-сиде: демо он не
				// становится — иначе сброс демо считал бы его данные демо-данными.
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

// SeedConsents — согласия демо-стенда (канал seed, без сессии и целей): например, передача
// банку к демо-сделке, которую сид оплачивает без входа сторон. Только DemoMode и вызывающий
// web (demoGate). Пользователь должен существовать (user_not_found; признак демо не
// требуется — в сделках сида есть заказчики вне демо-входа, Ruling AG). Действующее согласие
// той же версии и предмета уже есть — без новой записи; та же версия с другим текстом —
// consent_version_invalid (как GrantConsent). Всё или ничего — одна транзакция.
//
// Ни аудита, ни событий, как у SeedUsers: это данные демо-стенда, а не согласия людей.
func (s *Service) SeedConsents(ctx context.Context, req *identityv1.SeedConsentsRequest) (*identityv1.SeedConsentsResponse, error) {
	if err := s.demoGate(ctx); err != nil {
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
				if _, err := q.GetUserByID(ctx, r.userID); errors.Is(err, pgx.ErrNoRows) {
					return userNotFound()
				} else if err != nil {
					return err
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

// StartDemoSession начинает сессию демо-персоны. Нет пользователя, он не демо или
// заблокирован — один и тот же отказ user_not_found: метод не показывает, кто есть.
// Роль as_role должна быть выдана (createSession этого не проверяет).
func (s *Service) StartDemoSession(ctx context.Context, req *identityv1.StartDemoSessionRequest) (*identityv1.StartDemoSessionResponse, error) {
	if err := s.demoGate(ctx); err != nil {
		return nil, err
	}
	if !validSessionToken(req.GetSessionToken()) {
		return nil, rpcError(connect.CodeInvalidArgument, "session_token_invalid", nil)
	}
	if !validIdempotencyKey(req.GetIdempotencyKey()) {
		return nil, invalidRequest()
	}
	asRole := ""
	if req.GetAsRole() != identityv1.Role_ROLE_UNSPECIFIED {
		name, ok := roleName(req.GetAsRole())
		if !ok {
			return nil, invalidRequest()
		}
		asRole = name
	}
	userID, err := uuid.Parse(req.GetUserId())
	if err != nil {
		return nil, userNotFound()
	}

	resp := &identityv1.StartDemoSessionResponse{}
	err = s.idempotent(ctx, "start_demo_session", identityv1connect.IdentityServiceStartDemoSessionProcedure, req.GetIdempotencyKey(), req, resp, func(tx pgx.Tx) error {
		q := store.New(tx)
		user, err := q.GetUserByID(ctx, userID)
		if errors.Is(err, pgx.ErrNoRows) || (err == nil && (!user.IsDemo || user.BlockedAt.Valid)) {
			return userNotFound()
		}
		if err != nil {
			return err
		}
		if asRole != "" && !slices.Contains(user.Roles, asRole) {
			return rpcError(connect.CodePermissionDenied, "role_not_granted", nil)
		}
		// Токен уже у другой сессии (новый ключ, старый токен): как в VerifyOtp.
		sum := sha256.Sum256([]byte(req.GetSessionToken()))
		taken, err := q.SessionTokenExists(ctx, sum[:])
		if err != nil {
			return err
		}
		if taken {
			return rpcError(connect.CodeInvalidArgument, "session_token_invalid", nil)
		}
		now := s.now()
		sess, err := createSession(ctx, tx, user, req.GetSessionToken(), req.GetUserAgent(), asRole, now)
		if err != nil {
			return err
		}
		// Демо-оператор считается прошедшим вторую ступень: у демо-персон нет телефона с
		// приложением, а сценарии оператора идут сразу в кабинет (только DEMO_MODE).
		if sess.ActiveRole == mfaRole {
			if sess, err = q.SetSessionMfaVerified(ctx, store.SetSessionMfaVerifiedParams{At: ts(now), ID: sess.ID}); err != nil {
				return err
			}
		}
		resp.User = userProto(user)
		resp.Session = sessionProto(sess, idleTimeout)
		return nil
	})
	if err != nil {
		return nil, err
	}
	return resp, nil
}

// ResetDemo чистит одноразовое и временное состояние стенда: коды, счётчики лимитов,
// сессии, вторые факторы операторов (повторный прогон e2e подключает TOTP заново, а не
// упирается в mfa_already_enrolled), согласия и заявки на отзыв демо-пользователей (is_demo;
// функция identity_purge_demo_consents, миграция 0008) и сохранённые ответы идемпотентности (иначе повтор
// вернул бы вход с уже несуществующей сессией). Пользователи остаются. Только демо-стенд
// (demoGate). Сам вызов остаётся идемпотентным:
// запись его ключа в idempotency не удаляется, а ответ сохраняется после очистки.
func (s *Service) ResetDemo(ctx context.Context, req *identityv1.ResetDemoRequest) (*identityv1.ResetDemoResponse, error) {
	if err := s.demoGate(ctx); err != nil {
		return nil, err
	}
	if !validIdempotencyKey(req.GetIdempotencyKey()) {
		return nil, invalidRequest()
	}
	const method = identityv1connect.IdentityServiceResetDemoProcedure
	resp := &identityv1.ResetDemoResponse{}
	err := s.idempotent(ctx, "reset_demo", method, req.GetIdempotencyKey(), req, resp, func(tx pgx.Tx) error {
		q := store.New(tx)
		if _, err := q.DeleteAllSessions(ctx); err != nil {
			return err
		}
		if _, err := q.DeleteAllOtpCodes(ctx); err != nil {
			return err
		}
		if _, err := q.DeleteAllRateLimits(ctx); err != nil {
			return err
		}
		if _, err := q.DeleteAllMfaFactors(ctx); err != nil {
			return err
		}
		// Согласия и заявки на отзыв демо-пользователей (иначе повторный e2e получает прежнюю
		// заявку); SeedUsers после сброса пишет согласие сида заново.
		if _, err := q.PurgeDemoConsents(ctx); err != nil {
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
