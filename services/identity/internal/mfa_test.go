package internal

import (
	"bytes"
	"context"
	"encoding/base32"
	"strings"
	"sync"
	"testing"
	"time"

	"connectrpc.com/connect/v2"
	"github.com/golang-jwt/jwt/v5"
	"google.golang.org/protobuf/proto"

	eventsv1 "github.com/CemeteryPlaya/senim-platform/gen/go/senim/events/v1"
	identityv1 "github.com/CemeteryPlaya/senim-platform/gen/go/senim/identity/v1"
	"github.com/CemeteryPlaya/senim-platform/gen/go/senim/identity/v1/identityv1connect"
	"github.com/CemeteryPlaya/senim-platform/services/identity/internal/store"
)

var b32 = base32.StdEncoding.WithPadding(base32.NoPadding)

func (h *harness) startTotp(token, key string) (*identityv1.StartTotpEnrollmentResponse, error) {
	h.t.Helper()
	return idc(h, "web", func(ctx context.Context, c identityv1connect.IdentityServiceClient) (*identityv1.StartTotpEnrollmentResponse, error) {
		return c.StartTotpEnrollment(ctx, &identityv1.StartTotpEnrollmentRequest{SessionToken: token, IdempotencyKey: key})
	})
}

func (h *harness) confirmTotp(token, code, key string) (*identityv1.ConfirmTotpEnrollmentResponse, error) {
	h.t.Helper()
	return idc(h, "web", func(ctx context.Context, c identityv1connect.IdentityServiceClient) (*identityv1.ConfirmTotpEnrollmentResponse, error) {
		return c.ConfirmTotpEnrollment(ctx, &identityv1.ConfirmTotpEnrollmentRequest{SessionToken: token, Code: code, IdempotencyKey: key})
	})
}

func (h *harness) verify2FA(token, code, key string) (*identityv1.VerifySecondFactorResponse, error) {
	h.t.Helper()
	return idc(h, "web", func(ctx context.Context, c identityv1connect.IdentityServiceClient) (*identityv1.VerifySecondFactorResponse, error) {
		return c.VerifySecondFactor(ctx, &identityv1.VerifySecondFactorRequest{SessionToken: token, Code: code, IdempotencyKey: key})
	})
}

// operator — пользователь-оператор и его сессия (вход по коду, без второго фактора).
func (h *harness) operator() (store.User, string) {
	h.t.Helper()
	u := h.user([]string{"OPERATOR"}, "OPERATOR")
	return u, h.session(u)
}

// mustStart начинает подключение и возвращает секрет (байты).
func (h *harness) mustStart(token string) []byte {
	h.t.Helper()
	res, err := h.startTotp(token, h.key())
	if err != nil {
		h.t.Fatalf("StartTotpEnrollment: %v", err)
	}
	secret, err := b32.DecodeString(res.GetSecretBase32())
	if err != nil {
		h.t.Fatalf("секрет не base32: %v", err)
	}
	return secret
}

// codeNow — код TOTP по часам сервиса.
func (h *harness) codeNow(secret []byte) string {
	return totpCode(secret, h.clock.now().Unix()/totpPeriod)
}

// enrolled — оператор с подтверждённым фактором; возвращает секрет. Часы сдвигаются на
// шаг, чтобы следующий код был новым.
func (h *harness) enrolled(token string) []byte {
	h.t.Helper()
	secret := h.mustStart(token)
	if _, err := h.confirmTotp(token, h.codeNow(secret), h.key()); err != nil {
		h.t.Fatalf("ConfirmTotpEnrollment: %v", err)
	}
	h.clock.advance(totpPeriod * time.Second)
	return secret
}

// wrongCode — шесть цифр, не совпадающие с кодами окна ±1.
func (h *harness) wrongCode(secret []byte) string {
	step := h.clock.now().Unix() / totpPeriod
	for _, c := range []string{"000000", "111111", "222222", "333333"} {
		if c != totpCode(secret, step-1) && c != totpCode(secret, step) && c != totpCode(secret, step+1) {
			return c
		}
	}
	h.t.Fatal("не нашлось неверного кода")
	return ""
}

