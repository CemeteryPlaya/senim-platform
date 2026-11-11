package internal

import (
	"bytes"
	"context"
	"encoding/hex"
	"errors"
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
	"github.com/CemeteryPlaya/senim-platform/services/identity/internal/store"
)

// Согласия на обработку ПДн и на передачу данных банку-партнёру (правовое исследование,
// A.2 и A.8). Запись согласия — доказательство: версия и SHA-256 показанного текста, цели,
// канал (вход по коду из SMS — сессия) и время. Запись не меняется (триггер в 0007), отзыв
// — заявка оператору со сроком 15 рабочих дней.

// Виды согласий (колонка kind) и каналы получения (channel).
const (
	consentPD   = "PD_PROCESSING"
	consentBank = "BANK_TRANSFER"

	channelOtpSession = "otp_session" // в сессии, открытой кодом из SMS
	channelDemo       = "demo"        // в демо-сессии (StartDemoSession, без кода)
	channelSeed       = "seed"
)

// Статусы заявки на отзыв (consent_revocations.status) и решения оператора.
const (
	revocationRequested = "REQUESTED"
	revocationCompleted = "COMPLETED"
	revocationRefused   = "REFUSED"

	revocationActionComplete = "complete"
	revocationActionRefuse   = "refuse"
)

// События согласий.
const (
	subjectConsentGranted             = "senim.identity.consent.granted"
	subjectConsentRevocationRequested = "senim.identity.consent.revocation_requested"
	subjectConsentRevocationResolved  = "senim.identity.consent.revocation_resolved"
)

const (
	// Целей в одном согласии — не больше; каждая — 1–200 символов после обрезки.
	maxConsentPurposes = 32
	maxConsentPurpose  = 200
	// Пользователей в одном HasConsents — не больше.
	maxHasConsentsUsers = 200
)

var (
	// Версия текста согласия: «2026-11-01», «v1.2» — латиница, цифры, точка и дефис.
	consentVersionRe = regexp.MustCompile(`^[A-Za-z0-9.-]{1,32}$`)
	// Предмет согласия (идентификатор сделки): без пробелов, до 128 символов.
	consentReferenceRe = regexp.MustCompile(`^[A-Za-z0-9._:-]{1,128}$`)
)

// revocationTransition — строка таблицы переходов заявки на отзыв: из каких статусов, в
// какой, кто решает (активная роль) и нужна ли причина.
type revocationTransition struct {
	action      string
	from        []string
	to          string
	by          string
	needsReason bool
}

// revocationTransitions — единственное место, где определены решения по заявке на отзыв:
// открытую заявку оператор исполняет или отклоняет с причиной (ст. 8 п. 2: остались
// неисполненные обязательства). Решённая заявка не меняется; всё, чего нет в таблице,
// запрещено.
var revocationTransitions = []revocationTransition{
	{action: revocationActionComplete, from: []string{revocationRequested}, to: revocationCompleted, by: mfaRole},
	{action: revocationActionRefuse, from: []string{revocationRequested}, to: revocationRefused, by: mfaRole, needsReason: true},
}

func revocationRule(action string) revocationTransition {
	for _, t := range revocationTransitions {
		if t.action == action {
			return t
		}
	}
	return revocationTransition{}
}

// revocationReason — причина решения по правилу перехода: нужна — 3–500 символов после
// обрезки пробелов (правило отказа KYC), не нужна — должна быть пустой; иначе
// invalid_request.
func revocationReason(rule revocationTransition, raw string) (string, error) {
	if !rule.needsReason {
		if raw != "" {
			return "", invalidRequest()
		}
		return "", nil
	}
	r, ok := kycReason(raw)
	if !ok {
		return "", invalidRequest()
	}
	return r, nil
}

// revocationDecider — решает активная роль перехода (role_forbidden); операторская роль —
// только с пройденным в этой сессии вторым фактором (mfa_required).
func revocationDecider(rule revocationTransition, sess store.Session, user store.User) error {
	if rule.by == "" || activeRole(user.Roles, user.DefaultRole, &sess.ActiveRole) != rule.by {
		return roleForbidden()
	}
	if rule.by == mfaRole && !sess.MfaVerifiedAt.Valid {
		return mfaRequired()
	}
	return nil
}

func consentVersionInvalid() error {
	return rpcError(connect.CodeInvalidArgument, "consent_version_invalid", nil)
}

func consentNotRevocable() error {
	return rpcError(connect.CodeFailedPrecondition, "consent_not_revocable", nil)
}

