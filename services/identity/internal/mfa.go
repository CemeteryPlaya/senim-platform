package internal

import (
	"context"
	"crypto/rand"
	"encoding/base32"
	"encoding/json"
	"errors"
	"fmt"
	"math"
	"strconv"
	"time"

	"connectrpc.com/connect/v2"
	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
	"google.golang.org/protobuf/proto"
	"google.golang.org/protobuf/types/known/timestamppb"

	eventsv1 "github.com/CemeteryPlaya/senim-platform/gen/go/senim/events/v1"
	identityv1 "github.com/CemeteryPlaya/senim-platform/gen/go/senim/identity/v1"
	"github.com/CemeteryPlaya/senim-platform/gen/go/senim/identity/v1/identityv1connect"
	"github.com/CemeteryPlaya/senim-platform/pkg/dbx"
	"github.com/CemeteryPlaya/senim-platform/pkg/idem"
	"github.com/CemeteryPlaya/senim-platform/pkg/outbox"
	"github.com/CemeteryPlaya/senim-platform/services/identity/internal/store"
)

const (
	subjectMfaEnrolled = "senim.identity.mfa.enrolled"
	subjectMfaReset    = "senim.identity.mfa.reset"

	// mfaRole — роль, которой нужен второй фактор (спека §4.4: операторы).
	mfaRole = "OPERATOR"
	// Неверных кодов (и повторов кода) на пользователя: не больше 5 за 15 минут; шестая
	// попытка — mfa_too_many_attempts. Верный код попытку возвращает.
	mfaMaxFailures   = 5
	mfaFailureWindow = 15 * time.Minute
	// maxTotpCodeLen — предел длины поля code до разбора (пробелы по краям допустимы).
	maxTotpCodeLen = 32
)

// totpBase32 — секрет в base32 без «=»: 20 байт — 32 символа (формат otpauth://).
var totpBase32 = base32.StdEncoding.WithPadding(base32.NoPadding)

// mfaSecretAAD — AAD шифртекста секрета: привязка к таблице, полю и пользователю.
func mfaSecretAAD(userID uuid.UUID) string { return "identity.mfa_factors.secret:" + userID.String() }

func mfaLimitKey(userID uuid.UUID) string { return "mfa:" + userID.String() }

func mfaNotRequired() error {
	return rpcError(connect.CodeFailedPrecondition, "mfa_not_required", nil)
}

func mfaNotEnrolled() error {
	return rpcError(connect.CodeFailedPrecondition, "mfa_not_enrolled", nil)
}

func mfaAlreadyEnrolled() error {
	return rpcError(connect.CodeFailedPrecondition, "mfa_already_enrolled", nil)
}

func mfaCodeReused() error {
	return rpcError(connect.CodeInvalidArgument, "mfa_code_reused", nil)
}

func mfaWrongCode(left int) error {
	return rpcError(connect.CodeInvalidArgument, "mfa_wrong_code", map[string]string{"left": strconv.Itoa(max(left, 0))})
}

// operatorSession — чтение до ключа идемпотентности: сессия действует, пользователь не
// заблокирован, активная роль — оператор. Ошибки — уже ответы клиенту.
func (s *Service) operatorSession(ctx context.Context, op, token string) (store.Session, store.User, error) {
	q := store.New(s.pool)
	sess, ok, err := sessionByToken(ctx, q, token, false)
	if err != nil {
		s.log.ErrorContext(ctx, op+": поиск сессии", "err", err)
		return sess, store.User{}, internalError()
	}
	if !ok {
		return sess, store.User{}, sessionInvalid()
	}
	user, err := q.GetUserByID(ctx, sess.UserID)
	if err != nil {
		s.log.ErrorContext(ctx, op+": поиск пользователя", "err", err)
		return sess, user, internalError()
	}
	if !sessionUsable(sess, user, s.now()) {
		return sess, user, sessionInvalid()
	}
	if activeRole(user.Roles, user.DefaultRole, &sess.ActiveRole) != mfaRole {
		return sess, user, mfaNotRequired()
	}
	return sess, user, nil
}

