package internal

import (
	"context"
	"crypto/hmac"
	"crypto/sha256"
	"errors"
	"fmt"
	"strconv"
	"strings"
	"time"

	"connectrpc.com/connect/v2"
	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"google.golang.org/protobuf/proto"
	"google.golang.org/protobuf/types/known/timestamppb"

	identityv1 "github.com/CemeteryPlaya/senim-platform/gen/go/senim/identity/v1"
	"github.com/CemeteryPlaya/senim-platform/gen/go/senim/identity/v1/identityv1connect"
	"github.com/CemeteryPlaya/senim-platform/pkg/dbx"
	"github.com/CemeteryPlaya/senim-platform/pkg/idem"
	"github.com/CemeteryPlaya/senim-platform/services/identity/internal/store"
)

// Подтверждение e-mail кодом (последний шаг входа в новом интерфейсе). Образец — код по
// SMS (otp.go, verify.go): код из 6 цифр, в базе только HMAC, действует последний
// выданный, попытка засчитывается до сравнения.
const (
	emailCodeTTL     = 10 * time.Minute
	emailMaxAttempts = 5
	// Умолчания лимитов запроса кода на пользователя (IDENTITY_EMAIL_CODE_*; в prod слабее нельзя): раз в минуту, 5 в час, 10 в сутки.
	emailCooldown = time.Minute
	emailHourly   = 5
	emailDaily    = 10
	// Проверок кода — не больше 20 в сутки на пользователя (как verifyPhoneDaily у SMS).
	emailVerifyDaily = 20
)

func emailCodeExpired() error {
	return rpcError(connect.CodeInvalidArgument, "email_code_expired", nil)
}

func emailAttemptsExhausted() error {
	return rpcError(connect.CodeResourceExhausted, "email_code_attempts_exhausted", nil)
}

func emailAlreadyVerified() error {
	return rpcError(connect.CodeFailedPrecondition, "email_already_verified", nil)
}

// emailCodeAlreadySent — запрос раньше минуты, но на этот же адрес уже выдан действующий
// код: его можно ввести (web ведёт на шаг кода). Тот же статус, что у email_code_too_often:
// отказ по лимиту, и потерянный ответ прежнего запроса так же находится повтором Lookup.
func emailCodeAlreadySent() error {
	return rpcError(connect.CodeResourceExhausted, "email_code_already_sent", nil)
}

// emailVerifiedAudit — значение аудита подтверждения: только «подтверждён / нет», без адреса.
type emailVerifiedAudit struct {
	Verified bool `json:"verified"`
}

// contactRole — почта, как и контакты (UpdateContacts), у сторон сделки.
func contactRole(role string) bool { return role == "CLIENT" || role == "EXECUTOR" }

// emailSession — чтение до ключа идемпотентности: живая сессия и роль стороны сделки.
func (s *Service) emailSession(ctx context.Context, op, token string) (store.User, error) {
	sess, user, err := s.liveSession(ctx, op, token)
	if err != nil {
		return user, err
	}
	if !contactRole(activeRole(user.Roles, user.DefaultRole, &sess.ActiveRole)) {
		return user, rpcError(connect.CodePermissionDenied, "role_forbidden", nil)
	}
	return user, nil
}

// lockedEmailSession — то же в транзакции под блокировкой пользователя: сессия ещё та же,
// роль (её могли переключить между чтением и транзакцией) — сторона сделки.
func lockedEmailSession(ctx context.Context, tx pgx.Tx, token string, userID uuid.UUID, now time.Time) (store.User, string, error) {
	sess, user, err := lockedSession(ctx, tx, token, now)
	if err != nil {
		return user, "", err
	}
	if user.ID != userID {
		return user, "", sessionInvalid()
	}
	role := activeRole(user.Roles, user.DefaultRole, &sess.ActiveRole)
	if !contactRole(role) {
		return user, "", rpcError(connect.CodePermissionDenied, "role_forbidden", nil)
	}
	return user, role, nil
}