func consentMissing() error {
	return rpcError(connect.CodeFailedPrecondition, "consent_missing", nil)
}

func revocationClosed() error {
	return rpcError(connect.CodeFailedPrecondition, "revocation_closed", nil)
}

// consentKindName переводит enum в имя вида базы; ok=false для UNSPECIFIED и неизвестных.
func consentKindName(k identityv1.ConsentKind) (string, bool) {
	switch k {
	case identityv1.ConsentKind_CONSENT_KIND_PD_PROCESSING:
		return consentPD, true
	case identityv1.ConsentKind_CONSENT_KIND_BANK_TRANSFER:
		return consentBank, true
	default:
		return "", false
	}
}

func consentKindProto(name string) identityv1.ConsentKind {
	return identityv1.ConsentKind(identityv1.ConsentKind_value["CONSENT_KIND_"+name])
}

func revocationStatusProto(name string) identityv1.RevocationStatus {
	return identityv1.RevocationStatus(identityv1.RevocationStatus_value["REVOCATION_STATUS_"+name])
}

// consentProof проверяет версию текста и его SHA-256 (64 hex-символа) и возвращает хеш
// байтами; неверно что-то одно — consent_version_invalid.
func consentProof(version, textSHA256 string) ([]byte, error) {
	if !consentVersionRe.MatchString(version) || len(textSHA256) != 64 {
		return nil, consentVersionInvalid()
	}
	sum, err := hex.DecodeString(textSHA256)
	if err != nil {
		return nil, consentVersionInvalid()
	}
	return sum, nil
}

// validConsentReference — согласие на ПДн общее (предмет пуст), передача банку — к сделке
// (предмет обязателен).
func validConsentReference(kind, ref string) bool {
	if kind == consentPD {
		return ref == ""
	}
	return consentReferenceRe.MatchString(ref)
}

// consentPurposes — цели согласия после обрезки пробелов: 1–32 цели по 1–200 символов,
// повторы убираются, порядок первого появления сохраняется.
func consentPurposes(raw []string) ([]string, bool) {
	if len(raw) == 0 || len(raw) > maxConsentPurposes {
		return nil, false
	}
	out := make([]string, 0, len(raw))
	for _, r := range raw {
		p := strings.TrimFunc(r, jsSpace)
		if n := jsLen(p); n == 0 || n > maxConsentPurpose {
			return nil, false
		}
		if !slices.Contains(out, p) {
			out = append(out, p)
		}
	}
	return out, true
}

// consentVersions — версии записей согласий по порядку (для аудита).
func consentVersions(rows []store.Consent) []string {
	out := make([]string, 0, len(rows))
	for _, c := range rows {
		out = append(out, c.Version)
	}
	return out
}

func consentProto(c store.Consent) *identityv1.Consent {
	out := &identityv1.Consent{
		Id:          c.ID.String(),
		Kind:        consentKindProto(c.Kind),
		Version:     c.Version,
		TextSha256:  hex.EncodeToString(c.TextSha256),
		Purposes:    c.Purposes,
		ReferenceId: c.ReferenceID,
		Channel:     c.Channel,
		GrantedAt:   timestamppb.New(c.GrantedAt.Time),
	}
	if c.RevokedAt.Valid {
		out.RevokedAt = timestamppb.New(c.RevokedAt.Time)
	}
	return out
}

func consentsProto(rows []store.Consent) []*identityv1.Consent {
	out := make([]*identityv1.Consent, 0, len(rows))
	for _, c := range rows {
		out = append(out, consentProto(c))
	}
	return out
}

func revocationProto(r store.ConsentRevocation) *identityv1.ConsentRevocation {
	out := &identityv1.ConsentRevocation{
		Id:          r.ID.String(),
		UserId:      r.UserID.String(),
		Kind:        consentKindProto(r.Kind),
		RequestedAt: timestamppb.New(r.RequestedAt.Time),
		DueAt:       timestamppb.New(r.DueAt.Time),
		Status:      revocationStatusProto(r.Status),
		Reason:      r.Reason.String,
	}
	if r.DecidedAt.Valid {
		out.DecidedAt = timestamppb.New(r.DecidedAt.Time)
	}
	return out
}

