package internal

import (
	"bytes"
	"context"
	"crypto/hmac"
	"errors"
	"fmt"
	"regexp"
	"slices"
	"strings"
	"time"

	"connectrpc.com/connect/v2"
	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"google.golang.org/protobuf/types/known/timestamppb"

	eventsv1 "github.com/CemeteryPlaya/senim-platform/gen/go/senim/events/v1"
	identityv1 "github.com/CemeteryPlaya/senim-platform/gen/go/senim/identity/v1"
	"github.com/CemeteryPlaya/senim-platform/gen/go/senim/identity/v1/identityv1connect"
	"github.com/CemeteryPlaya/senim-platform/pkg/outbox"
	"github.com/CemeteryPlaya/senim-platform/pkg/pii"
	"github.com/CemeteryPlaya/senim-platform/services/identity/internal/store"
)

// Реквизиты исполнителя — перенос из apps/web: правила анкеты — registration-schema.ts
// (executorRegistrationSchema, refineSigner, signerOf) и operator/schemas.ts
// (addExecutorSchema), регистрация — registration.ts, IBAN — iban.ts, счёт выплаты —
// payout.ts.

const (
	executorRole = "EXECUTOR"
	formTOOName  = "TOO"
	// Наименование стороны: 2–200 символов после обрезки пробелов (legalName в анкете).
	minLegalName = 2
	maxLegalName = 200
	// partyBinIINConstraint — уникальный индекс parties.bin_iin_hash (имя по умолчанию).
	partyBinIINConstraint = "parties_bin_iin_hash_key"
	// usersPhoneConstraint — уникальный индекс users.phone (имя по умолчанию).
	usersPhoneConstraint = "users_phone_key"
)

// AAD шифртекстов стороны: привязка к таблице, полю и пользователю.
func partyBinIINAAD(userID uuid.UUID) string { return "identity.parties.bin_iin:" + userID.String() }

func partySignerIINAAD(userID uuid.UUID) string {
	return "identity.parties.signer_iin:" + userID.String()
}

func partyPayoutIBANAAD(userID uuid.UUID) string {
	return "identity.parties.payout_iban:" + userID.String()
}

func binIinInvalid() error { return rpcError(connect.CodeInvalidArgument, "bin_iin_invalid", nil) }

func signerRequired() error { return rpcError(connect.CodeInvalidArgument, "signer_required", nil) }

func personMissing() error { return rpcError(connect.CodeFailedPrecondition, "person_missing", nil) }

func partyMissing() error { return rpcError(connect.CodeFailedPrecondition, "party_missing", nil) }

func partyExists() error { return rpcError(connect.CodeFailedPrecondition, "party_exists", nil) }

func roleForbidden() error { return rpcError(connect.CodePermissionDenied, "role_forbidden", nil) }

func roleNotGranted() error { return rpcError(connect.CodePermissionDenied, "role_not_granted", nil) }

func mfaRequired() error { return rpcError(connect.CodePermissionDenied, "mfa_required", nil) }

// ibanInvalid — неверный IBAN; params.reason — format или checksum (в web — разные тексты).
func ibanInvalid(reason string) error {
	return rpcError(connect.CodeInvalidArgument, "iban_invalid", map[string]string{"reason": reason})
}

// legalFormName — имя правовой формы в базе («LEGAL_FORM_IP» → «IP»); ok=false для
// UNSPECIFIED и неизвестных значений.
func legalFormName(f identityv1.LegalForm) (string, bool) {
	switch f {
	case identityv1.LegalForm_LEGAL_FORM_SELF_EMPLOYED:
		return "SELF_EMPLOYED", true
	case identityv1.LegalForm_LEGAL_FORM_IP:
		return "IP", true
	case identityv1.LegalForm_LEGAL_FORM_TOO:
		return formTOOName, true
	}
	return "", false
}

func legalFormProto(name string) identityv1.LegalForm {
	return identityv1.LegalForm(identityv1.LegalForm_value["LEGAL_FORM_"+name])
}

func kycStatusProto(name string) identityv1.KycStatus {
	return identityv1.KycStatus(identityv1.KycStatus_value["KYC_STATUS_"+name])
}

