package internal

import (
	"context"
	"crypto/rand"
	"crypto/sha256"
	"encoding/base64"
	"errors"
	"fmt"
	"strings"
	"sync"
	"testing"
	"time"

	"connectrpc.com/connect/v2"
	"connectrpc.com/connect/v2/connectproto"
	"google.golang.org/protobuf/proto"

	commonv1 "github.com/CemeteryPlaya/senim-platform/gen/go/senim/common/v1"
	identityv1 "github.com/CemeteryPlaya/senim-platform/gen/go/senim/identity/v1"
	"github.com/CemeteryPlaya/senim-platform/gen/go/senim/identity/v1/identityv1connect"
)

const verifyIP = "203.0.113.9"

// newToken — токен сессии, как его делает web: 32 случайных байта в base64url без «=».
func newToken(t *testing.T) string {
	t.Helper()
	b := make([]byte, 32)
	if _, err := rand.Read(b); err != nil {
		t.Fatal(err)
	}
	return base64.RawURLEncoding.EncodeToString(b)
}

func (h *harness) verifyAs(caller string, req *identityv1.VerifyOtpRequest) (*identityv1.VerifyOtpResponse, error) {
	h.t.Helper()
	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()
	ctx, info := connect.NewClientContext(ctx)
	if caller != "" {
		info.RequestHeader().Add("x-forwarded-client-cert", "Hash=4d5f6a;DNS="+caller+";DNS=localhost")
	}
	return identityv1connect.NewIdentityServiceClient(h.rpc).VerifyOtp(ctx, req)
}

// verifyReq — запрос проверки с новым ключом и новым токеном.
func (h *harness) verifyReq(phone, code, ip string) *identityv1.VerifyOtpRequest {
	h.t.Helper()
	h.keySeq++
	return &identityv1.VerifyOtpRequest{
		Phone: phone, Code: code, ClientIp: ip, UserAgent: "vitest",
		SessionToken:   newToken(h.t),
		IdempotencyKey: fmt.Sprintf("vkey-%d-%d", time.Now().UnixNano(), h.keySeq),
	}
}

func (h *harness) verify(phone, code, ip string) (*identityv1.VerifyOtpResponse, error) {
	h.t.Helper()
	return h.verifyAs("web", h.verifyReq(phone, code, ip))
}

// issued запрашивает код на phone и возвращает его (демо-режим отдаёт код в ответе).
func (h *harness) issued(phone string) string {
	h.t.Helper()
	return h.mustRequest(phone, "").GetDemoCode()
}

// errorParams — params из ErrorDetail ошибки.
func errorParams(t *testing.T, err error) map[string]string {
	t.Helper()
	var ce *connect.Error
	if !errors.As(err, &ce) {
		t.Fatalf("ошибка не connect.Error: %v", err)
	}
	for _, d := range ce.Details() {
		msg, derr := connectproto.UnmarshalErrorDetail(d)
		if derr != nil {
			continue
		}
		if ed, ok := msg.(*commonv1.ErrorDetail); ok {
			return ed.GetParams()
		}
	}
	t.Fatal("в ошибке нет ErrorDetail")
	return nil
}

func wrongOf(code string) string {
	if code == "000000" {
		return "111111"
	}
	return "000000"
}

func (h *harness) sessionRows(userID string) int {
	return h.count(`SELECT count(*) FROM sessions WHERE user_id = $1`, userID)
}

func (h *harness) auditRows() int {
	return h.count(`SELECT count(*) FROM outbox WHERE subject = 'senim.identity.audit'`)
}

func (h *harness) registeredEvents() int {
	return h.count(`SELECT count(*) FROM outbox WHERE subject = 'senim.identity.user.registered'`)
}