// consentAudit — before/after аудита согласий: вид, версия, предмет и канал; заявка — номер,
// статус, срок и причина отказа. Открытых ПДн нет.
type consentAudit struct {
	Kind         string   `json:"kind,omitempty"`
	Version      string   `json:"version,omitempty"`
	Versions     []string `json:"versions,omitempty"`
	ReferenceID  string   `json:"reference_id,omitempty"`
	Channel      string   `json:"channel,omitempty"`
	RevocationID string   `json:"revocation_id,omitempty"`
	Status       string   `json:"status,omitempty"`
	DueAt        string   `json:"due_at,omitempty"`
	Reason       string   `json:"reason,omitempty"`
}

// GrantConsent — пользователь даёт согласие в своей сессии (session_id — эта сессия; канал
// otp_session, если сессия открыта кодом из SMS, demo — если демо-входом): вид, версия и
// SHA-256 показанного текста (consent_version_invalid), цели.
// Согласие на ПДн — без предмета, передача банку — к сделке (reference_id); иначе
// invalid_request. Действующее согласие той же версии и предмета уже есть — тот же ответ без
// новой записи; та же версия с другим текстом — consent_version_invalid. Событие
// ConsentGranted и аудит consent.granted — в одной транзакции с записью.
func (s *Service) GrantConsent(ctx context.Context, req *identityv1.GrantConsentRequest) (*identityv1.GrantConsentResponse, error) {
	if err := requireCaller(ctx, webCaller); err != nil {
		return nil, err
	}
	const op, method = "grant_consent", identityv1connect.IdentityServiceGrantConsentProcedure
	if !validIdempotencyKey(req.GetIdempotencyKey()) {
		return nil, invalidRequest()
	}
	kind, ok := consentKindName(req.GetKind())
	if !ok {
		return nil, invalidRequest()
	}
	sum, err := consentProof(req.GetVersion(), req.GetTextSha256())
	if err != nil {
		return nil, err
	}
	if !validConsentReference(kind, req.GetReferenceId()) {
		return nil, invalidRequest()
	}
	purposes, ok := consentPurposes(req.GetPurposes())
	if !ok {
		return nil, invalidRequest()
	}
	_, user, err := s.liveSession(ctx, op, req.GetSessionToken())
	if err != nil {
		return nil, err
	}
	resp := &identityv1.GrantConsentResponse{}
	err = s.idempotent(ctx, op, method, req.GetIdempotencyKey(), req, resp, func(tx pgx.Tx) error {
		now := s.now()
		sess, locked, err := lockedSession(ctx, tx, req.GetSessionToken(), now)
		if err != nil {
			return err
		}
		if locked.ID != user.ID {
			return sessionInvalid()
		}
		q := store.New(tx)
		// Под блокировкой пользователя: параллельные согласия одной версии выстраиваются в
		// очередь, второе видит первое.
		existing, err := q.GetActiveConsent(ctx, store.GetActiveConsentParams{
			UserID: user.ID, Kind: kind, Version: req.GetVersion(), ReferenceID: req.GetReferenceId(),
		})
		switch {
		case err == nil:
			if !bytes.Equal(existing.TextSha256, sum) {
				return consentVersionInvalid() // текст сменился без новой версии
			}
			resp.Consent = consentProto(existing)
			return nil
		case !errors.Is(err, pgx.ErrNoRows):
			return err
		}
		c, err := q.InsertConsent(ctx, store.InsertConsentParams{
			UserID: user.ID, Kind: kind, Version: req.GetVersion(), TextSha256: sum, Purposes: purposes,
			ReferenceID: req.GetReferenceId(), Channel: sessionConsentChannel(sess),
			SessionID: uuid.NullUUID{UUID: sess.ID, Valid: true}, GrantedAt: ts(now),
		})
		if err != nil {
			return err
		}
		if _, err := outbox.Add(ctx, tx, ServiceID, subjectConsentGranted, "senim.events.v1.ConsentGranted",
			&eventsv1.ConsentGranted{UserId: user.ID.String(), Kind: req.GetKind(), Version: c.Version, ReferenceId: c.ReferenceID}); err != nil {
			return err
		}
		role := activeRole(locked.Roles, locked.DefaultRole, &sess.ActiveRole)
		if err := recordAudit(ctx, tx, locked, role, "consent.granted", nil,
			consentAudit{Kind: kind, Version: c.Version, ReferenceID: c.ReferenceID, Channel: c.Channel}, now); err != nil {
			return err
		}
		resp.Consent = consentProto(c)
		return nil
	})
	if err != nil {
		return nil, err
	}
	return resp, nil
}