func (h *harness) factor(userID string) (store.MfaFactor, bool) {
	h.t.Helper()
	var f store.MfaFactor
	err := h.pool.QueryRow(context.Background(), `SELECT user_id, secret_enc, confirmed_at, last_used_step, created_at FROM mfa_factors WHERE user_id = $1`, userID).
		Scan(&f.UserID, &f.SecretEnc, &f.ConfirmedAt, &f.LastUsedStep, &f.CreatedAt)
	if err != nil {
		return f, false
	}
	return f, true
}

func (h *harness) mfaEvents(subject, userID string) int {
	h.t.Helper()
	n := 0
	switch subject {
	case subjectMfaEnrolled:
		for _, e := range outboxEvents(h, subject, func() *eventsv1.MfaEnrolled { return &eventsv1.MfaEnrolled{} }) {
			if e.GetUserId() == userID {
				n++
			}
		}
	case subjectMfaReset:
		for _, e := range outboxEvents(h, subject, func() *eventsv1.MfaReset { return &eventsv1.MfaReset{} }) {
			if e.GetUserId() == userID {
				n++
			}
		}
	}
	return n
}

// tokenClaims разбирает внутренний токен ответа Authenticate (подпись проверяется).
func (h *harness) tokenClaims(token string) jwt.MapClaims {
	h.t.Helper()
	res := h.mustAuth(token)
	claims := jwt.MapClaims{}
	_, err := jwt.ParseWithClaims(res.GetAccessToken(), claims, func(*jwt.Token) (any, error) {
		return testSigningKey.Public(), nil
	}, jwt.WithValidMethods([]string{"EdDSA"}), jwt.WithTimeFunc(h.clock.now))
	if err != nil {
		h.t.Fatalf("токен: %v", err)
	}
	return claims
}

func TestEnrollAndConfirm(t *testing.T) {
	h := newHarness(t, nil)
	u, token := h.operator()

	res, err := h.startTotp(token, h.key())
	if err != nil {
		t.Fatal(err)
	}
	if len(res.GetSecretBase32()) != 32 {
		t.Fatalf("секрет %d символов, want 32", len(res.GetSecretBase32()))
	}
	secret, err := b32.DecodeString(res.GetSecretBase32())
	if err != nil || len(secret) != 20 {
		t.Fatalf("секрет: %d байт, %v", len(secret), err)
	}
	f, ok := h.factor(u.ID.String())
	if !ok || f.ConfirmedAt.Valid || !strings.HasPrefix(f.SecretEnc, "v2.") || strings.Contains(f.SecretEnc, res.GetSecretBase32()) {
		t.Fatalf("фактор до подтверждения: %+v %v", f, ok)
	}
	// Открытый секрет не лежит в сохранённых ответах идемпотентности.
	if n := h.count(`SELECT count(*) FROM idempotency WHERE position($1::bytea in response) > 0`, []byte(res.GetSecretBase32())); n != 0 {
		t.Fatal("секрет в таблице idempotency")
	}
	if strings.Contains(h.logs.String(), res.GetSecretBase32()) {
		t.Fatal("секрет в логе")
	}

	now := h.clock.now()
	conf, err := h.confirmTotp(token, h.codeNow(secret), h.key())
	if err != nil {
		t.Fatal(err)
	}
	if !conf.GetSession().GetMfaRequired() || !conf.GetSession().GetMfaVerifiedAt().AsTime().Equal(now) {
		t.Fatalf("сессия: %v", conf.GetSession())
	}
	f, _ = h.factor(u.ID.String())
	if !f.ConfirmedAt.Valid || !f.ConfirmedAt.Time.Equal(now) || f.LastUsedStep != now.Unix()/totpPeriod {
		t.Fatalf("фактор после подтверждения: %+v", f)
	}
	if s := h.sessionRow(token); !s.MfaVerifiedAt.Valid || !s.MfaVerifiedAt.Time.Equal(now) {
		t.Fatalf("mfa_verified_at = %v", s.MfaVerifiedAt)
	}
	if n := h.mfaEvents(subjectMfaEnrolled, u.ID.String()); n != 1 {
		t.Fatalf("MfaEnrolled: %d, want 1", n)
	}
	audit := h.auditOf(u.ID.String(), "user.mfa_enrolled")
	if len(audit) != 1 || audit[0].GetActorKind() != "user" || audit[0].GetActorRole() != "OPERATOR" {
		t.Fatalf("аудит: %v", audit)
	}
	if strings.Contains(audit[0].GetAfterJson(), res.GetSecretBase32()) {
		t.Fatal("секрет в аудите")
	}
}