func TestVerifyNewPhoneBecomesClientWithSession(t *testing.T) {
	h := newHarness(t, nil)
	phone := newPhone()
	code := h.issued(phone)
	audits, registered := h.auditRows(), h.registeredEvents()

	req := h.verifyReq(phone, code, verifyIP)
	res, err := h.verifyAs("web", req)
	if err != nil {
		t.Fatal(err)
	}
	if !res.GetIsNew() || res.GetUser().GetDefaultRole() != identityv1.Role_ROLE_CLIENT || res.GetUser().GetPhone() != phone {
		t.Fatalf("ответ: %v", res)
	}
	if roles := res.GetUser().GetRoles(); len(roles) != 1 || roles[0] != identityv1.Role_ROLE_CLIENT {
		t.Fatalf("roles = %v", roles)
	}
	if res.GetSession().GetActiveRole() != identityv1.Role_ROLE_CLIENT {
		t.Fatalf("active_role = %v", res.GetSession().GetActiveRole())
	}
	created := h.clock.now()
	if !res.GetSession().GetExpiresAt().AsTime().Equal(created.Add(7*day)) ||
		!res.GetSession().GetIdleExpiresAt().AsTime().Equal(created.Add(30*time.Minute)) {
		t.Fatalf("сроки сессии: %v", res.GetSession())
	}

	var tokenHash []byte
	var agent string
	if err := h.pool.QueryRow(context.Background(), `SELECT token_hash, user_agent FROM sessions WHERE id = $1`, res.GetSession().GetId()).Scan(&tokenHash, &agent); err != nil {
		t.Fatal(err)
	}
	sum := sha256.Sum256([]byte(req.GetSessionToken()))
	if string(tokenHash) != string(sum[:]) || agent != "vitest" {
		t.Fatalf("token_hash не sha256 токена или user_agent = %q", agent)
	}
	if h.sessionRows(res.GetUser().GetId()) != 1 {
		t.Fatal("сессий не одна")
	}
	if h.auditRows()-audits != 1 || h.registeredEvents()-registered != 1 {
		t.Fatalf("событий аудита %d, UserRegistered %d, want 1/1", h.auditRows()-audits, h.registeredEvents()-registered)
	}
	if strings.Contains(h.logs.String(), phone) || strings.Contains(h.logs.String(), req.GetSessionToken()) {
		t.Fatal("номер или токен в логе")
	}
}

func TestVerifyExistingUserKeepsRole(t *testing.T) {
	h := newHarness(t, nil)
	op, err := createUser(h.q, []string{"OPERATOR"}, "OPERATOR")
	if err != nil {
		t.Fatal(err)
	}
	code := h.issued(op.Phone)
	audits := h.auditRows()

	res, err := h.verify(op.Phone, code, verifyIP)
	if err != nil {
		t.Fatal(err)
	}
	if res.GetIsNew() || res.GetUser().GetId() != op.ID.String() || res.GetSession().GetActiveRole() != identityv1.Role_ROLE_OPERATOR {
		t.Fatalf("ответ: %v", res)
	}
	if h.auditRows() != audits {
		t.Fatal("вход существующего записал событие регистрации")
	}
}

func TestVerifyWrongCodeReportsAttemptsLeft(t *testing.T) {
	h := newHarness(t, nil)
	phone := newPhone()
	code := h.issued(phone)

	_, err := h.verify(phone, wrongOf(code), verifyIP)
	h.wantRefusal(err, connect.CodeInvalidArgument, "otp_wrong_code")
	if left := errorParams(t, err)["left"]; left != "4" {
		t.Fatalf("left = %q, want 4", left)
	}
	if h.count(`SELECT count(*) FROM sessions s JOIN users u ON u.id = s.user_id WHERE u.phone = $1`, phone) != 0 {
		t.Fatal("сессия создана")
	}
}

func TestVerifyFiveWrongAttemptsLockTheCode(t *testing.T) {
	h := newHarness(t, nil)
	phone := newPhone()
	code := h.issued(phone)
	for range 4 {
		_, err := h.verify(phone, wrongOf(code), verifyIP)
		h.wantRefusal(err, connect.CodeInvalidArgument, "otp_wrong_code")
	}
	// Пятая неверная — попытки исчерпаны.
	_, err := h.verify(phone, wrongOf(code), verifyIP)
	h.wantRefusal(err, connect.CodeResourceExhausted, "otp_attempts_exhausted")
	// Верный код уже не принимается.
	_, err = h.verify(phone, code, verifyIP)
	h.wantRefusal(err, connect.CodeResourceExhausted, "otp_attempts_exhausted")
	if h.count(`SELECT count(*) FROM users WHERE phone = $1`, phone) != 0 {
		t.Fatal("пользователь создан")
	}
}