// withoutSpaces — номер как в форме: все пробелы убраны (digits в registration-schema.ts:
// v.replace(/\s/g, "")).
func withoutSpaces(s string) string {
	return strings.Map(func(r rune) rune {
		if jsSpace(r) {
			return -1
		}
		return r
	}, s)
}

// partyInput — проверенные реквизиты стороны. binIIN пуст, пока ИИН ИП или самозанятого
// не взят из личности (RegisterParty).
type partyInput struct {
	legalForm, legalName, binIIN, signerName, signerIIN string
}

// checkParty проверяет реквизиты по правилам анкеты исполнителя. ИИН/БИН — по форме
// работы (binIinKindFor): ТОО — БИН, ИП и самозанятый — ИИН. ownIIN — ИП и самозанятый
// работают по ИИН из знакомства (usesOwnIin): bin_iin запроса не читается. Подписант
// (refineSigner, signerOf): самозанятый — он сам (наименование — его ФИО), ИП — владелец
// (ФИО обязательно), ТОО — директор (ФИО и ИИН обязательны). ИИН подписанта у ИП и
// самозанятого не хранится: они подписывают ИИН стороны.
func checkParty(form identityv1.LegalForm, legalName, binIIN, signerName, signerIIN string, ownIIN bool) (partyInput, error) {
	name, ok := legalFormName(form)
	if !ok {
		return partyInput{}, invalidRequest()
	}
	in := partyInput{legalForm: name, legalName: strings.TrimFunc(legalName, jsSpace)}
	if n := jsLen(in.legalName); n < minLegalName || n > maxLegalName {
		return partyInput{}, invalidRequest()
	}
	if name == formTOOName || !ownIIN {
		in.binIIN = withoutSpaces(binIIN)
		valid := validIIN
		if name == formTOOName {
			valid = validBIN
		}
		if !valid(in.binIIN) {
			return partyInput{}, binIinInvalid()
		}
	}
	switch name {
	case "SELF_EMPLOYED":
		in.signerName = normalizeFullName(in.legalName)
	case "IP":
		in.signerName = normalizeFullName(signerName)
		if in.signerName == "" {
			return partyInput{}, signerRequired()
		}
	case formTOOName:
		in.signerName, in.signerIIN = normalizeFullName(signerName), withoutSpaces(signerIIN)
		if in.signerName == "" || in.signerIIN == "" {
			return partyInput{}, signerRequired()
		}
	}
	if !validFullName(in.signerName) {
		return partyInput{}, fullNameInvalid()
	}
	if in.signerIIN != "" && !validIIN(in.signerIIN) {
		return partyInput{}, iinInvalid()
	}
	return in, nil
}

// ibanFormat — казахстанский IBAN: «KZ», 2 контрольные цифры и 16 символов (iban.ts).
var ibanFormat = regexp.MustCompile(`^KZ[0-9]{2}[A-Z0-9]{16}$`)

// parseKzIban — IBAN как вводят из банковского приложения (пробелы, строчные буквы)
// приводится к виду KZ…; контроль ISO 13616 mod-97 (первые 4 символа — в конец, буквы —
// числами A = 10 … Z = 35, остаток 1). reason — format или checksum.
func parseKzIban(raw string) (iban, reason string, ok bool) {
	iban = strings.ToUpper(withoutSpaces(raw))
	if !ibanFormat.MatchString(iban) {
		return "", "format", false
	}
	rest := 0
	for _, ch := range iban[4:] + iban[:4] {
		if ch >= 'A' {
			rest = (rest*100 + int(ch-'A') + 10) % 97
		} else {
			rest = (rest*10 + int(ch-'0')) % 97
		}
	}
	if rest != 1 {
		return "", "checksum", false
	}
	return iban, "", true
}