// RequestEmailCode выдаёт код подтверждения на адрес-кандидат и отправляет его. Адрес
// хранится вместе с кодом; в persons.email он попадает только после VerifyEmailCode.
//
// Порядок как в RequestOtp: вызывающий, формат, сессия и роль (чтение), повтор по ключу,
// лимиты (отдельными командами: отказанный запрос тоже засчитывается; отказ по лимиту
// повторяет Lookup — ответ успевшего вызова с этим ключом), затем транзакция: прежние коды
// гасятся, новый пишется, письмо уходит.
//
// Пауза в минуту не прошла: если у человека есть действующий код (не истёк, не погашен,
// попытки не исчерпаны) на этот же нормализованный адрес — email_code_already_sent (код
// можно ввести), иначе email_code_too_often. Сведения — о самом человеке, чужого не раскрывают.
//
// Тот же адрес уже подтверждён — email_already_verified (FailedPrecondition): код не
// выдаётся, лимит не тратится, web пропускает шаг почты. Проверка — после повтора по ключу:
// потерянный ответ прежнего запроса возвращается как есть.
//
// demo_code — только при провайдере mock (в prod он запрещён конфигом) и только в этом
// ответе: в сохранённый идемпотентный ответ код не попадает, повтор вернёт его пустым.
func (s *Service) RequestEmailCode(ctx context.Context, req *identityv1.RequestEmailCodeRequest) (*identityv1.RequestEmailCodeResponse, error) {
	if err := requireCaller(ctx, webCaller); err != nil {
		return nil, err
	}
	const op, method = "email_request", identityv1connect.IdentityServiceRequestEmailCodeProcedure
	key := req.GetIdempotencyKey()
	if !validIdempotencyKey(key) {
		return nil, invalidRequest()
	}
	email, ok := normalizeEmail(req.GetEmail())
	if !ok || email == "" {
		return nil, emailInvalid()
	}
	user, err := s.emailSession(ctx, op, req.GetSessionToken())
	if err != nil {
		return nil, err
	}
	saved := &identityv1.RequestEmailCodeResponse{}
	found, err := s.lookup(ctx, op, method, key, req, saved)
	if err != nil {
		return nil, err
	}
	if found {
		return saved, nil
	}
	current, err := personOf(ctx, store.New(s.pool), user.ID)
	if err != nil {
		s.log.ErrorContext(ctx, op+": поиск личности", "err", err)
		return nil, internalError()
	}
	if current.EmailVerifiedAt.Valid && current.Email.String == email {
		return nil, emailAlreadyVerified()
	}

	if err := s.enforceEmailLimits(ctx, op, user.ID, email); err != nil {
		if connect.CodeOf(err) == connect.CodeResourceExhausted {
			again := &identityv1.RequestEmailCodeResponse{}
			if found, lerr := idem.Lookup(ctx, s.pool, method, key, req, again); lerr == nil && found {
				return again, nil
			}
		}
		return nil, err
	}

	resp := &identityv1.RequestEmailCodeResponse{}
	demoCode := ""
	err = dbx.InTx(ctx, s.pool, func(tx pgx.Tx) error {
		_, err := idem.Do(ctx, tx, method, key, req, resp, func() error {
			now := s.now()
			if _, _, err := lockedEmailSession(ctx, tx, req.GetSessionToken(), user.ID, now); err != nil {
				return err
			}
			code, err := newOtpCode()
			if err != nil {
				return err
			}
			expiresAt := now.Add(emailCodeTTL)
			q := store.New(tx)
			if err := q.RetireEmailCodes(ctx, store.RetireEmailCodesParams{UserID: user.ID, Now: ts(now)}); err != nil {
				return fmt.Errorf("гашение прежних кодов почты: %w", err)
			}
			if err := q.InsertEmailCode(ctx, store.InsertEmailCodeParams{
				UserID:    user.ID,
				Email:     email,
				CodeHash:  emailHash(s.cfg.OTPHMACKey, user.ID, email, code),
				ExpiresAt: ts(expiresAt),
				CreatedAt: ts(now),
			}); err != nil {
				return fmt.Errorf("запись кода почты: %w", err)
			}
			// Отправка внутри транзакции, как у SMS: мок ничего не отправляет.
			// TODO(план 6): настоящий провайдер — отправка через outbox (письмо уходит после
			// коммита), потолок отправок на адрес и общий суточный потолок писем.
			if err := s.email.Send(ctx, email, code); err != nil {
				return fmt.Errorf("отправка кода почты: %w", err)
			}
			resp.ExpiresAt = timestamppb.New(expiresAt)
			if s.showsEmailDemoCode() {
				demoCode = code
			}
			return nil
		})
		return err
	})
	if errors.Is(err, idem.ErrKeyReused) {
		return nil, rpcError(connect.CodeInvalidArgument, "idempotency_key_reused", nil)
	}
	var ce *connect.Error
	if errors.As(err, &ce) {
		return nil, err // отказ по делу: сессия отозвана, роль сменилась
	}
	if err != nil {
		// Лимиты уже засчитаны, письмо могло уйти: Unavailable здесь запрещён.
		s.log.ErrorContext(ctx, op+": выдача кода", "err", err)
		return nil, internalError()
	}
	out, _ := proto.Clone(resp).(*identityv1.RequestEmailCodeResponse)
	out.DemoCode = demoCode
	return out, nil
}

// showsEmailDemoCode — код возвращается в ответе при мок-провайдере: письмо никуда не
// уходит, человеку код показывает web. От DEMO_MODE не зависит; в prod мок запрещён.
func (s *Service) showsEmailDemoCode() bool { return s.cfg.EmailProvider == "mock" }