func TestVerifyPhoneDailyLimit20(t *testing.T) {
	h := newHarness(t, nil)
	phone := newPhone()
	// Кода нет: каждая проверка — otp_expired, но засчитывается в лимит номера.
	for i := range 20 {
		_, err := h.verify(phone, "000000", fmt.Sprintf("198.51.100.%d", i))
		h.wantRefusal(err, connect.CodeInvalidArgument, "otp_expired")
	}
	_, err := h.verify(phone, "000000", "203.0.113.200")
	h.wantRefusal(err, connect.CodeResourceExhausted, "otp_too_many_today")
}

func TestVerifyIPHourlyLimit50(t *testing.T) {
	h := newHarness(t, nil)
	const ip = "203.0.113.77"
	for range 50 {
		_, err := h.verify(newPhone(), "000000", ip)
		h.wantRefusal(err, connect.CodeInvalidArgument, "otp_expired")
	}
	_, err := h.verify(newPhone(), "000000", ip)
	h.wantRefusal(err, connect.CodeResourceExhausted, "otp_too_many_requests")
	// Без IP лимит по адресу не применяется.
	_, err = h.verify(newPhone(), "000000", "")
	h.wantRefusal(err, connect.CodeInvalidArgument, "otp_expired")
}

func TestVerifyExpiredCode(t *testing.T) {
	h := newHarness(t, nil)
	phone := newPhone()
	code := h.issued(phone)
	h.clock.advance(5*time.Minute + time.Second)

	_, err := h.verify(phone, code, verifyIP)
	h.wantRefusal(err, connect.CodeInvalidArgument, "otp_expired")
}

func TestVerifyCodeIsSingleUse(t *testing.T) {
	h := newHarness(t, nil)
	phone := newPhone()
	code := h.issued(phone)
	if _, err := h.verify(phone, code, verifyIP); err != nil {
		t.Fatal(err)
	}
	_, err := h.verify(phone, code, verifyIP)
	h.wantRefusal(err, connect.CodeInvalidArgument, "otp_expired")
}

func TestVerifyTwoConcurrentEntriesGiveOneSession(t *testing.T) {
	h := newHarness(t, nil)
	phone := newPhone()
	code := h.issued(phone)

	var wg sync.WaitGroup
	errs := make([]error, 2)
	resps := make([]*identityv1.VerifyOtpResponse, 2)
	reqs := []*identityv1.VerifyOtpRequest{h.verifyReq(phone, code, verifyIP), h.verifyReq(phone, code, verifyIP)}
	for i := range 2 {
		wg.Add(1)
		go func() {
			defer wg.Done()
			resps[i], errs[i] = h.verifyAs("web", reqs[i])
		}()
	}
	wg.Wait()

	ok := 0
	for i := range 2 {
		if errs[i] == nil {
			ok++
		} else if _, reason := refusal(t, errs[i]); reason != "otp_expired" && reason != "otp_attempts_exhausted" {
			// Проигравший видит код уже погашенным: otp_attempts_exhausted (счёт попытки не
			// прошёл, как в otp.ts) или otp_expired (погасили между счётом и транзакцией).
			t.Fatalf("отказ проигравшего: %q", reason)
		}
	}
	if ok != 1 {
		t.Fatalf("успешных входов %d, want 1", ok)
	}
	user, err := h.q.GetUserByPhone(context.Background(), phone)
	if err != nil {
		t.Fatal(err)
	}
	if h.sessionRows(user.ID.String()) != 1 {
		t.Fatal("сессий не одна")
	}
}

func TestVerifyBlockedUserCannotSignIn(t *testing.T) {
	h := newHarness(t, nil)
	u, err := createUser(h.q, []string{"CLIENT"}, "CLIENT")
	if err != nil {
		t.Fatal(err)
	}
	if _, err := h.pool.Exec(context.Background(), `UPDATE users SET blocked_at = now() WHERE id = $1`, u.ID); err != nil {
		t.Fatal(err)
	}
	code := h.issued(u.Phone)

	_, err = h.verify(u.Phone, code, verifyIP)
	h.wantRefusal(err, connect.CodePermissionDenied, "user_blocked")
	if h.sessionRows(u.ID.String()) != 0 {
		t.Fatal("сессия создана заблокированному")
	}
	// Код не погашен откатом: он остаётся тем же кодом (ограничен лишь попытками).
	if h.count(`SELECT count(*) FROM otp_codes WHERE phone = $1 AND consumed_at IS NULL`, u.Phone) != 1 {
		t.Fatal("код погашен при отказе")
	}
}