// Повтор Start до подтверждения выдаёт новый секрет, старый перестаёт действовать; тот же
// ключ — тот же секрет.
func TestStartEnrollmentAgainBeforeConfirm(t *testing.T) {
	h := newHarness(t, nil)
	_, token := h.operator()
	key := h.key()
	first, err := h.startTotp(token, key)
	if err != nil {
		t.Fatal(err)
	}
	again, err := h.startTotp(token, key)
	if err != nil || again.GetSecretBase32() != first.GetSecretBase32() {
		t.Fatalf("повтор с тем же ключом: %v %v", again, err)
	}
	second, err := h.startTotp(token, h.key())
	if err != nil {
		t.Fatal(err)
	}
	if second.GetSecretBase32() == first.GetSecretBase32() {
		t.Fatal("второй Start вернул прежний секрет")
	}
	old, _ := b32.DecodeString(first.GetSecretBase32())
	_, err = h.confirmTotp(token, h.codeNow(old), h.key())
	h.wantRefusal(err, connect.CodeInvalidArgument, "mfa_wrong_code")
	cur, _ := b32.DecodeString(second.GetSecretBase32())
	if _, err := h.confirmTotp(token, h.codeNow(cur), h.key()); err != nil {
		t.Fatalf("подтверждение новым секретом: %v", err)
	}
}

func TestStartEnrollmentTwiceAfterConfirm(t *testing.T) {
	h := newHarness(t, nil)
	_, token := h.operator()
	key := h.key()
	res, err := h.startTotp(token, key)
	if err != nil {
		t.Fatal(err)
	}
	secret, _ := b32.DecodeString(res.GetSecretBase32())
	if _, err := h.confirmTotp(token, h.codeNow(secret), h.key()); err != nil {
		t.Fatal(err)
	}
	// Повтор Start по прежнему ключу после подтверждения секрет второй раз не показывает.
	_, err = h.startTotp(token, key)
	h.wantRefusal(err, connect.CodeFailedPrecondition, "mfa_already_enrolled")
	_, err = h.startTotp(token, h.key())
	h.wantRefusal(err, connect.CodeFailedPrecondition, "mfa_already_enrolled")
	_, err = h.confirmTotp(token, "123456", h.key())
	h.wantRefusal(err, connect.CodeFailedPrecondition, "mfa_already_enrolled")
}

func TestStartEnrollmentNonOperator(t *testing.T) {
	h := newHarness(t, nil)
	u := h.user([]string{"CLIENT", "EXECUTOR"}, "EXECUTOR")
	token := h.session(u)
	_, err := h.startTotp(token, h.key())
	h.wantRefusal(err, connect.CodeFailedPrecondition, "mfa_not_required")
	_, err = h.confirmTotp(token, "123456", h.key())
	h.wantRefusal(err, connect.CodeFailedPrecondition, "mfa_not_required")
	_, err = h.verify2FA(token, "123456", h.key())
	h.wantRefusal(err, connect.CodeFailedPrecondition, "mfa_not_required")
	if _, ok := h.factor(u.ID.String()); ok {
		t.Fatal("фактор у клиента")
	}
	if s := h.mustAuth(token).GetSession(); s.GetMfaRequired() || s.GetMfaVerifiedAt() != nil {
		t.Fatalf("сессия клиента: %v", s)
	}
}

func TestMfaRequestValidation(t *testing.T) {
	h := newHarness(t, nil)
	_, token := h.operator()
	_, err := h.startTotp(token, "")
	h.wantRefusal(err, connect.CodeInvalidArgument, "invalid_request")
	_, err = h.verify2FA(token, "", h.key())
	h.wantRefusal(err, connect.CodeInvalidArgument, "invalid_request")
	_, err = h.confirmTotp(token, "123456", strings.Repeat("k", 129))
	h.wantRefusal(err, connect.CodeInvalidArgument, "invalid_request")
	_, err = h.startTotp(newToken(t), h.key())
	h.wantRefusal(err, connect.CodeUnauthenticated, "session_invalid")
	_, err = h.verify2FA("кривой", "123456", h.key())
	h.wantRefusal(err, connect.CodeUnauthenticated, "session_invalid")
}