// enforceEmailLimits — лимиты запроса кода на пользователя (общие счётчики rate_limits).
// Отказ по паузе уточняется: действующий код на этот же адрес — email_code_already_sent.
func (s *Service) enforceEmailLimits(ctx context.Context, op string, userID uuid.UUID, email string) error {
	lim := limiter{now: s.now}
	base := "email:user:" + userID.String()
	for _, l := range []struct {
		key    string
		limit  int
		window time.Duration
		reason string
	}{
		{base + ":cooldown", 1, s.cfg.EmailCodeCooldown, "email_code_too_often"},
		{base, s.cfg.EmailCodeHourlyLimit, hour, "email_code_too_many"},
		{base + ":day", s.cfg.EmailCodeDailyLimit, day, "email_code_too_many"},
	} {
		allowed, err := lim.hit(ctx, s.pool, l.key, l.limit, l.window)
		if err != nil {
			s.log.ErrorContext(ctx, op+": счётчик лимита", "err", err)
			return internalError()
		}
		if !allowed {
			if l.reason == "email_code_too_often" {
				return s.cooldownRefusal(ctx, op, userID, email)
			}
			return rpcError(connect.CodeResourceExhausted, l.reason, nil)
		}
	}
	return nil
}

// cooldownRefusal — отказ по паузе: email_code_already_sent, если действующий код человека
// (не истёк, не погашен, попытки не исчерпаны) выдан на этот же адрес, иначе email_code_too_often.
func (s *Service) cooldownRefusal(ctx context.Context, op string, userID uuid.UUID, email string) error {
	row, err := store.New(s.pool).GetActiveEmailCode(ctx, store.GetActiveEmailCodeParams{UserID: userID, Now: ts(s.now())})
	if errors.Is(err, pgx.ErrNoRows) {
		return rpcError(connect.CodeResourceExhausted, "email_code_too_often", nil)
	}
	if err != nil {
		s.log.ErrorContext(ctx, op+": поиск действующего кода", "err", err)
		return internalError()
	}
	if row.Email == email && row.Attempts < emailMaxAttempts {
		return emailCodeAlreadySent()
	}
	return rpcError(connect.CodeResourceExhausted, "email_code_too_often", nil)
}

// VerifyEmailCode проверяет код и подтверждает адрес-кандидат. Успех — одна транзакция:
// код гасится, persons.email = адрес-кандидат, email_verified_at = сейчас, в outbox —
// аудит user.email_verified (и user.email_changed, если адрес сменился) без адреса.
//
// Порядок как в VerifyOtp: вызывающий, формат (ключ; код — ровно шесть цифр, иначе
// invalid_request без траты попытки и лимита; адрес — как в RequestEmailCode, иначе
// email_invalid), сессия и роль (чтение), повтор по ключу, суточный лимит проверок, сверка
// адреса с адресом действующего кода (не совпал — email_code_expired: попытка не тратится,
// код не гасится; подтверждается ровно адрес, показанный человеку), засчитывание попытки и
// сравнение (вне транзакции: попытка остаётся и при откате), затем транзакция. Отказ до
// транзакции повторяет Lookup — ответ успевшего вызова с этим ключом.
func (s *Service) VerifyEmailCode(ctx context.Context, req *identityv1.VerifyEmailCodeRequest) (*identityv1.VerifyEmailCodeResponse, error) {
	if err := requireCaller(ctx, webCaller); err != nil {
		return nil, err
	}
	const op, method = "email_verify", identityv1connect.IdentityServiceVerifyEmailCodeProcedure
	key := req.GetIdempotencyKey()
	code := strings.TrimSpace(req.GetCode())
	if !validIdempotencyKey(key) || !validTotpFormat(code) { // шесть ASCII-цифр, как код TOTP
		return nil, invalidRequest()
	}
	email, ok := normalizeEmail(req.GetEmail())
	if !ok || email == "" {
		return nil, emailInvalid()
	}
	user, err := s.emailSession(ctx, op, req.GetSessionToken())
	if err != nil {
		return nil, err
	}
	resp := &identityv1.VerifyEmailCodeResponse{}
	found, err := s.lookup(ctx, op, method, key, req, resp)
	if err != nil {
		return nil, err
	}
	if found {
		return resp, nil
	}

	row, refusal := s.checkEmailCode(ctx, op, user.ID, email, code)
	if refusal != nil {
		again := &identityv1.VerifyEmailCodeResponse{}
		if found, lerr := idem.Lookup(ctx, s.pool, method, key, req, again); lerr == nil && found {
			return again, nil
		}
		return nil, refusal
	}

	err = s.idempotent(ctx, op, method, key, req, resp, func(tx pgx.Tx) error {
		now := s.now()
		locked, role, err := lockedEmailSession(ctx, tx, req.GetSessionToken(), user.ID, now)
		if err != nil {
			return err
		}
		q := store.New(tx)
		consumed, err := q.ConsumeEmailCode(ctx, store.ConsumeEmailCodeParams{ID: row.ID, Now: ts(now)})
		if err != nil {
			return err
		}
		if consumed != 1 {
			return emailCodeExpired() // погашен другим вводом или новым запросом кода
		}
		before, err := personOf(ctx, q, user.ID)
		if err != nil {
			return err
		}
		after, err := q.SetVerifiedEmail(ctx, store.SetVerifiedEmailParams{UserID: user.ID, Email: text(row.Email), Now: ts(now)})
		if err != nil {
			return err
		}
		if before.Email != after.Email {
			if err := recordAudit(ctx, tx, locked, role, "user.email_changed", contactSet{before.Email.Valid}, contactSet{true}, now); err != nil {
				return err
			}
		}
		wasVerified := before.EmailVerifiedAt.Valid && before.Email == after.Email
		if err := recordAudit(ctx, tx, locked, role, "user.email_verified", emailVerifiedAudit{wasVerified}, emailVerifiedAudit{true}, now); err != nil {
			return err
		}
		resp.Person = personProto(after)
		return nil
	})
	if err != nil {
		return nil, err
	}
	return resp, nil
}