// lockedOperatorSession — то же под блокировкой строк пользователя и сессии (в транзакции).
func lockedOperatorSession(ctx context.Context, tx pgx.Tx, token string, now time.Time) (store.Session, store.User, error) {
	sess, user, err := lockedSession(ctx, tx, token, now)
	if err != nil {
		return sess, user, err
	}
	if activeRole(user.Roles, user.DefaultRole, &sess.ActiveRole) != mfaRole {
		return sess, user, mfaNotRequired()
	}
	return sess, user, nil
}

// StartTotpEnrollment выдаёт оператору новый секрет TOTP. Повтор до подтверждения
// заменяет неподтверждённый секрет новым (прежний перестаёт действовать); подключённый
// фактор не меняется — mfa_already_enrolled (сброс — identity mfa-reset).
//
// В таблицу idempotency ложится не секрет, а его шифртекст: повтор по ключу
// расшифровывает его и отдаёт тот же секрет — только пока фактор не подтверждён.
func (s *Service) StartTotpEnrollment(ctx context.Context, req *identityv1.StartTotpEnrollmentRequest) (*identityv1.StartTotpEnrollmentResponse, error) {
	if err := requireCaller(ctx, webCaller); err != nil {
		return nil, err
	}
	if !validIdempotencyKey(req.GetIdempotencyKey()) {
		return nil, invalidRequest()
	}
	_, user, err := s.operatorSession(ctx, "start_totp_enrollment", req.GetSessionToken())
	if err != nil {
		return nil, err
	}
	aad := mfaSecretAAD(user.ID)
	stored := &identityv1.StartTotpEnrollmentResponse{}
	err = s.idempotent(ctx, "start_totp_enrollment", identityv1connect.IdentityServiceStartTotpEnrollmentProcedure, req.GetIdempotencyKey(), req, stored, func(tx pgx.Tx) error {
		now := s.now()
		_, locked, err := lockedOperatorSession(ctx, tx, req.GetSessionToken(), now)
		if err != nil {
			return err
		}
		if locked.ID != user.ID {
			return sessionInvalid()
		}
		secret := make([]byte, totpSecretBytes)
		if _, err := rand.Read(secret); err != nil {
			return fmt.Errorf("секрет TOTP: %w", err)
		}
		defer clear(secret)
		enc, err := s.cfg.PII.Seal(secret, aad)
		if err != nil {
			return fmt.Errorf("шифрование секрета TOTP: %w", err)
		}
		n, err := store.New(tx).UpsertPendingMfaFactor(ctx, store.UpsertPendingMfaFactorParams{UserID: user.ID, SecretEnc: enc, Now: ts(now)})
		if err != nil {
			return err
		}
		if n == 0 {
			return mfaAlreadyEnrolled()
		}
		stored.SecretBase32 = enc
		return nil
	})
	if err != nil {
		return nil, err
	}
	// Повтор по ключу после подтверждения секрет не раскрывает: он показывается только до
	// подключения.
	factor, err := store.New(s.pool).GetMfaFactor(ctx, user.ID)
	if err != nil && !errors.Is(err, pgx.ErrNoRows) {
		s.log.ErrorContext(ctx, "start_totp_enrollment: поиск фактора", "err", err)
		return nil, internalError()
	}
	if err == nil && factor.ConfirmedAt.Valid {
		return nil, mfaAlreadyEnrolled()
	}
	plain, err := s.cfg.PII.Open(stored.GetSecretBase32(), aad)
	if err != nil {
		s.log.ErrorContext(ctx, "start_totp_enrollment: расшифровка секрета", "err", err)
		return nil, internalError()
	}
	defer clear(plain)
	return &identityv1.StartTotpEnrollmentResponse{SecretBase32: totpBase32.EncodeToString(plain)}, nil
}