// Review Focus 1: web не получил ответ и повторил вызов с тем же ключом и токеном.
func TestVerifyReplayAfterLostResponse(t *testing.T) {
	h := newHarness(t, nil)
	phone := newPhone()
	code := h.issued(phone)
	req := h.verifyReq(phone, code, verifyIP)

	first, err := h.verifyAs("web", req)
	if err != nil {
		t.Fatal(err)
	}
	again, err := h.verifyAs("web", proto.Clone(req).(*identityv1.VerifyOtpRequest))
	if err != nil {
		t.Fatalf("повтор с тем же ключом: %v", err)
	}
	if again.GetUser().GetId() != first.GetUser().GetId() || again.GetSession().GetId() != first.GetSession().GetId() || !again.GetIsNew() {
		t.Fatalf("повтор вернул другой ответ: %v vs %v", again, first)
	}
	if h.sessionRows(first.GetUser().GetId()) != 1 {
		t.Fatal("сессий не одна")
	}
}

// Повтор после отказа: ключ не сохранён, повтор получает тот же отказ, но попытка не нужна заново.
func TestVerifyReplayAfterAttemptsExhaustedStillSavedAnswer(t *testing.T) {
	h := newHarness(t, nil)
	phone := newPhone()
	code := h.issued(phone)
	req := h.verifyReq(phone, code, verifyIP)
	first, err := h.verifyAs("web", req)
	if err != nil {
		t.Fatal(err)
	}
	// Лимит номера исчерпан, но повтор того же вызова возвращает сохранённый ответ.
	if _, err := h.pool.Exec(context.Background(), `UPDATE rate_limits SET count = 1000 WHERE key = $1`, "otp:verify:phone:"+phone+":day"); err != nil {
		t.Fatal(err)
	}
	again, err := h.verifyAs("web", proto.Clone(req).(*identityv1.VerifyOtpRequest))
	if err != nil {
		t.Fatalf("повтор при исчерпанном лимите: %v", err)
	}
	if again.GetSession().GetId() != first.GetSession().GetId() {
		t.Fatal("другая сессия")
	}
}

func TestVerifyKeyReusedWithOtherCode(t *testing.T) {
	h := newHarness(t, nil)
	phone := newPhone()
	code := h.issued(phone)
	req := h.verifyReq(phone, code, verifyIP)
	if _, err := h.verifyAs("web", req); err != nil {
		t.Fatal(err)
	}
	other := proto.Clone(req).(*identityv1.VerifyOtpRequest)
	other.Code = wrongOf(code)
	_, err := h.verifyAs("web", other)
	h.wantRefusal(err, connect.CodeInvalidArgument, "idempotency_key_reused")
}

func TestStaffSessionLasts8h(t *testing.T) {
	h := newHarness(t, nil)
	staff, err := createUser(h.q, []string{"OPERATOR"}, "OPERATOR")
	if err != nil {
		t.Fatal(err)
	}
	client, err := createUser(h.q, []string{"CLIENT"}, "CLIENT")
	if err != nil {
		t.Fatal(err)
	}
	for phone, want := range map[string]time.Duration{staff.Phone: 8 * time.Hour, client.Phone: 7 * 24 * time.Hour} {
		code := h.issued(phone)
		res, err := h.verify(phone, code, verifyIP)
		if err != nil {
			t.Fatal(err)
		}
		var created, expires time.Time
		if err := h.pool.QueryRow(context.Background(), `SELECT created_at, expires_at FROM sessions WHERE id = $1`, res.GetSession().GetId()).Scan(&created, &expires); err != nil {
			t.Fatal(err)
		}
		if got := expires.Sub(created); got != want {
			t.Fatalf("%s: срок сессии %v, want %v", phone, got, want)
		}
	}
}