// partyProto — сторона в ответах: номера только последними 4 символами.
func partyProto(p store.Party) *identityv1.Party {
	out := &identityv1.Party{
		UserId:                 p.UserID.String(),
		LegalForm:              legalFormProto(p.LegalForm),
		LegalName:              p.LegalName,
		BinIinLast4:            p.BinIinLast4,
		SignerFullName:         p.SignerFullName.String,
		SignerIinLast4:         p.SignerIinLast4.String,
		PayoutIbanLast4:        p.PayoutIbanLast4.String,
		KycStatus:              kycStatusProto(p.KycStatus),
		KycRejectReason:        p.KycRejectReason.String,
		KycIdFileIds:           p.KycIDFileIds,
		KycRegistrationFileIds: p.KycRegistrationFileIds,
	}
	if p.KycSubmittedAt.Valid {
		out.KycSubmittedAt = timestamppb.New(p.KycSubmittedAt.Time)
	}
	if p.KycReviewedAt.Valid {
		out.KycReviewedAt = timestamppb.New(p.KycReviewedAt.Time)
	}
	return out
}

// openPII расшифровывает значение. Шифртекст под ключом, которого нет в PII_KEKS, —
// pii_key_unknown (в лог — только kid); прочие сбои — обычная ошибка (internal).
func (s *Service) openPII(ctx context.Context, blob, aad string) (string, error) {
	plain, err := s.cfg.PII.Open(blob, aad)
	if errors.Is(err, pii.ErrUnknownKID) {
		kid, _ := s.cfg.PII.KIDOf(blob)
		s.log.ErrorContext(ctx, "ПДн под ключом, которого нет в PII_KEKS", "kid", kid)
		return "", rpcError(connect.CodeInternal, "pii_key_unknown", nil)
	}
	if err != nil {
		return "", fmt.Errorf("расшифровка ПДн: %w", err)
	}
	defer clear(plain)
	return string(plain), nil
}

// personIIN — ИИН личности пользователя (ИП и самозанятый работают по нему); ИИН не
// указан — person_missing.
func (s *Service) personIIN(ctx context.Context, q *store.Queries, userID uuid.UUID) (string, error) {
	p, err := personOf(ctx, q, userID)
	if err != nil {
		return "", err
	}
	if !p.IinEnc.Valid {
		return "", personMissing()
	}
	return s.openPII(ctx, p.IinEnc.String, personIINAAD(userID))
}

// signerHash — слепой индекс ИИН подписанта (домен iin: сверяется с ИИН сертификата);
// nil, если ИИН подписанта нет.
func (s *Service) signerHash(in partyInput) []byte {
	if in.signerIIN == "" {
		return nil
	}
	return s.cfg.PIIIndex.Of(pii.DomainIIN, in.signerIIN)
}

// sameParty — у пользователя уже записаны те же реквизиты (повтор запроса).
func (s *Service) sameParty(p store.Party, in partyInput) bool {
	return p.LegalForm == in.legalForm && p.LegalName == in.legalName &&
		bytes.Equal(p.BinIinHash, s.cfg.PIIIndex.Of(pii.DomainBINIIN, in.binIIN)) &&
		p.SignerFullName.String == in.signerName && bytes.Equal(p.SignerIinHash, s.signerHash(in))
}

// writeParty записывает сторону пользователя (строка пользователя уже заблокирована).
// Те же реквизиты ещё раз — прежняя строка, created=false; другие — party_exists. Тот же
// ИИН/БИН у другой стороны — iin_taken (и при гонке: уникальный bin_iin_hash, 23505).
func (s *Service) writeParty(ctx context.Context, tx pgx.Tx, userID uuid.UUID, in partyInput, now time.Time) (store.Party, bool, error) {
	q := store.New(tx)
	existing, err := q.LockParty(ctx, userID)
	switch {
	case err == nil:
		if s.sameParty(existing, in) {
			return existing, false, nil
		}
		return existing, false, partyExists()
	case !errors.Is(err, pgx.ErrNoRows):
		return existing, false, err
	}
	binEnc, err := s.cfg.PII.Seal([]byte(in.binIIN), partyBinIINAAD(userID))
	if err != nil {
		return store.Party{}, false, fmt.Errorf("шифрование ИИН/БИН: %w", err)
	}
	params := store.InsertPartyParams{
		UserID: userID, LegalForm: in.legalForm, LegalName: in.legalName,
		BinIinEnc: binEnc, BinIinHash: s.cfg.PIIIndex.Of(pii.DomainBINIIN, in.binIIN), BinIinLast4: pii.Last4(in.binIIN),
		SignerFullName: text(in.signerName), Now: ts(now),
	}
	if in.signerIIN != "" {
		enc, err := s.cfg.PII.Seal([]byte(in.signerIIN), partySignerIINAAD(userID))
		if err != nil {
			return store.Party{}, false, fmt.Errorf("шифрование ИИН подписанта: %w", err)
		}
		params.SignerIinEnc, params.SignerIinHash, params.SignerIinLast4 = text(enc), s.signerHash(in), text(pii.Last4(in.signerIIN))
	}
	p, err := q.InsertParty(ctx, params)
	if isUniqueViolation(err, partyBinIINConstraint) {
		return p, false, iinTaken()
	}
	if err != nil {
		return p, false, fmt.Errorf("запись стороны: %w", err)
	}
	return p, true, nil
}

