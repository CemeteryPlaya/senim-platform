package internal

import (
	"context"
	"crypto/hmac"
	"encoding/base64"
	"errors"
	"strconv"
	"strings"
	"time"

	"connectrpc.com/connect/v2"
	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgtype"
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
	otpMaxAttempts = 5
	// Лимиты проверки кода, перенесены из otp.ts: 20 проверок в сутки на номер, 50 в час с IP.
	verifyPhoneDaily = 20
	verifyIPHourly   = 50

	sessionTokenBytes = 32

	subjectUserRegistered = "senim.identity.user.registered"
	subjectAudit          = "senim.identity.audit"
)

// validSessionToken — base64url без «=» от 32 байт (43 символа).
func validSessionToken(token string) bool {
	if len(token) != base64.RawURLEncoding.EncodedLen(sessionTokenBytes) {
		return false
	}
	b, err := base64.RawURLEncoding.DecodeString(token)
	return err == nil && len(b) == sessionTokenBytes
}

// VerifyOtp проверяет код и начинает сессию от токена, который сгенерировал web.
//
// Порядок: вызывающий, формат запроса, повтор по ключу (Lookup ждёт идущий вызов с тем же
// ключом: повтор web после дедлайна получает ответ первого, а не otp_expired — код уже
// погашен), лимиты, засчитывание попытки и сравнение кода (вне транзакции, как в otp.ts:
// счётчики остаются и при откате), затем транзакция с гашением кода, пользователем,
// сессией и событиями.
//
// Отказы, возникшие до Do (лимиты, исчерпанные попытки, неверный или истёкший код),
// повторно проверяют Lookup: если вызов с этим ключом успел завершиться между первым
// Lookup и отказом, возвращается его сохранённый ответ. Остаётся окно двух одновременных
// вызовов с одним ключом в фазе лимитов (как в RequestOtp): худший исход — отказ вместо
// ответа, двойного эффекта быть не может.
func (s *Service) VerifyOtp(ctx context.Context, req *identityv1.VerifyOtpRequest) (*identityv1.VerifyOtpResponse, error) {
	if err := requireCaller(ctx, webCaller); err != nil {
		return nil, err
	}
	if !validSessionToken(req.GetSessionToken()) {
		return nil, rpcError(connect.CodeInvalidArgument, "session_token_invalid", nil)
	}
	key := req.GetIdempotencyKey()
	if key == "" || len(key) > maxIdempotencyKey {
		return nil, rpcError(connect.CodeInvalidArgument, "invalid_request", nil)
	}
	ip, ok := parseClientIP(req.GetClientIp())
	if !ok {
		return nil, rpcError(connect.CodeInvalidArgument, "invalid_request", nil)
	}
	phone, ok := parsePhone(req.GetPhone())
	if !ok {
		return nil, rpcError(connect.CodeInvalidArgument, "invalid_phone", nil)
	}

	const method = identityv1connect.IdentityServiceVerifyOtpProcedure
	saved := &identityv1.VerifyOtpResponse{}
	found, err := idem.Lookup(ctx, s.pool, method, key, req, saved)
	if errors.Is(err, idem.ErrKeyReused) {
		return nil, rpcError(connect.CodeInvalidArgument, "idempotency_key_reused", nil)
	}
	if err != nil {
		// Побочных эффектов ещё нет: «повторите» — правда.
		s.log.ErrorContext(ctx, "otp: проверка ключа идемпотентности", "err", err)
		return nil, connect.NewError(connect.CodeUnavailable, "unavailable")
	}
	if found {
		return saved, nil
	}

	otpID, refusal := s.checkCode(ctx, phone, ip, req.GetCode())
	if refusal != nil {
		again := &identityv1.VerifyOtpResponse{}
		if found, lerr := idem.Lookup(ctx, s.pool, method, key, req, again); lerr == nil && found {
			return again, nil
		}
		return nil, refusal
	}

	resp := &identityv1.VerifyOtpResponse{}
	err = dbx.InTx(ctx, s.pool, func(tx pgx.Tx) error {
		_, err := idem.Do(ctx, tx, method, key, req, resp, func() error {
			return s.signIn(ctx, tx, req, phone, otpID, resp)
		})
		return err
	})
	if errors.Is(err, idem.ErrKeyReused) {
		return nil, rpcError(connect.CodeInvalidArgument, "idempotency_key_reused", nil)
	}
	var ce *connect.Error
	if errors.As(err, &ce) {
		return nil, err // отказ по делу: код погашен другим вводом, пользователь заблокирован
	}
	if err != nil {
		s.log.ErrorContext(ctx, "otp: вход", "err", err)
		return nil, internalError()
	}
	return resp, nil
}