func TestSessionTokenFormat(t *testing.T) {
	h := newHarness(t, nil)
	phone := newPhone()
	code := h.issued(phone)
	good := newToken(t)
	for _, token := range map[string]string{
		"42 символа":   good[:42],
		"44 символа":   good + "A",
		"не base64url": good[:42] + "+",
		"с паддингом":  good[:42] + "=",
		"пустой":       "",
	} {
		req := h.verifyReq(phone, code, verifyIP)
		req.SessionToken = token
		_, err := h.verifyAs("web", req)
		h.wantRefusal(err, connect.CodeInvalidArgument, "session_token_invalid")
	}
	// Код не потрачен отказами по формату токена.
	if _, err := h.verify(phone, code, verifyIP); err != nil {
		t.Fatalf("верный запрос после отказов: %v", err)
	}
}

func TestVerifyRequestValidation(t *testing.T) {
	h := newHarness(t, nil)
	phone := newPhone()
	for _, tune := range map[string]func(*identityv1.VerifyOtpRequest){
		"пустой ключ":  func(r *identityv1.VerifyOtpRequest) { r.IdempotencyKey = "" },
		"длинный ключ": func(r *identityv1.VerifyOtpRequest) { r.IdempotencyKey = strings.Repeat("k", 129) },
		"плохой IP":    func(r *identityv1.VerifyOtpRequest) { r.ClientIp = "not-an-ip" },
	} {
		req := h.verifyReq(phone, "123456", "")
		tune(req)
		_, err := h.verifyAs("web", req)
		h.wantRefusal(err, connect.CodeInvalidArgument, "invalid_request")
	}
	_, err := h.verify("+7 912 000 00 00", "123456", "")
	h.wantRefusal(err, connect.CodeInvalidArgument, "invalid_phone")
}

func TestVerifyUserAgentTruncatedTo300Runes(t *testing.T) {
	h := newHarness(t, nil)
	phone := newPhone()
	code := h.issued(phone)
	req := h.verifyReq(phone, code, verifyIP)
	req.UserAgent = strings.Repeat("я", 400)
	res, err := h.verifyAs("web", req)
	if err != nil {
		t.Fatal(err)
	}
	var agent string
	if err := h.pool.QueryRow(context.Background(), `SELECT user_agent FROM sessions WHERE id = $1`, res.GetSession().GetId()).Scan(&agent); err != nil {
		t.Fatal(err)
	}
	if agent != strings.Repeat("я", 300) {
		t.Fatalf("user_agent: %d рун", len([]rune(agent)))
	}
}

func TestVerifyCallerMustBeWeb(t *testing.T) {
	h := newHarness(t, nil)
	for _, caller := range []string{"", "deal", "identity"} {
		_, err := h.verifyAs(caller, h.verifyReq(newPhone(), "123456", ""))
		h.wantRefusal(err, connect.CodePermissionDenied, "caller_forbidden")
	}
}

// createSession не проверяет, выдана ли роль: это дело вызывающего (Task 9).
func TestCreateSessionUsesAsRoleOrDefault(t *testing.T) {
	h := newHarness(t, nil)
	u, err := createUser(h.q, []string{"CLIENT", "EXECUTOR"}, "CLIENT")
	if err != nil {
		t.Fatal(err)
	}
	now := h.clock.now()
	for asRole, want := range map[string]string{"": "CLIENT", "EXECUTOR": "EXECUTOR"} {
		tx, err := h.pool.Begin(context.Background())
		if err != nil {
			t.Fatal(err)
		}
		s, err := createSession(context.Background(), tx, u, newToken(t), "ua", asRole, now)
		if err != nil {
			t.Fatal(err)
		}
		_ = tx.Rollback(context.Background())
		if s.ActiveRole != want {
			t.Fatalf("asRole %q: active_role = %q, want %q", asRole, s.ActiveRole, want)
		}
	}
}