// partyAudit — значение аудита стороны: правовая форма, без номеров и имён.
type partyAudit struct {
	LegalForm string `json:"legal_form"`
}

// RegisterParty записывает реквизиты исполнителя своего аккаунта (registerExecutor в
// apps/web). Роль EXECUTOR должна быть выдана (web выдаёт её раньше, GrantRole) — иначе
// role_not_granted; активной она может ещё не быть. ИП и самозанятый работают по ИИН
// личности: bin_iin запроса не читается, ИИН не указан — person_missing. Те же реквизиты
// ещё раз — тот же ответ, другие при записанной стороне — party_exists.
//
// Порядок: формат запроса, сессия и роль (чтение), затем идемпотентная транзакция:
// пользователь под блокировкой, роль заново, ИИН личности, сторона, аудит
// party.registered без значений.
func (s *Service) RegisterParty(ctx context.Context, req *identityv1.RegisterPartyRequest) (*identityv1.RegisterPartyResponse, error) {
	if err := requireCaller(ctx, webCaller); err != nil {
		return nil, err
	}
	const op, method = "register_party", identityv1connect.IdentityServiceRegisterPartyProcedure
	if !validIdempotencyKey(req.GetIdempotencyKey()) {
		return nil, invalidRequest()
	}
	in, err := checkParty(req.GetLegalForm(), req.GetLegalName(), req.GetBinIin(), req.GetSignerFullName(), req.GetSignerIin(), true)
	if err != nil {
		return nil, err
	}
	_, user, err := s.liveSession(ctx, op, req.GetSessionToken())
	if err != nil {
		return nil, err
	}
	if !slices.Contains(user.Roles, executorRole) {
		return nil, roleNotGranted()
	}
	resp := &identityv1.RegisterPartyResponse{}
	err = s.idempotent(ctx, op, method, req.GetIdempotencyKey(), req, resp, func(tx pgx.Tx) error {
		now := s.now()
		sess, locked, err := lockedSession(ctx, tx, req.GetSessionToken(), now)
		if err != nil {
			return err
		}
		if locked.ID != user.ID {
			return sessionInvalid()
		}
		if !slices.Contains(locked.Roles, executorRole) {
			return roleNotGranted()
		}
		in := in
		if in.legalForm != formTOOName {
			if in.binIIN, err = s.personIIN(ctx, store.New(tx), user.ID); err != nil {
				return err
			}
		}
		p, created, err := s.writeParty(ctx, tx, user.ID, in, now)
		if err != nil {
			return err
		}
		if created {
			role := activeRole(locked.Roles, locked.DefaultRole, &sess.ActiveRole)
			if err := recordAudit(ctx, tx, locked, role, "party.registered", nil, partyAudit{in.legalForm}, now); err != nil {
				return err
			}
		}
		resp.Party = partyProto(p)
		return nil
	})
	if err != nil {
		return nil, err
	}
	return resp, nil
}

// operatorWithMfa — операторский метод: активная роль — оператор (иначе role_forbidden),
// второй фактор в этой сессии пройден (иначе mfa_required).
func operatorWithMfa(sess store.Session, user store.User) error {
	if activeRole(user.Roles, user.DefaultRole, &sess.ActiveRole) != mfaRole {
		return roleForbidden()
	}
	if !sess.MfaVerifiedAt.Valid {
		return mfaRequired()
	}
	return nil
}

