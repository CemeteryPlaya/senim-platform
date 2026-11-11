package internal

import (
	"context"
	"errors"
	"slices"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"

	eventsv1 "github.com/CemeteryPlaya/senim-platform/gen/go/senim/events/v1"
	identityv1 "github.com/CemeteryPlaya/senim-platform/gen/go/senim/identity/v1"
	"github.com/CemeteryPlaya/senim-platform/gen/go/senim/identity/v1/identityv1connect"
	"github.com/CemeteryPlaya/senim-platform/pkg/outbox"
	"github.com/CemeteryPlaya/senim-platform/services/identity/internal/store"
)

// KYC исполнителя — перенос из apps/web/src/modules/identity/kyc.ts (submitKycDocuments,
// kycQueue, reviewKyc); правила переходов — kyc_policy.go. Файлы хранит сервис files, его
// владельца и существование файлов проверяет web до вызова: здесь — только форма
// идентификаторов (UUID) и их число.

// kycAudit — before/after аудита KYC: статус, причина отказа (в аудите — по решению
// оператора) и число файлов при подаче. Открытых ПДн нет.
type kycAudit struct {
	Status            string `json:"status"`
	Reason            string `json:"reason,omitempty"`
	IDFiles           int    `json:"id_files,omitempty"`
	RegistrationFiles int    `json:"registration_files,omitempty"`
}

// kycFileIDs проверяет список файлов одного вида: не больше kycMaxFiles, каждый — UUID в
// каноническом виде (36 символов). Повторы убираются, порядок первого появления сохраняется.
// Пустой список допустим здесь: kyc_documents_missing решает вызывающий, когда проверены
// оба вида.
func kycFileIDs(raw []string) ([]string, bool) {
	if len(raw) > kycMaxFiles {
		return nil, false
	}
	ids := make([]string, 0, len(raw))
	for _, r := range raw {
		id, err := uuid.Parse(r)
		if err != nil || len(r) != 36 {
			return nil, false
		}
		if s := id.String(); !slices.Contains(ids, s) {
			ids = append(ids, s)
		}
	}
	return ids, true
}

func hasKycDocuments(p store.Party) bool {
	return len(p.KycIDFileIds) > 0 && len(p.KycRegistrationFileIds) > 0
}