func TestVerifyWrongCode(t *testing.T) {
	h := newHarness(t, nil)
	u, token := h.operator()
	secret := h.enrolled(token)
	before, _ := h.factor(u.ID.String())
	_, err := h.verify2FA(token, h.wrongCode(secret), h.key())
	h.wantRefusal(err, connect.CodeInvalidArgument, "mfa_wrong_code")
	if left := errorParams(t, err)["left"]; left != "4" {
		t.Fatalf("left = %q, want 4", left)
	}
	after, _ := h.factor(u.ID.String())
	if after.LastUsedStep != before.LastUsedStep {
		t.Fatal("неверный код сдвинул last_used_step")
	}
	// Неверный код не трогает отметку сессии (подтверждение при подключении остаётся).
	if s := h.sessionRow(token); !s.MfaVerifiedAt.Valid {
		t.Fatal("mfa_verified_at сброшен неверным кодом")
	}
}

func TestVerifyReusedCode(t *testing.T) {
	h := newHarness(t, nil)
	_, token := h.operator()
	secret := h.mustStart(token)
	code := h.codeNow(secret)
	if _, err := h.confirmTotp(token, code, h.key()); err != nil {
		t.Fatal(err)
	}
	// Тот же код в том же окне, другой ключ — повтор кода.
	_, err := h.verify2FA(token, code, h.key())
	h.wantRefusal(err, connect.CodeInvalidArgument, "mfa_code_reused")
	// Код прошлого шага после использования текущего — тоже повтор (шаг ≤ последнего).
	h.clock.advance(totpPeriod * time.Second)
	_, err = h.verify2FA(token, code, h.key())
	h.wantRefusal(err, connect.CodeInvalidArgument, "mfa_code_reused")
	if _, err := h.verify2FA(token, h.codeNow(secret), h.key()); err != nil {
		t.Fatalf("новый шаг: %v", err)
	}
}

// Два вызова с одним кодом и разными ключами одновременно: один успех, второй — повтор.
func TestVerifySameCodeConcurrently(t *testing.T) {
	h := newHarness(t, nil)
	u, token := h.operator()
	secret := h.enrolled(token)
	code := h.codeNow(secret)
	errs := make([]error, 2)
	var wg sync.WaitGroup
	for i := range errs {
		wg.Add(1)
		key := h.key()
		go func() {
			defer wg.Done()
			_, errs[i] = h.verify2FA(token, code, key)
		}()
	}
	wg.Wait()
	ok := 0
	for _, err := range errs {
		if err == nil {
			ok++
			continue
		}
		h.wantRefusal(err, connect.CodeInvalidArgument, "mfa_code_reused")
	}
	if ok != 1 {
		t.Fatalf("успехов %d, want 1: %v", ok, errs)
	}
	if f, _ := h.factor(u.ID.String()); f.LastUsedStep != h.clock.now().Unix()/totpPeriod {
		t.Fatalf("last_used_step = %d", f.LastUsedStep)
	}
}

func TestVerifyTooManyAttempts(t *testing.T) {
	h := newHarness(t, nil)
	u, token := h.operator()
	secret := h.enrolled(token)
	for range 5 {
		_, err := h.verify2FA(token, h.wrongCode(secret), h.key())
		h.wantRefusal(err, connect.CodeInvalidArgument, "mfa_wrong_code")
	}
	_, err := h.verify2FA(token, h.wrongCode(secret), h.key())
	h.wantRefusal(err, connect.CodeResourceExhausted, "mfa_too_many_attempts")
	// Верный код при исчерпанном лимите тоже не принимается, шаг не тратится.
	_, err = h.verify2FA(token, h.codeNow(secret), h.key())
	h.wantRefusal(err, connect.CodeResourceExhausted, "mfa_too_many_attempts")
	if f, _ := h.factor(u.ID.String()); f.LastUsedStep == h.clock.now().Unix()/totpPeriod {
		t.Fatal("шаг потрачен при отказе по лимиту")
	}
	// Окно 15 минут: после него код снова принимается.
	h.clock.advance(15*time.Minute + time.Second)
	if _, err := h.verify2FA(token, h.codeNow(secret), h.key()); err != nil {
		t.Fatalf("после окна: %v", err)
	}
}