// ConfirmTotpEnrollment подтверждает подключение первым верным кодом: фактор подключён,
// в этой сессии второй фактор пройден; событие MfaEnrolled и аудит.
func (s *Service) ConfirmTotpEnrollment(ctx context.Context, req *identityv1.ConfirmTotpEnrollmentRequest) (*identityv1.ConfirmTotpEnrollmentResponse, error) {
	if err := requireCaller(ctx, webCaller); err != nil {
		return nil, err
	}
	resp := &identityv1.ConfirmTotpEnrollmentResponse{}
	err := s.secondFactor(ctx, secondFactorCall{
		op: "confirm_totp_enrollment", method: identityv1connect.IdentityServiceConfirmTotpEnrollmentProcedure,
		token: req.GetSessionToken(), code: req.GetCode(), key: req.GetIdempotencyKey(),
		req: req, resp: resp, enrolling: true,
		done: func(sess *identityv1.Session) { resp.Session = sess },
	})
	if err != nil {
		return nil, err
	}
	return resp, nil
}

// VerifySecondFactor — вторая ступень входа и повторная проверка перед чувствительным
// действием: верный код ставит сессии mfa_verified_at = сейчас.
func (s *Service) VerifySecondFactor(ctx context.Context, req *identityv1.VerifySecondFactorRequest) (*identityv1.VerifySecondFactorResponse, error) {
	if err := requireCaller(ctx, webCaller); err != nil {
		return nil, err
	}
	resp := &identityv1.VerifySecondFactorResponse{}
	err := s.secondFactor(ctx, secondFactorCall{
		op: "verify_second_factor", method: identityv1connect.IdentityServiceVerifySecondFactorProcedure,
		token: req.GetSessionToken(), code: req.GetCode(), key: req.GetIdempotencyKey(),
		req: req, resp: resp,
		done: func(sess *identityv1.Session) { resp.Session = sess },
	})
	if err != nil {
		return nil, err
	}
	return resp, nil
}

// secondFactorCall — общий вызов проверки кода: подтверждение подключения (enrolling) или
// проверка подключённого фактора.
type secondFactorCall struct {
	op, method       string
	token, code, key string
	req, resp        proto.Message
	enrolling        bool
	done             func(*identityv1.Session)
}

// secondFactor проверяет код TOTP по схеме VerifyOtp.
//
// Порядок: формат запроса, сессия и роль (чтение), повтор по ключу (Lookup: потерянный
// ответ возвращается как есть, шаг второй раз не тратится), фактор, лимит неверных
// попыток (засчитывается до сравнения, атомарно, вне транзакции — остаётся и при
// откате), сравнение кода, затем транзакция: сессия и фактор под блокировкой, условный
// UPDATE шага (параллельный ввод того же кода — mfa_code_reused), возврат попытки,
// отметка сессии, событие и аудит (при подключении).
func (s *Service) secondFactor(ctx context.Context, c secondFactorCall) error {
	if !validIdempotencyKey(c.key) || c.code == "" || len(c.code) > maxTotpCodeLen {
		return invalidRequest()
	}
	_, user, err := s.operatorSession(ctx, c.op, c.token)
	if err != nil {
		return err
	}
	found, err := idem.Lookup(ctx, s.pool, c.method, c.key, c.req, c.resp)
	if errors.Is(err, idem.ErrKeyReused) {
		return rpcError(connect.CodeInvalidArgument, "idempotency_key_reused", nil)
	}
	if err != nil {
		s.log.ErrorContext(ctx, c.op+": проверка ключа идемпотентности", "err", err)
		return connect.NewError(connect.CodeUnavailable, "unavailable")
	}
	if found {
		return nil
	}

	now := s.now()
	factor, step, refusal := s.checkTotp(ctx, c, user, now)
	if refusal != nil {
		// Вызов с этим ключом мог завершиться, пока шла проверка: его ответ важнее отказа.
		if found, lerr := idem.Lookup(ctx, s.pool, c.method, c.key, c.req, c.resp); lerr == nil && found {
			return nil
		} else if lerr != nil && !errors.Is(lerr, idem.ErrKeyReused) {
			s.log.WarnContext(ctx, c.op+": повторная проверка ключа после отказа", "err", lerr)
		}
		return refusal
	}

	err = dbx.InTx(ctx, s.pool, func(tx pgx.Tx) error {
		_, err := idem.Do(ctx, tx, c.method, c.key, c.req, c.resp, func() error {
			return s.acceptTotp(ctx, tx, c, user, factor, step, now)
		})
		return err
	})
	if errors.Is(err, idem.ErrKeyReused) {
		return rpcError(connect.CodeInvalidArgument, "idempotency_key_reused", nil)
	}
	var ce *connect.Error
	if errors.As(err, &ce) {
		return err
	}
	if err != nil {
		s.log.ErrorContext(ctx, c.op, "err", err)
		return internalError()
	}
	return nil
}