// RevokeConsent — пользователь отзывает согласие на обработку ПДн: появляется заявка
// REQUESTED со сроком 15 рабочих дней по Алматы (событие ConsentRevocationRequested, аудит
// consent.revocation_requested). Согласие остаётся действующим до решения оператора: по
// закону в срок обработку прекращают или дают мотивированный отказ (ст. 8 п. 7), отзыв
// отмечает ResolveConsentRevocation (COMPLETED). Передача банку к сделке не отзывается
// (consent_not_revocable): она нужна для исполнения договора. Действующего согласия нет —
// consent_missing. Открытая заявка уже есть — та же заявка, без события и аудита.
func (s *Service) RevokeConsent(ctx context.Context, req *identityv1.RevokeConsentRequest) (*identityv1.RevokeConsentResponse, error) {
	if err := requireCaller(ctx, webCaller); err != nil {
		return nil, err
	}
	const op, method = "revoke_consent", identityv1connect.IdentityServiceRevokeConsentProcedure
	if !validIdempotencyKey(req.GetIdempotencyKey()) {
		return nil, invalidRequest()
	}
	kind, ok := consentKindName(req.GetKind())
	if !ok {
		return nil, invalidRequest()
	}
	if kind != consentPD {
		return nil, consentNotRevocable()
	}
	_, user, err := s.liveSession(ctx, op, req.GetSessionToken())
	if err != nil {
		return nil, err
	}
	resp := &identityv1.RevokeConsentResponse{}
	err = s.idempotent(ctx, op, method, req.GetIdempotencyKey(), req, resp, func(tx pgx.Tx) error {
		now := s.now()
		sess, locked, err := lockedSession(ctx, tx, req.GetSessionToken(), now)
		if err != nil {
			return err
		}
		if locked.ID != user.ID {
			return sessionInvalid()
		}
		q := store.New(tx)
		active, err := q.ListActiveConsents(ctx, store.ListActiveConsentsParams{UserID: user.ID, Kind: kind})
		if err != nil {
			return err
		}
		if len(active) == 0 {
			return consentMissing()
		}
		// Под блокировкой пользователя: две заявки одновременно не появятся.
		rev, err := q.GetOpenRevocation(ctx, store.GetOpenRevocationParams{UserID: user.ID, Kind: kind})
		if err == nil {
			resp.Revocation = revocationProto(rev)
			return nil
		}
		if !errors.Is(err, pgx.ErrNoRows) {
			return err
		}
		rev, err = q.CreateRevocation(ctx, store.CreateRevocationParams{
			UserID: user.ID, Kind: kind, RequestedAt: ts(now), DueAt: ts(revocationDue(now)),
		})
		if err != nil {
			return err
		}
		if _, err := outbox.Add(ctx, tx, ServiceID, subjectConsentRevocationRequested, "senim.events.v1.ConsentRevocationRequested",
			&eventsv1.ConsentRevocationRequested{
				RevocationId: rev.ID.String(), UserId: user.ID.String(), Kind: req.GetKind(),
				DueAt: timestamppb.New(rev.DueAt.Time),
			}); err != nil {
			return err
		}
		role := activeRole(locked.Roles, locked.DefaultRole, &sess.ActiveRole)
		if err := recordAudit(ctx, tx, locked, role, "consent.revocation_requested", nil,
			consentAudit{Kind: kind, Versions: consentVersions(active), RevocationID: rev.ID.String(), Status: rev.Status,
				DueAt: rev.DueAt.Time.UTC().Format(time.RFC3339)}, now); err != nil {
			return err
		}
		resp.Revocation = revocationProto(rev)
		return nil
	})
	if err != nil {
		return nil, err
	}
	return resp, nil
}

// ListMyConsents — чтение: все согласия пользователя (с отозванными, старые первыми) и его
// заявки на отзыв (новые первыми).
func (s *Service) ListMyConsents(ctx context.Context, req *identityv1.ListMyConsentsRequest) (*identityv1.ListMyConsentsResponse, error) {
	if err := requireCaller(ctx, webCaller); err != nil {
		return nil, err
	}
	const op = "list_my_consents"
	_, user, err := s.liveSession(ctx, op, req.GetSessionToken())
	if err != nil {
		return nil, err
	}
	q := store.New(s.pool)
	consents, err := q.ListUserConsents(ctx, user.ID)
	if err != nil {
		s.log.ErrorContext(ctx, op, "err", err)
		return nil, internalError()
	}
	revocations, err := q.ListUserRevocations(ctx, user.ID)
	if err != nil {
		s.log.ErrorContext(ctx, op, "err", err)
		return nil, internalError()
	}
	resp := &identityv1.ListMyConsentsResponse{Consents: consentsProto(consents)}
	for _, r := range revocations {
		resp.Revocations = append(resp.Revocations, revocationProto(r))
	}
	return resp, nil
}