// Верные коды не тратят лимит неверных: шесть подряд проходят.
func TestVerifyCorrectCodesDoNotSpendLimit(t *testing.T) {
	h := newHarness(t, nil)
	u, token := h.operator()
	secret := h.enrolled(token)
	for i := range 6 {
		if _, err := h.verify2FA(token, h.codeNow(secret), h.key()); err != nil {
			t.Fatalf("проверка %d: %v", i+1, err)
		}
		h.clock.advance(totpPeriod * time.Second)
	}
	if n := h.count(`SELECT COALESCE(sum(count), 0)::int FROM rate_limits WHERE key = $1`, "mfa:"+u.ID.String()); n != 0 {
		t.Fatalf("счётчик лимита = %d, want 0", n)
	}
}

func TestVerifyNotEnrolled(t *testing.T) {
	h := newHarness(t, nil)
	_, token := h.operator()
	_, err := h.verify2FA(token, "123456", h.key())
	h.wantRefusal(err, connect.CodeFailedPrecondition, "mfa_not_enrolled")
	// Начатое, но не подтверждённое подключение — тоже не подключён.
	secret := h.mustStart(token)
	_, err = h.verify2FA(token, h.codeNow(secret), h.key())
	h.wantRefusal(err, connect.CodeFailedPrecondition, "mfa_not_enrolled")
	// Confirm без Start — не подключён.
	_, other := h.operator()
	_, err = h.confirmTotp(other, "123456", h.key())
	h.wantRefusal(err, connect.CodeFailedPrecondition, "mfa_not_enrolled")
}

func TestAuthenticateTokenMfaClaims(t *testing.T) {
	h := newHarness(t, nil)
	u, first := h.operator()
	secret := h.enrolled(first)

	token := h.session(u) // новый вход по коду: второй ступени в этой сессии ещё нет
	if s := h.mustAuth(token).GetSession(); !s.GetMfaRequired() || s.GetMfaVerifiedAt() != nil {
		t.Fatalf("сессия до проверки: %v", s)
	}
	c := h.tokenClaims(token)
	if c["mfa"] != false || c["mfa_at"] != float64(0) {
		t.Fatalf("до проверки: mfa=%v mfa_at=%v", c["mfa"], c["mfa_at"])
	}

	h.clock.advance(7 * time.Second)
	at := h.clock.now()
	res, err := h.verify2FA(token, h.codeNow(secret), h.key())
	if err != nil {
		t.Fatal(err)
	}
	if !res.GetSession().GetMfaVerifiedAt().AsTime().Equal(at) {
		t.Fatalf("mfa_verified_at = %v, want %v", res.GetSession().GetMfaVerifiedAt().AsTime(), at)
	}
	h.clock.advance(time.Minute)
	c = h.tokenClaims(token)
	if c["mfa"] != true || c["mfa_at"] != float64(at.Unix()) {
		t.Fatalf("после проверки: mfa=%v mfa_at=%v, want %d", c["mfa"], c["mfa_at"], at.Unix())
	}
	if s := h.mustAuth(token).GetSession(); !s.GetMfaVerifiedAt().AsTime().Equal(at) {
		t.Fatalf("Authenticate: mfa_verified_at = %v", s.GetMfaVerifiedAt())
	}
	// Отметка — у сессии, не у пользователя: третья сессия снова без второй ступени.
	if c := h.tokenClaims(h.session(u)); c["mfa"] != false {
		t.Fatal("новая сессия унаследовала mfa")
	}
}

func TestDemoOperatorSessionMfaSatisfied(t *testing.T) {
	h := newHarness(t, nil)
	op := h.demoUser(roleOperator, true, roleOperator)
	token := newToken(t)
	res, err := h.startDemo(&identityv1.StartDemoSessionRequest{UserId: op.GetId(), SessionToken: token})
	if err != nil {
		t.Fatal(err)
	}
	now := h.clock.now()
	if s := res.GetSession(); !s.GetMfaRequired() || !s.GetMfaVerifiedAt().AsTime().Equal(now) {
		t.Fatalf("демо-оператор: %v", s)
	}
	if c := h.tokenClaims(token); c["mfa"] != true || c["mfa_at"] != float64(now.Unix()) {
		t.Fatalf("токен демо-оператора: %v", c)
	}
	client := h.demoUser(roleClient, true, roleClient)
	res, err = h.startDemo(&identityv1.StartDemoSessionRequest{UserId: client.GetId()})
	if err != nil {
		t.Fatal(err)
	}
	if s := res.GetSession(); s.GetMfaRequired() || s.GetMfaVerifiedAt() != nil {
		t.Fatalf("демо-клиент: %v", s)
	}
}