// checkEmailCode применяет суточный лимит проверок, сверяет адрес с адресом действующего
// кода (до попытки), засчитывает попытку до сравнения (условным UPDATE: параллельный перебор
// не обходит предел) и сравнивает код за постоянное время. Возвращает строку кода, если он
// верный, иначе отказ.
func (s *Service) checkEmailCode(ctx context.Context, op string, userID uuid.UUID, email, code string) (store.EmailCode, error) {
	allowed, err := limiter{now: s.now}.hit(ctx, s.pool, "email:verify:user:"+userID.String()+":day", s.cfg.EmailVerifyDailyLimit, day)
	if err != nil {
		s.log.ErrorContext(ctx, op+": счётчик лимита проверки", "err", err)
		return store.EmailCode{}, internalError()
	}
	if !allowed {
		return store.EmailCode{}, rpcError(connect.CodeResourceExhausted, "email_code_too_many", nil)
	}
	q := store.New(s.pool)
	row, err := q.GetActiveEmailCode(ctx, store.GetActiveEmailCodeParams{UserID: userID, Now: ts(s.now())})
	if errors.Is(err, pgx.ErrNoRows) {
		return row, emailCodeExpired()
	}
	if err != nil {
		s.log.ErrorContext(ctx, op+": поиск кода", "err", err)
		return row, internalError()
	}
	if row.Email != email {
		// Код выдан на другой адрес (вторая вкладка, перезагрузка): для показанного адреса
		// действующего кода нет. Попытка не тратится, код другого адреса не гасится.
		return row, emailCodeExpired()
	}
	attempts, err := q.CountEmailAttempt(ctx, store.CountEmailAttemptParams{ID: row.ID, MaxAttempts: emailMaxAttempts})
	if errors.Is(err, pgx.ErrNoRows) {
		// Попытка не засчитана: код погашен между чтением и счётом (новый запрос кода, смена
		// адреса, параллельный верный ввод) — email_code_expired; иначе попытки исчерпаны.
		consumed, cerr := q.EmailCodeConsumed(ctx, row.ID)
		if cerr != nil {
			s.log.ErrorContext(ctx, op+": состояние кода", "err", cerr)
			return row, internalError()
		}
		if consumed {
			return row, emailCodeExpired()
		}
		return row, emailAttemptsExhausted()
	}
	if err != nil {
		s.log.ErrorContext(ctx, op+": засчитывание попытки", "err", err)
		return row, internalError()
	}
	if !hmac.Equal(row.CodeHash, emailHash(s.cfg.OTPHMACKey, userID, row.Email, code)) {
		if left := emailMaxAttempts - int(attempts); left > 0 {
			return row, rpcError(connect.CodeInvalidArgument, "email_code_wrong", map[string]string{"left": strconv.Itoa(left)})
		}
		return row, emailAttemptsExhausted()
	}
	return row, nil
}

// emailHash — HMAC-SHA256(ключ, "email:v1:"+user_id+":"+адрес+":"+код). Домен "email:v1"
// отделяет его от кодов SMS (otpHash) под тем же ключом; пользователь и адрес в составе,
// чтобы хэш не переносился на другого человека или другой адрес.
func emailHash(key []byte, userID uuid.UUID, email, code string) []byte {
	m := hmac.New(sha256.New, key)
	m.Write([]byte("email:v1:" + userID.String() + ":" + email + ":" + code))
	return m.Sum(nil)
}