// HasConsents — чтение: кто из user_ids дал действующее согласие вида к предмету (передача
// банку — к сделке; ПДн — без предмета). Ответ — в порядке запроса, без повторов.
// Идентификаторы — UUID, 1–200; вид указан; предмет по правилам вида — иначе invalid_request.
func (s *Service) HasConsents(ctx context.Context, req *identityv1.HasConsentsRequest) (*identityv1.HasConsentsResponse, error) {
	if err := requireCaller(ctx, webCaller); err != nil {
		return nil, err
	}
	const op = "has_consents"
	kind, ok := consentKindName(req.GetKind())
	if !ok || !validConsentReference(kind, req.GetReferenceId()) {
		return nil, invalidRequest()
	}
	raw := req.GetUserIds()
	if len(raw) == 0 || len(raw) > maxHasConsentsUsers {
		return nil, invalidRequest()
	}
	ids := make([]uuid.UUID, 0, len(raw))
	for _, r := range raw {
		id, err := uuid.Parse(r)
		if err != nil || len(r) != 36 {
			return nil, invalidRequest()
		}
		if !slices.Contains(ids, id) {
			ids = append(ids, id)
		}
	}
	granted, err := store.New(s.pool).UsersWithConsent(ctx, store.UsersWithConsentParams{
		UserIds: ids, Kind: kind, ReferenceID: req.GetReferenceId(),
	})
	if err != nil {
		s.log.ErrorContext(ctx, op, "err", err)
		return nil, internalError()
	}
	resp := &identityv1.HasConsentsResponse{}
	for _, id := range ids {
		if slices.Contains(granted, id) {
			resp.GrantedUserIds = append(resp.GrantedUserIds, id.String())
		}
	}
	return resp, nil
}

// ListConsentRevocations — очередь оператора: открытые заявки на отзыв, ближний срок
// первым; people — ФИО тех же пользователей в том же порядке (ИИН — последними четырьмя
// цифрами). Нужна сессия оператора с пройденным вторым фактором (role_forbidden,
// mfa_required).
func (s *Service) ListConsentRevocations(ctx context.Context, req *identityv1.ListConsentRevocationsRequest) (*identityv1.ListConsentRevocationsResponse, error) {
	if err := requireCaller(ctx, webCaller); err != nil {
		return nil, err
	}
	const op = "list_consent_revocations"
	sess, operator, err := s.liveSession(ctx, op, req.GetSessionToken())
	if err != nil {
		return nil, err
	}
	if err := operatorWithMfa(sess, operator); err != nil {
		return nil, err
	}
	q := store.New(s.pool)
	revocations, err := q.ListOpenRevocations(ctx)
	if err != nil {
		s.log.ErrorContext(ctx, op, "err", err)
		return nil, internalError()
	}
	ids := make([]uuid.UUID, 0, len(revocations))
	for _, r := range revocations {
		if !slices.Contains(ids, r.UserID) {
			ids = append(ids, r.UserID)
		}
	}
	persons, err := q.ListPersonsByIDs(ctx, ids)
	if err != nil {
		s.log.ErrorContext(ctx, op, "err", err)
		return nil, internalError()
	}
	byID := make(map[uuid.UUID]store.Person, len(persons))
	for _, p := range persons {
		byID[p.UserID] = p
	}
	resp := &identityv1.ListConsentRevocationsResponse{}
	for _, r := range revocations {
		person, ok := byID[r.UserID]
		if !ok {
			person = store.Person{UserID: r.UserID}
		}
		resp.Revocations = append(resp.Revocations, revocationProto(r))
		resp.People = append(resp.People, personProto(person))
	}
	return resp, nil
}