// ProvisionExecutor — оператор добавляет исполнителя (addExecutor в
// apps/web/src/modules/operator/executors.ts): пользователь по телефону с ролью EXECUTOR
// и его реквизиты. Нового пользователя создаёт (UserRegistered); существующему без ролей
// сотрудника добавляет роль исполнителя (RoleGranted); сотрудник — role_forbidden,
// заблокированный — user_blocked. ФИО и
// ИИН аккаунта не заполняются: подписант — свойство стороны (ADR-003). Нужна сессия
// оператора с пройденным вторым фактором (mfa_required).
func (s *Service) ProvisionExecutor(ctx context.Context, req *identityv1.ProvisionExecutorRequest) (*identityv1.ProvisionExecutorResponse, error) {
	if err := requireCaller(ctx, webCaller); err != nil {
		return nil, err
	}
	const op, method = "provision_executor", identityv1connect.IdentityServiceProvisionExecutorProcedure
	if !validIdempotencyKey(req.GetIdempotencyKey()) {
		return nil, invalidRequest()
	}
	phone, ok := parsePhone(req.GetPhone())
	if !ok {
		return nil, rpcError(connect.CodeInvalidArgument, "invalid_phone", nil)
	}
	in, err := checkParty(req.GetLegalForm(), req.GetLegalName(), req.GetBinIin(), req.GetSignerFullName(), req.GetSignerIin(), false)
	if err != nil {
		return nil, err
	}
	sess, operator, err := s.liveSession(ctx, op, req.GetSessionToken())
	if err != nil {
		return nil, err
	}
	if err := operatorWithMfa(sess, operator); err != nil {
		return nil, err
	}
	resp := &identityv1.ProvisionExecutorResponse{}
	err = s.idempotent(ctx, op, method, req.GetIdempotencyKey(), req, resp, func(tx pgx.Tx) error {
		now := s.now()
		sess, locked, err := lockedSession(ctx, tx, req.GetSessionToken(), now)
		if err != nil {
			return err
		}
		if locked.ID != operator.ID {
			return sessionInvalid()
		}
		if err := operatorWithMfa(sess, locked); err != nil {
			return err
		}
		actor := userActor(locked, mfaRole)
		user, err := s.executorByPhone(ctx, tx, phone, actor, now)
		if err != nil {
			return err
		}
		p, created, err := s.writeParty(ctx, tx, user.ID, in, now)
		if err != nil {
			return err
		}
		if created {
			if err := writeAudit(ctx, tx, actor, user.ID.String(), "party.registered", nil, partyAudit{in.legalForm}, now); err != nil {
				return err
			}
		}
		resp.User, resp.Party = userProto(user), partyProto(p)
		return nil
	})
	if err != nil {
		return nil, err
	}
	return resp, nil
}

// executorByPhone — исполнитель для ProvisionExecutor: новый пользователь с ролью
// EXECUTOR или существующий (под блокировкой) с добавленной ролью. События и аудит — от
// имени оператора.
func (s *Service) executorByPhone(ctx context.Context, tx pgx.Tx, phone string, actor auditActor, now time.Time) (store.User, error) {
	q := store.New(tx)
	user, err := q.GetUserByPhone(ctx, phone)
	if errors.Is(err, pgx.ErrNoRows) {
		user, err = q.CreateUser(ctx, store.CreateUserParams{Phone: phone, Roles: []string{executorRole}, DefaultRole: executorRole})
		if isUniqueViolation(err, usersPhoneConstraint) {
			// Тот же номер вошёл или добавлен параллельно: повтор найдёт пользователя.
			return user, connect.NewError(connect.CodeUnavailable, "unavailable")
		}
		if err != nil {
			return user, err
		}
		if _, err := outbox.Add(ctx, tx, ServiceID, subjectUserRegistered, "senim.events.v1.UserRegistered",
			&eventsv1.UserRegistered{UserId: user.ID.String(), Role: roleProto(executorRole)}); err != nil {
			return user, err
		}
		return user, writeAudit(ctx, tx, actor, user.ID.String(), "user.registered", nil, map[string]string{"role": executorRole}, now)
	}
	if err != nil {
		return user, err
	}
	if user, err = q.LockUser(ctx, user.ID); err != nil {
		return user, err
	}
	if isStaff(user.Roles) {
		return user, roleForbidden()
	}
	if user.BlockedAt.Valid {
		return user, rpcError(connect.CodePermissionDenied, "user_blocked", nil)
	}
	if slices.Contains(user.Roles, executorRole) {
		return user, nil
	}
	if user, err = q.AddUserRole(ctx, store.AddUserRoleParams{ID: user.ID, Role: executorRole, Now: ts(now)}); err != nil {
		return user, err
	}
	if _, err := outbox.Add(ctx, tx, ServiceID, subjectRoleGranted, "senim.events.v1.RoleGranted",
		&eventsv1.RoleGranted{UserId: user.ID.String(), Role: roleProto(executorRole)}); err != nil {
		return user, err
	}
	return user, writeAudit(ctx, tx, actor, user.ID.String(), "user.role_granted", nil, map[string]string{"role": executorRole}, now)
}