// checkTotp находит фактор, засчитывает попытку и сравнивает код. Возвращает фактор и
// шаг принятого кода или отказ.
func (s *Service) checkTotp(ctx context.Context, c secondFactorCall, user store.User, now time.Time) (store.MfaFactor, int64, error) {
	factor, err := store.New(s.pool).GetMfaFactor(ctx, user.ID)
	switch {
	case errors.Is(err, pgx.ErrNoRows):
		return factor, 0, mfaNotEnrolled()
	case err != nil:
		s.log.ErrorContext(ctx, c.op+": поиск фактора", "err", err)
		return factor, 0, internalError()
	case c.enrolling && factor.ConfirmedAt.Valid:
		return factor, 0, mfaAlreadyEnrolled()
	case !c.enrolling && !factor.ConfirmedAt.Valid:
		return factor, 0, mfaNotEnrolled()
	}

	attempts, err := limiter{now: s.now}.count(ctx, s.pool, mfaLimitKey(user.ID), mfaFailureWindow)
	if err != nil {
		s.log.ErrorContext(ctx, c.op+": счётчик неверных кодов", "err", err)
		return factor, 0, internalError()
	}
	if attempts > mfaMaxFailures {
		return factor, 0, rpcError(connect.CodeResourceExhausted, "mfa_too_many_attempts", nil)
	}

	secret, err := s.cfg.PII.Open(factor.SecretEnc, mfaSecretAAD(user.ID))
	if err != nil {
		s.log.ErrorContext(ctx, c.op+": расшифровка секрета", "err", err)
		return factor, 0, internalError()
	}
	defer clear(secret)
	if step, ok := totpVerify(secret, c.code, now, factor.LastUsedStep); ok {
		return factor, step, nil
	}
	if _, ok := totpMatch(secret, c.code, now, math.MinInt64); ok {
		return factor, 0, mfaCodeReused()
	}
	return factor, 0, mfaWrongCode(mfaMaxFailures - attempts)
}

// acceptTotp — тело идемпотентного вызова в транзакции.
func (s *Service) acceptTotp(ctx context.Context, tx pgx.Tx, c secondFactorCall, user store.User, factor store.MfaFactor, step int64, now time.Time) error {
	sess, locked, err := lockedOperatorSession(ctx, tx, c.token, now)
	if err != nil {
		return err
	}
	if locked.ID != user.ID {
		return sessionInvalid()
	}
	q := store.New(tx)
	var n int64
	if c.enrolling {
		n, err = q.ConfirmMfaFactor(ctx, store.ConfirmMfaFactorParams{Now: ts(now), Step: step, UserID: user.ID, SecretEnc: factor.SecretEnc})
	} else {
		n, err = q.UseMfaStep(ctx, store.UseMfaStepParams{Step: step, UserID: user.ID, SecretEnc: factor.SecretEnc})
	}
	if err != nil {
		return err
	}
	if n == 0 {
		return stepRefusal(ctx, q, c.enrolling, user.ID, factor.SecretEnc)
	}
	if err := q.RefundRateLimit(ctx, mfaLimitKey(user.ID)); err != nil {
		return err
	}
	if sess, err = q.SetSessionMfaVerified(ctx, store.SetSessionMfaVerifiedParams{At: ts(now), ID: sess.ID}); err != nil {
		return err
	}
	if c.enrolling {
		if err := recordRoleEvent(ctx, tx, subjectMfaEnrolled, "senim.events.v1.MfaEnrolled",
			&eventsv1.MfaEnrolled{UserId: user.ID.String()},
			locked, mfaRole, "user.mfa_enrolled", map[string]string{"mfa": "none"}, map[string]string{"mfa": "totp"}, now); err != nil {
			return err
		}
	}
	c.done(sessionView(sess, locked))
	return nil
}