// ResolveConsentRevocation — решение оператора по заявке на отзыв по таблице
// revocationTransitions: completed=true — COMPLETED (обработка прекращена: действующие
// согласия этого вида, данные не позже заявки, отмечаются отозванными в той же транзакции;
// данное заново после заявки остаётся), иначе REFUSED (согласие не трогается). Причина —
// когда её требует переход: 3–500 символов, то же правило, что у отказа KYC; у перехода без
// причины непустая причина — тоже invalid_request. Решает активная роль перехода
// (role_forbidden) с пройденным вторым фактором (mfa_required). Переход — условный UPDATE
// по исходным статусам: двойной клик и два оператора одновременно дают одно решение,
// остальные — revocation_closed (и для неизвестной заявки). Событие
// ConsentRevocationResolved и аудит consent.revocation_completed /
// consent.revocation_refused — в одной транзакции с изменением.
func (s *Service) ResolveConsentRevocation(ctx context.Context, req *identityv1.ResolveConsentRevocationRequest) (*identityv1.ResolveConsentRevocationResponse, error) {
	if err := requireCaller(ctx, webCaller); err != nil {
		return nil, err
	}
	const op, method = "resolve_consent_revocation", identityv1connect.IdentityServiceResolveConsentRevocationProcedure
	if !validIdempotencyKey(req.GetIdempotencyKey()) {
		return nil, invalidRequest()
	}
	id, err := uuid.Parse(req.GetRevocationId())
	if err != nil || len(req.GetRevocationId()) != 36 {
		return nil, invalidRequest()
	}
	rule := revocationRule(revocationActionComplete)
	if !req.GetCompleted() {
		rule = revocationRule(revocationActionRefuse)
	}
	reason, err := revocationReason(rule, req.GetReason())
	if err != nil {
		return nil, err
	}
	sess, operator, err := s.liveSession(ctx, op, req.GetSessionToken())
	if err != nil {
		return nil, err
	}
	if err := revocationDecider(rule, sess, operator); err != nil {
		return nil, err
	}
	resp := &identityv1.ResolveConsentRevocationResponse{}
	err = s.idempotent(ctx, op, method, req.GetIdempotencyKey(), req, resp, func(tx pgx.Tx) error {
		now := s.now()
		sess, locked, err := lockedSession(ctx, tx, req.GetSessionToken(), now)
		if err != nil {
			return err
		}
		if locked.ID != operator.ID {
			return sessionInvalid()
		}
		if err := revocationDecider(rule, sess, locked); err != nil {
			return err
		}
		q := store.New(tx)
		rev, err := q.ResolveRevocation(ctx, store.ResolveRevocationParams{
			ToStatus: rule.to, Now: ts(now), DecidedBy: uuid.NullUUID{UUID: locked.ID, Valid: true},
			Reason: text(reason), ID: id, AllowedFrom: rule.from,
		})
		if errors.Is(err, pgx.ErrNoRows) {
			return revocationClosed() // решена раньше (другим оператором или повтором) или не существует
		}
		if err != nil {
			return err
		}
		var revoked []store.Consent
		if rule.to == revocationCompleted {
			revoked, err = q.RevokeConsentsGrantedBy(ctx, store.RevokeConsentsGrantedByParams{
				Now: ts(now), UserID: rev.UserID, Kind: rev.Kind, RequestedAt: rev.RequestedAt,
			})
			if err != nil {
				return err
			}
		}
		action := "consent.revocation_completed"
		if rule.to == revocationRefused {
			action = "consent.revocation_refused"
		}
		after := consentAudit{Kind: rev.Kind, RevocationID: rev.ID.String(), Status: rev.Status, Reason: reason}
		if len(revoked) > 0 {
			after.Versions = consentVersions(revoked)
		}
		if err := writeAudit(ctx, tx, userActor(locked, rule.by), rev.UserID.String(), action,
			consentAudit{Kind: rev.Kind, RevocationID: rev.ID.String(), Status: revocationRequested}, after, now); err != nil {
			return err
		}
		if _, err := outbox.Add(ctx, tx, ServiceID, subjectConsentRevocationResolved, "senim.events.v1.ConsentRevocationResolved",
			&eventsv1.ConsentRevocationResolved{
				RevocationId: rev.ID.String(), UserId: rev.UserID.String(), Status: revocationStatusProto(rev.Status),
			}); err != nil {
			return err
		}
		resp.Revocation = revocationProto(rev)
		return nil
	})
	if err != nil {
		return nil, err
	}
	return resp, nil
}

// sessionConsentChannel — канал согласия, данного в сессии: otp_session утверждает вход по
// коду из SMS и пишется только для такой сессии; демо-сессия (без кода) — demo.
func sessionConsentChannel(sess store.Session) string {
	if sess.OpenedBy == sessionOpenedByOtp {
		return channelOtpSession
	}
	return channelDemo
}