// SetPayoutIban указывает или меняет счёт выплаты своей стороны (setPayoutIban в
// payout.ts): KZ IBAN с проверкой mod-97, в базе — шифртекстом, наружу — последние 4
// символа. Активная роль — исполнитель (иначе role_forbidden), сторона есть (иначе
// party_missing). Тот же счёт ещё раз — без изменений и без аудита; иначе аудит
// executor.payout_iban_changed — только «указан / не указан». Запрет смены при ждущей
// выплате проверяет web до вызова (payments/payout-lock.ts).
func (s *Service) SetPayoutIban(ctx context.Context, req *identityv1.SetPayoutIbanRequest) (*identityv1.SetPayoutIbanResponse, error) {
	if err := requireCaller(ctx, webCaller); err != nil {
		return nil, err
	}
	const op, method = "set_payout_iban", identityv1connect.IdentityServiceSetPayoutIbanProcedure
	if !validIdempotencyKey(req.GetIdempotencyKey()) {
		return nil, invalidRequest()
	}
	iban, reason, ok := parseKzIban(req.GetIban())
	if !ok {
		return nil, ibanInvalid(reason)
	}
	sess, user, err := s.liveSession(ctx, op, req.GetSessionToken())
	if err != nil {
		return nil, err
	}
	if activeRole(user.Roles, user.DefaultRole, &sess.ActiveRole) != executorRole {
		return nil, roleForbidden()
	}
	resp := &identityv1.SetPayoutIbanResponse{}
	err = s.idempotent(ctx, op, method, req.GetIdempotencyKey(), req, resp, func(tx pgx.Tx) error {
		now := s.now()
		sess, locked, err := lockedSession(ctx, tx, req.GetSessionToken(), now)
		if err != nil {
			return err
		}
		if locked.ID != user.ID {
			return sessionInvalid()
		}
		if activeRole(locked.Roles, locked.DefaultRole, &sess.ActiveRole) != executorRole {
			return roleForbidden()
		}
		q := store.New(tx)
		p, err := q.LockParty(ctx, user.ID)
		if errors.Is(err, pgx.ErrNoRows) {
			return partyMissing()
		}
		if err != nil {
			return err
		}
		if p.PayoutIbanEnc.Valid {
			previous, damaged, err := s.previousPayoutIban(ctx, p)
			if err != nil {
				return err
			}
			if !damaged && previous == iban {
				resp.Party = partyProto(p)
				return nil
			}
		}
		enc, err := s.cfg.PII.Seal([]byte(iban), partyPayoutIBANAAD(user.ID))
		if err != nil {
			return fmt.Errorf("шифрование IBAN: %w", err)
		}
		updated, err := q.SetPartyPayoutIban(ctx, store.SetPartyPayoutIbanParams{
			PayoutIbanEnc: text(enc), PayoutIbanLast4: text(pii.Last4(iban)), Now: ts(now), UserID: user.ID,
		})
		if err != nil {
			return err
		}
		if err := recordAudit(ctx, tx, locked, executorRole, "executor.payout_iban_changed",
			contactSet{p.PayoutIbanEnc.Valid}, contactSet{true}, now); err != nil {
			return err
		}
		resp.Party = partyProto(updated)
		return nil
	})
	if err != nil {
		return nil, err
	}
	return resp, nil
}