func TestMfaResetCommand(t *testing.T) {
	h := newHarness(t, nil)
	u, token := h.operator()
	h.enrolled(token)
	other := h.session(u)
	vars := map[string]string{"APP_ENV": "dev", "IDENTITY_APP_DSN": pgEnv.AppDSN("identity")}
	src := func(k string) (string, bool) { v, ok := vars[k]; return v, ok }

	var logs bytes.Buffer
	if code := Main(context.Background(), []string{"mfa-reset", "--phone", u.Phone}, src, &logs); code != 0 {
		t.Fatalf("mfa-reset: код %d\n%s", code, logs.String())
	}
	if _, ok := h.factor(u.ID.String()); ok {
		t.Fatal("фактор остался")
	}
	for _, tk := range []string{token, other} {
		if s := h.sessionRow(tk); s.MfaVerifiedAt.Valid {
			t.Fatal("mfa_verified_at не сброшен")
		}
	}
	if n := h.mfaEvents(subjectMfaReset, u.ID.String()); n != 1 {
		t.Fatalf("MfaReset: %d, want 1", n)
	}
	audit := h.auditOf(u.ID.String(), "user.mfa_reset")
	if len(audit) != 1 || audit[0].GetActorKind() != "cli" {
		t.Fatalf("аудит: %v", audit)
	}
	if strings.Contains(logs.String(), u.Phone) {
		t.Fatal("телефон в логе")
	}
	// После сброса оператор подключает фактор заново.
	h.mustStart(token)

	// Фактора уже нет — ошибка, без события; неизвестный номер и без номера — тоже ошибка.
	h2, _ := h.operator()
	for _, args := range [][]string{
		{"mfa-reset", "--phone", h2.Phone},
		{"mfa-reset", "--phone", "+77009999999"},
		{"mfa-reset"},
		{"mfa-reset", "--phone", "8700"},
	} {
		logs.Reset()
		if code := Main(context.Background(), args, src, &logs); code == 0 {
			t.Errorf("%v: код 0", args)
		}
	}
	if n := h.mfaEvents(subjectMfaReset, h2.ID.String()); n != 0 {
		t.Fatal("событие сброса без фактора")
	}
}

// Ответ потерян, web повторяет с тем же ключом: тот же ответ, шаг тратится один раз,
// лимит не расходуется.
func TestVerifySecondFactorReplayAfterLostResponse(t *testing.T) {
	h := newHarness(t, nil)
	u, token := h.operator()
	secret := h.enrolled(token)
	code, key := h.codeNow(secret), h.key()
	first, err := h.verify2FA(token, code, key)
	if err != nil {
		t.Fatal(err)
	}
	h.clock.advance(3 * time.Second)
	again, err := h.verify2FA(token, code, key)
	if err != nil {
		t.Fatalf("повтор: %v", err)
	}
	if !proto.Equal(first, again) {
		t.Fatalf("повтор вернул другой ответ:\n%v\n%v", first, again)
	}
	if f, _ := h.factor(u.ID.String()); f.LastUsedStep != h.clock.now().Unix()/totpPeriod {
		t.Fatalf("last_used_step = %d", f.LastUsedStep)
	}
	if s := h.sessionRow(token); !s.MfaVerifiedAt.Time.Equal(first.GetSession().GetMfaVerifiedAt().AsTime()) {
		t.Fatal("повтор сдвинул mfa_verified_at")
	}
	if n := h.count(`SELECT COALESCE(sum(count), 0)::int FROM rate_limits WHERE key = $1`, "mfa:"+u.ID.String()); n != 0 {
		t.Fatalf("счётчик лимита = %d", n)
	}
	// Тот же ключ с другим кодом — ключ занят.
	_, err = h.verify2FA(token, h.wrongCode(secret), key)
	h.wantRefusal(err, connect.CodeInvalidArgument, "idempotency_key_reused")
	// Тот же код с новым ключом — повтор кода.
	_, err = h.verify2FA(token, code, h.key())
	h.wantRefusal(err, connect.CodeInvalidArgument, "mfa_code_reused")
}