// Токен, уже занятый другой сессией, под новым ключом: отказ до траты попытки, без ERROR в логе.
func TestVerifyReusedSessionTokenRefused(t *testing.T) {
	h := newHarness(t, nil)
	phone := newPhone()
	code := h.issued(phone)
	first := h.verifyReq(phone, code, verifyIP)
	res, err := h.verifyAs("web", first)
	if err != nil {
		t.Fatal(err)
	}
	phone2 := newPhone()
	code2 := h.issued(phone2)
	second := h.verifyReq(phone2, code2, verifyIP)
	second.SessionToken = first.GetSessionToken()
	_, err = h.verifyAs("web", second)
	h.wantRefusal(err, connect.CodeInvalidArgument, "session_token_invalid")

	if h.count(`SELECT count(*) FROM sessions WHERE id = $1`, res.GetSession().GetId()) != 1 ||
		h.count(`SELECT count(*) FROM sessions s JOIN users u ON u.id = s.user_id WHERE u.phone = $1`, phone2) != 0 {
		t.Fatal("лишняя или потерянная сессия")
	}
	if h.count(`SELECT attempts FROM otp_codes WHERE phone = $1`, phone2) != 0 {
		t.Fatal("попытка потрачена")
	}
	if strings.Contains(h.logs.String(), `"level":"ERROR"`) {
		t.Fatalf("ERROR в логе: %s", h.logs.String())
	}
	// Код цел: с новым токеном вход проходит.
	second.SessionToken = newToken(t)
	second.IdempotencyKey += "-2"
	if _, err := h.verifyAs("web", second); err != nil {
		t.Fatal(err)
	}
}

// Гонка за один токен: уникальный индекс переводится в session_token_invalid (в обход предпроверки).
func TestCreateSessionMapsTokenUniqueViolation(t *testing.T) {
	h := newHarness(t, nil)
	u, err := createUser(h.q, []string{"CLIENT"}, "CLIENT")
	if err != nil {
		t.Fatal(err)
	}
	ctx := context.Background()
	tx, err := h.pool.Begin(ctx)
	if err != nil {
		t.Fatal(err)
	}
	defer func() { _ = tx.Rollback(ctx) }()
	token := newToken(t)
	if _, err := createSession(ctx, tx, u, token, "", "", h.clock.now()); err != nil {
		t.Fatal(err)
	}
	_, err = createSession(ctx, tx, u, token, "", "", h.clock.now())
	h.wantRefusal(err, connect.CodeInvalidArgument, "session_token_invalid")
}

// Review Focus 1, вариант «первый вызов ещё идёт»: повтор с тем же ключом ждёт его и получает тот же ответ.
func TestVerifyConcurrentSameKeyWaitsForFirstCall(t *testing.T) {
	h := newHarness(t, nil)
	u, err := createUser(h.q, []string{"CLIENT"}, "CLIENT")
	if err != nil {
		t.Fatal(err)
	}
	code := h.issued(u.Phone)
	req := h.verifyReq(u.Phone, code, verifyIP)

	// Блокировка строки пользователя держит вызов A внутри Do (вставка сессии ждёт FK-замок).
	ctx := context.Background()
	lock, err := h.pool.Begin(ctx)
	if err != nil {
		t.Fatal(err)
	}
	defer func() { _ = lock.Rollback(ctx) }()
	if _, err := lock.Exec(ctx, `SELECT 1 FROM users WHERE id = $1 FOR UPDATE`, u.ID); err != nil {
		t.Fatal(err)
	}

	type result struct {
		res *identityv1.VerifyOtpResponse
		err error
	}
	run := func() chan result {
		ch := make(chan result, 1)
		go func() {
			r, err := h.verifyAs("web", proto.Clone(req).(*identityv1.VerifyOtpRequest))
			ch <- result{r, err}
		}()
		return ch
	}
	a := run()
	time.Sleep(500 * time.Millisecond) // A дошёл до вставки сессии и ждёт замок
	b := run()
	time.Sleep(300 * time.Millisecond)
	select {
	case r := <-a:
		t.Fatalf("A завершился под замком: %v", r.err)
	case r := <-b:
		t.Fatalf("B завершился, пока A в работе: %v", r.err)
	default:
	}
	if err := lock.Rollback(ctx); err != nil {
		t.Fatal(err)
	}
	ra, rb := <-a, <-b
	if ra.err != nil || rb.err != nil {
		t.Fatalf("A: %v, B: %v", ra.err, rb.err)
	}
	if ra.res.GetUser().GetId() != rb.res.GetUser().GetId() || ra.res.GetSession().GetId() != rb.res.GetSession().GetId() {
		t.Fatal("B вернул не ответ A")
	}
	if h.sessionRows(u.ID.String()) != 1 {
		t.Fatal("сессий не одна")
	}
}