// previousPayoutIban — прежний счёт стороны. Шифртекст повреждён или перенесён из чужой
// строки (ErrAuth, ErrMalformed) — счёт считается неизвестным: damaged=true, в лог — только
// kid и user_id, новый счёт записывается поверх. Ключа нет в PII_KEKS — pii_key_unknown.
func (s *Service) previousPayoutIban(ctx context.Context, p store.Party) (iban string, damaged bool, err error) {
	plain, err := s.cfg.PII.Open(p.PayoutIbanEnc.String, partyPayoutIBANAAD(p.UserID))
	if errors.Is(err, pii.ErrAuth) || errors.Is(err, pii.ErrMalformed) {
		kid, _ := s.cfg.PII.KIDOf(p.PayoutIbanEnc.String)
		s.log.WarnContext(ctx, "set_payout_iban: прежний счёт не расшифровывается, записывается новый",
			"kid", kid, "user_id", p.UserID.String())
		return "", true, nil
	}
	if err != nil {
		iban, err = s.openPII(ctx, p.PayoutIbanEnc.String, partyPayoutIBANAAD(p.UserID))
		return iban, false, err
	}
	defer clear(plain)
	return string(plain), false, nil
}

// VerifySignerIin — совпадает ли ИИН сертификата ЭЦП с ИИН того, кто подписывает за
// пользователя на стороне side (expectedSigner в apps/web/src/modules/documents/signing.ts):
// исполнитель — подписант стороны (у ТОО директор, signer_iin_hash; у ИП и самозанятого
// ИИН стороны, bin_iin_hash), заказчик — ИИН личности (persons.iin_hash), даже если у
// пользователя есть и своя сторона. Сравниваются слепые индексы: значения не
// расшифровываются, ответ — только «совпало / нет», аудита нет. Неизвестный пользователь,
// нет данных или номер не ИИН — не совпало; сторона не указана — invalid_request.
func (s *Service) VerifySignerIin(ctx context.Context, req *identityv1.VerifySignerIinRequest) (*identityv1.VerifySignerIinResponse, error) {
	if err := requireCaller(ctx, webCaller); err != nil {
		return nil, err
	}
	const op = "verify_signer_iin"
	userID, err := uuid.Parse(req.GetUserId())
	if err != nil {
		return nil, invalidRequest()
	}
	side := req.GetSide()
	if side != identityv1.SigningSide_SIGNING_SIDE_CLIENT && side != identityv1.SigningSide_SIGNING_SIDE_EXECUTOR {
		return nil, invalidRequest()
	}
	iin := req.GetIin()
	if !validIIN(iin) {
		return &identityv1.VerifySignerIinResponse{}, nil
	}
	q := store.New(s.pool)
	var stored, want []byte
	if side == identityv1.SigningSide_SIGNING_SIDE_CLIENT {
		person, err := personOf(ctx, q, userID)
		if err != nil {
			s.log.ErrorContext(ctx, op+": поиск личности", "err", err)
			return nil, internalError()
		}
		stored, want = person.IinHash, s.cfg.PIIIndex.Of(pii.DomainIIN, iin)
	} else {
		p, err := q.GetParty(ctx, userID)
		switch {
		case errors.Is(err, pgx.ErrNoRows):
			return &identityv1.VerifySignerIinResponse{}, nil
		case err != nil:
			s.log.ErrorContext(ctx, op+": поиск стороны", "err", err)
			return nil, internalError()
		case p.LegalForm == formTOOName:
			stored, want = p.SignerIinHash, s.cfg.PIIIndex.Of(pii.DomainIIN, iin)
		default:
			stored, want = p.BinIinHash, s.cfg.PIIIndex.Of(pii.DomainBINIIN, iin)
		}
	}
	return &identityv1.VerifySignerIinResponse{Matches: len(stored) > 0 && hmac.Equal(stored, want)}, nil
}