// checkCode применяет лимиты проверки, засчитывает попытку до сравнения (условным UPDATE:
// параллельный перебор не обходит предел) и сравняет код за постоянное время. Возвращает
// id строки кода, если он верный, иначе отказ.
func (s *Service) checkCode(ctx context.Context, phone, ip, code string) (otpID uuid.UUID, refusal error) {
	lim := limiter{now: s.now}
	hit := func(key string, limit int, window time.Duration, reason string) error {
		allowed, err := lim.hit(ctx, s.pool, key, limit, window)
		if err != nil {
			s.log.ErrorContext(ctx, "otp: счётчик лимита проверки", "err", err)
			return internalError()
		}
		if !allowed {
			return rpcError(connect.CodeResourceExhausted, reason, nil)
		}
		return nil
	}
	if ip != "" {
		if err := hit("otp:verify:ip:"+ip, verifyIPHourly, hour, "otp_too_many_requests"); err != nil {
			return otpID, err
		}
	}
	if err := hit("otp:verify:phone:"+phone+":day", verifyPhoneDaily, day, "otp_too_many_today"); err != nil {
		return otpID, err
	}

	q := store.New(s.pool)
	otp, err := q.GetActiveOtp(ctx, store.GetActiveOtpParams{Phone: phone, Now: pgtype.Timestamptz{Time: s.now(), Valid: true}})
	if errors.Is(err, pgx.ErrNoRows) {
		return otpID, rpcError(connect.CodeInvalidArgument, "otp_expired", nil)
	}
	if err != nil {
		s.log.ErrorContext(ctx, "otp: поиск кода", "err", err)
		return otpID, internalError()
	}
	attempts, err := q.CountOtpAttempt(ctx, store.CountOtpAttemptParams{ID: otp.ID, MaxAttempts: otpMaxAttempts})
	if errors.Is(err, pgx.ErrNoRows) {
		return otpID, rpcError(connect.CodeResourceExhausted, "otp_attempts_exhausted", nil)
	}
	if err != nil {
		s.log.ErrorContext(ctx, "otp: засчитывание попытки", "err", err)
		return otpID, internalError()
	}
	if !hmac.Equal(otp.CodeHash, otpHash(s.cfg.OTPHMACKey, phone, strings.TrimSpace(code))) {
		if left := otpMaxAttempts - int(attempts); left > 0 {
			return otpID, rpcError(connect.CodeInvalidArgument, "otp_wrong_code", map[string]string{"left": strconv.Itoa(left)})
		}
		return otpID, rpcError(connect.CodeResourceExhausted, "otp_attempts_exhausted", nil)
	}
	return otp.ID, nil
}

// signIn — тело идемпотентного вызова в транзакции: гасит код, находит или создаёт
// пользователя, отказывает заблокированному, создаёт сессию и заполняет ответ.
// Отказ откатывает транзакцию целиком, в том числе гашение кода.
func (s *Service) signIn(ctx context.Context, tx pgx.Tx, req *identityv1.VerifyOtpRequest, phone string, otpID uuid.UUID, resp *identityv1.VerifyOtpResponse) error {
	now := s.now()
	q := store.New(tx)
	consumed, err := q.ConsumeOtp(ctx, store.ConsumeOtpParams{ID: otpID, Now: pgtype.Timestamptz{Time: now, Valid: true}})
	if err != nil {
		return err
	}
	if consumed != 1 {
		return rpcError(connect.CodeInvalidArgument, "otp_expired", nil)
	}

	isNew := false
	user, err := q.GetUserByPhone(ctx, phone)
	switch {
	case errors.Is(err, pgx.ErrNoRows):
		user, err = q.CreateUser(ctx, store.CreateUserParams{Phone: phone, Roles: []string{"CLIENT"}, DefaultRole: "CLIENT"})
		if err != nil {
			return err
		}
		isNew = true
		if err := s.recordRegistered(ctx, tx, user, now); err != nil {
			return err
		}
	case err != nil:
		return err
	case user.BlockedAt.Valid:
		return rpcError(connect.CodePermissionDenied, "user_blocked", nil)
	}

	sess, err := createSession(ctx, tx, user, req.GetSessionToken(), req.GetUserAgent(), "", now)
	if err != nil {
		return err
	}
	resp.User = userProto(user)
	resp.Session = sessionProto(sess, idleTimeout)
	resp.IsNew = isNew
	return nil
}

// recordRegistered пишет в outbox UserRegistered и событие аудита; вызывается в той же
// транзакции, что и вставка пользователя.
func (s *Service) recordRegistered(ctx context.Context, tx pgx.Tx, user store.User, now time.Time) error {
	if _, err := outbox.Add(ctx, tx, ServiceID, subjectUserRegistered, "senim.events.v1.UserRegistered", &eventsv1.UserRegistered{
		UserId: user.ID.String(),
		Role:   roleProto(user.DefaultRole),
	}); err != nil {
		return err
	}
	_, err := outbox.Add(ctx, tx, ServiceID, subjectAudit, "senim.events.v1.AuditEvent", &eventsv1.AuditEvent{
		ActorKind:  "system",
		ActorId:    "identity.otp",
		Action:     "user.registered",
		EntityType: "user",
		EntityId:   user.ID.String(),
		AfterJson:  `{"role":"` + user.DefaultRole + `"}`,
		At:         timestamppb.New(now),
	})
	return err
}