// stepRefusal объясняет, почему условный UPDATE фактора не прошёл: фактор между
// проверкой и транзакцией сброшен, подтверждён или заменён другим вызовом, или тот же
// шаг уже принят параллельным вводом.
func stepRefusal(ctx context.Context, q *store.Queries, enrolling bool, userID uuid.UUID, secretEnc string) error {
	f, err := q.LockMfaFactor(ctx, userID)
	switch {
	case errors.Is(err, pgx.ErrNoRows):
		return mfaNotEnrolled()
	case err != nil:
		return err
	case enrolling && f.ConfirmedAt.Valid:
		return mfaAlreadyEnrolled()
	case !enrolling && !f.ConfirmedAt.Valid:
		return mfaNotEnrolled()
	case f.SecretEnc != secretEnc:
		return mfaWrongCode(0)
	default:
		return mfaCodeReused()
	}
}

// resetMfa — тело identity mfa-reset: в одной транзакции удаляет фактор пользователя с
// телефоном phone, снимает отметку второго фактора со всех его сессий, пишет MfaReset и
// аудит (actor_kind "cli"). Ошибки не содержат телефона.
func resetMfa(ctx context.Context, pool *pgxpool.Pool, phone string, now time.Time) (uuid.UUID, error) {
	var userID uuid.UUID
	err := dbx.InTx(ctx, pool, func(tx pgx.Tx) error {
		q := store.New(tx)
		user, err := q.GetUserByPhone(ctx, phone)
		if errors.Is(err, pgx.ErrNoRows) {
			return errors.New("mfa-reset: пользователя с этим номером нет")
		}
		if err != nil {
			return err
		}
		if user, err = q.LockUser(ctx, user.ID); err != nil {
			return err
		}
		userID = user.ID
		factor, err := q.LockMfaFactor(ctx, user.ID)
		if errors.Is(err, pgx.ErrNoRows) {
			return errors.New("mfa-reset: у пользователя нет второго фактора")
		}
		if err != nil {
			return err
		}
		if _, err := q.DeleteMfaFactor(ctx, user.ID); err != nil {
			return err
		}
		if _, err := q.ClearUserSessionsMfa(ctx, user.ID); err != nil {
			return err
		}
		if _, err := outbox.Add(ctx, tx, ServiceID, subjectMfaReset, "senim.events.v1.MfaReset", &eventsv1.MfaReset{UserId: user.ID.String()}); err != nil {
			return err
		}
		state := "pending"
		if factor.ConfirmedAt.Valid {
			state = "totp"
		}
		before, err := json.Marshal(map[string]string{"mfa": state})
		if err != nil {
			return err
		}
		after, err := json.Marshal(map[string]string{"mfa": "none"})
		if err != nil {
			return err
		}
		_, err = outbox.Add(ctx, tx, ServiceID, subjectAudit, "senim.events.v1.AuditEvent", &eventsv1.AuditEvent{
			ActorKind:  "cli",
			ActorId:    "identity.mfa-reset",
			Action:     "user.mfa_reset",
			EntityType: "user",
			EntityId:   user.ID.String(),
			BeforeJson: string(before),
			AfterJson:  string(after),
			At:         timestamppb.New(now),
		})
		return err
	})
	return userID, err
}