// SubmitKyc — исполнитель отправляет документы на проверку: удостоверение и регистрация
// ИП/ТОО, по 1–4 файла каждого вида (kyc_documents_missing, если какого-то вида нет;
// invalid_request — файлов больше четырёх или идентификатор не UUID). Из NOT_SUBMITTED,
// PENDING (файлы заменяются) и REJECTED (причина снимается) статус становится PENDING;
// проверенные документы не заменяются — kyc_transition_forbidden. Нужна активная роль
// исполнителя (role_forbidden) и сторона (party_missing). Аудит executor.kyc_submitted — в
// одной транзакции с изменением.
func (s *Service) SubmitKyc(ctx context.Context, req *identityv1.SubmitKycRequest) (*identityv1.SubmitKycResponse, error) {
	if err := requireCaller(ctx, webCaller); err != nil {
		return nil, err
	}
	const op, method = "submit_kyc", identityv1connect.IdentityServiceSubmitKycProcedure
	if !validIdempotencyKey(req.GetIdempotencyKey()) {
		return nil, invalidRequest()
	}
	idFiles, ok := kycFileIDs(req.GetIdFileIds())
	if !ok {
		return nil, invalidRequest()
	}
	regFiles, ok := kycFileIDs(req.GetRegistrationFileIds())
	if !ok {
		return nil, invalidRequest()
	}
	if len(idFiles) == 0 || len(regFiles) == 0 {
		return nil, kycDocumentsMissing()
	}
	sess, user, err := s.liveSession(ctx, op, req.GetSessionToken())
	if err != nil {
		return nil, err
	}
	if activeRole(user.Roles, user.DefaultRole, &sess.ActiveRole) != executorRole {
		return nil, roleForbidden()
	}
	resp := &identityv1.SubmitKycResponse{}
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
		p, err := q.GetParty(ctx, user.ID)
		if errors.Is(err, pgx.ErrNoRows) {
			return partyMissing()
		}
		if err != nil {
			return err
		}
		if _, err := kycTarget(kycActionSubmit, p.KycStatus, true, executorRole); err != nil {
			return err
		}
		updated, err := q.SubmitPartyKyc(ctx, store.SubmitPartyKycParams{
			Now: ts(now), IDFileIds: idFiles, RegistrationFileIds: regFiles,
			UserID: user.ID, AllowedFrom: kycRule(kycActionSubmit).from,
		})
		if errors.Is(err, pgx.ErrNoRows) {
			return kycTransitionForbidden() // статус сменился между чтением и записью
		}
		if err != nil {
			return err
		}
		if err := recordAudit(ctx, tx, locked, executorRole, "executor.kyc_submitted",
			kycAudit{Status: p.KycStatus},
			kycAudit{Status: kycPending, IDFiles: len(idFiles), RegistrationFiles: len(regFiles)}, now); err != nil {
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

// ListKycQueue — очередь проверки для оператора: исполнители в PENDING с обоими видами
// файлов, давно ждущие первыми. people — ФИО тех же пользователей (в том же порядке; ИИН
// только последними четырьмя цифрами). Нужна сессия оператора с пройденным вторым
// фактором (role_forbidden, mfa_required).
func (s *Service) ListKycQueue(ctx context.Context, req *identityv1.ListKycQueueRequest) (*identityv1.ListKycQueueResponse, error) {
	if err := requireCaller(ctx, webCaller); err != nil {
		return nil, err
	}
	const op = "list_kyc_queue"
	sess, operator, err := s.liveSession(ctx, op, req.GetSessionToken())
	if err != nil {
		return nil, err
	}
	if err := operatorWithMfa(sess, operator); err != nil {
		return nil, err
	}
	q := store.New(s.pool)
	parties, err := q.ListKycQueue(ctx)
	if err != nil {
		s.log.ErrorContext(ctx, op, "err", err)
		return nil, internalError()
	}
	ids := make([]uuid.UUID, len(parties))
	for i, p := range parties {
		ids[i] = p.UserID
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
	resp := &identityv1.ListKycQueueResponse{}
	for _, p := range parties {
		person, ok := byID[p.UserID]
		if !ok {
			person = store.Person{UserID: p.UserID}
		}
		resp.Parties = append(resp.Parties, partyProto(p))
		resp.People = append(resp.People, personProto(person))
	}
	return resp, nil
}

// ReviewKyc — решение оператора по документам: verify=true — VERIFIED, иначе REJECTED с
// причиной 3–500 символов (kyc_reason_invalid; при подтверждении причина не пишется).
// Переход — условный UPDATE по «ещё PENDING» и по expected_submitted_at (время подачи из
// очереди, обязательно — иначе invalid_request): двойной клик и два оператора одновременно
// дают одно решение, остальные — kyc_transition_forbidden; переподача между открытием
// очереди и решением — тоже kyc_transition_forbidden, решение не ложится на новые файлы. Исполнитель без стороны —
// party_missing; PENDING без файлов — kyc_documents_missing. Аудит executor.kyc_verified /
// executor.kyc_rejected и событие KycReviewed — в одной транзакции с изменением. Нужна
// сессия оператора с пройденным вторым фактором (role_forbidden, mfa_required).
func (s *Service) ReviewKyc(ctx context.Context, req *identityv1.ReviewKycRequest) (*identityv1.ReviewKycResponse, error) {
	if err := requireCaller(ctx, webCaller); err != nil {
		return nil, err
	}
	const op, method = "review_kyc", identityv1connect.IdentityServiceReviewKycProcedure
	if !validIdempotencyKey(req.GetIdempotencyKey()) {
		return nil, invalidRequest()
	}
	target, err := uuid.Parse(req.GetUserId())
	if err != nil {
		return nil, invalidRequest()
	}
	if req.GetExpectedSubmittedAt() == nil || req.GetExpectedSubmittedAt().CheckValid() != nil {
		return nil, invalidRequest()
	}
	// База хранит микросекунды: точнее сравнивать не с чем (очередь отдаёт ровно их).
	expectedSubmitted := req.GetExpectedSubmittedAt().AsTime().Truncate(time.Microsecond)
	action, reason := kycActionVerify, ""
	if !req.GetVerify() {
		action = kycActionReject
		r, ok := kycReason(req.GetReason())
		if !ok {
			return nil, kycReasonInvalid()
		}
		reason = r
	}
	sess, operator, err := s.liveSession(ctx, op, req.GetSessionToken())
	if err != nil {
		return nil, err
	}
	if err := operatorWithMfa(sess, operator); err != nil {
		return nil, err
	}
	resp := &identityv1.ReviewKycResponse{}
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
		q := store.New(tx)
		p, err := q.GetParty(ctx, target)
		if errors.Is(err, pgx.ErrNoRows) {
			return partyMissing()
		}
		if err != nil {
			return err
		}
		to, err := kycTarget(action, p.KycStatus, hasKycDocuments(p), mfaRole)
		if err != nil {
			return err
		}
		updated, err := q.ReviewPartyKyc(ctx, store.ReviewPartyKycParams{
			ToStatus: to, RejectReason: text(reason), Now: ts(now),
			UserID: target, AllowedFrom: kycRule(action).from, ExpectedSubmittedAt: ts(expectedSubmitted),
		})
		if errors.Is(err, pgx.ErrNoRows) {
			// Решение уже принято (другим оператором или повтором) либо исполнитель подал
			// документы заново после того, как оператор открыл очередь.
			return kycTransitionForbidden()
		}
		if err != nil {
			return err
		}
		auditAction := "executor.kyc_verified"
		if to == kycRejected {
			auditAction = "executor.kyc_rejected"
		}
		if err := writeAudit(ctx, tx, userActor(locked, mfaRole), target.String(), auditAction,
			kycAudit{Status: p.KycStatus}, kycAudit{Status: to, Reason: reason}, now); err != nil {
			return err
		}
		if _, err := outbox.Add(ctx, tx, ServiceID, subjectKycReviewed, "senim.events.v1.KycReviewed",
			&eventsv1.KycReviewed{UserId: target.String(), Status: kycStatusProto(to)}); err != nil {
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
