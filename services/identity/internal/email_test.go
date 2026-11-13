package internal

import (
	"bytes"
	"context"
	"crypto/hmac"
	"crypto/sha256"
	"strings"
	"sync"
	"testing"
	"time"

	"connectrpc.com/connect/v2"
	"google.golang.org/protobuf/proto"

	identityv1 "github.com/CemeteryPlaya/senim-platform/gen/go/senim/identity/v1"
	"github.com/CemeteryPlaya/senim-platform/gen/go/senim/identity/v1/identityv1connect"
	"github.com/CemeteryPlaya/senim-platform/services/identity/internal/store"
)

// shownEmail — адрес, который «экран» показывает по сессии: последний адрес, на который
// RequestEmailCode выдал код (VerifyEmailCode обязан передать его). Сессии уникальны на тест.
var shownEmail sync.Map

// emailShownFor — адрес для VerifyEmailCode по сессии; кода ещё не было — любой верный адрес.
func emailShownFor(token string) string {
	if v, ok := shownEmail.Load(token); ok {
		return v.(string)
	}
	return "a@example.kz"
}

func (h *harness) requestEmail(token, email, key string) (*identityv1.RequestEmailCodeResponse, error) {
	h.t.Helper()
	res, err := idc(h, "web", func(ctx context.Context, c identityv1connect.IdentityServiceClient) (*identityv1.RequestEmailCodeResponse, error) {
		return c.RequestEmailCode(ctx, &identityv1.RequestEmailCodeRequest{SessionToken: token, Email: email, IdempotencyKey: key})
	})
	if err == nil {
		shownEmail.Store(token, email)
	}
	return res, err
}

// mustRequestEmail — запрос кода, который обязан пройти; возвращает показанный код.
func (h *harness) mustRequestEmail(token, email string) string {
	h.t.Helper()
	res, err := h.requestEmail(token, email, h.key())
	if err != nil {
		h.t.Fatalf("RequestEmailCode: %v", err)
	}
	return res.GetDemoCode()
}

// verifyEmail — ввод кода для адреса, показанного по этой сессии (emailShownFor).
func (h *harness) verifyEmail(token, code, key string) (*identityv1.VerifyEmailCodeResponse, error) {
	h.t.Helper()
	return h.verifyEmailAt(token, emailShownFor(token), code, key)
}

// verifyEmailAt — ввод кода с явным адресом на экране.
func (h *harness) verifyEmailAt(token, email, code, key string) (*identityv1.VerifyEmailCodeResponse, error) {
	h.t.Helper()
	return idc(h, "web", func(ctx context.Context, c identityv1connect.IdentityServiceClient) (*identityv1.VerifyEmailCodeResponse, error) {
		return c.VerifyEmailCode(ctx, &identityv1.VerifyEmailCodeRequest{SessionToken: token, Code: code, IdempotencyKey: key, Email: email})
	})
}

func (h *harness) mustVerifyEmail(token, code string) *identityv1.Person {
	h.t.Helper()
	res, err := h.verifyEmail(token, code, h.key())
	if err != nil {
		h.t.Fatalf("VerifyEmailCode: %v", err)
	}
	return res.GetPerson()
}

// emailCodes — строки email_codes пользователя, новые первыми.
func (h *harness) emailCodes(u store.User) []store.EmailCode {
	h.t.Helper()
	rows, err := h.pool.Query(context.Background(), `SELECT id, user_id, email, code_hash, attempts, expires_at, consumed_at, created_at
		FROM email_codes WHERE user_id = $1 ORDER BY created_at DESC, id`, u.ID)
	if err != nil {
		h.t.Fatal(err)
	}
	defer rows.Close()
	var out []store.EmailCode
	for rows.Next() {
		var c store.EmailCode
		if err := rows.Scan(&c.ID, &c.UserID, &c.Email, &c.CodeHash, &c.Attempts, &c.ExpiresAt, &c.ConsumedAt, &c.CreatedAt); err != nil {
			h.t.Fatal(err)
		}
		out = append(out, c)
	}
	if err := rows.Err(); err != nil {
		h.t.Fatal(err)
	}
	return out
}

func wantEmailHash(u store.User, email, code string) []byte {
	m := hmac.New(sha256.New, testHMACKey)
	m.Write([]byte("email:v1:" + u.ID.String() + ":" + email + ":" + code))
	return m.Sum(nil)
}

// Успешный запрос: код из 6 цифр в ответе (мок-провайдер), адрес нормализован, в базе —
// HMAC с адресом-кандидатом, persons.email не тронут. Повтор по ключу — тот же ответ без
// кода и без второго кода; новый запрос в ту же минуту на тот же адрес — email_code_already_sent.
func TestRequestEmailCode(t *testing.T) {
	h := newHarness(t, nil)
	u, token := h.client()
	key := h.key()

	res, err := h.requestEmail(token, "  Aigerim@Example.KZ ", key)
	if err != nil {
		t.Fatalf("RequestEmailCode: %v", err)
	}
	code := res.GetDemoCode()
	if !sixDigits.MatchString(code) {
		t.Fatalf("demo_code = %q, want 6 цифр", code)
	}
	if want := h.clock.now().Add(emailCodeTTL); !res.GetExpiresAt().AsTime().Equal(want) {
		t.Fatalf("expires_at = %v, want %v", res.GetExpiresAt().AsTime(), want)
	}
	sent := h.email.sent()
	if len(sent) != 1 || sent[0].phone != "aigerim@example.kz" || sent[0].code != code {
		t.Fatalf("отправлено %v", sent)
	}
	codes := h.emailCodes(u)
	if len(codes) != 1 || codes[0].Email != "aigerim@example.kz" || !bytes.Equal(codes[0].CodeHash, wantEmailHash(u, "aigerim@example.kz", code)) {
		t.Fatalf("строки кодов: %+v", codes)
	}
	if row, ok := h.personRow(u.ID); ok && row.Email.Valid {
		t.Fatalf("persons.email записан до подтверждения: %q", row.Email.String)
	}
	if len(h.svc.cfg.OTPHMACKey) == 0 || bytes.Contains(codes[0].CodeHash, []byte(code)) {
		t.Fatal("код хранится открыто")
	}

	again, err := h.requestEmail(token, "  Aigerim@Example.KZ ", key)
	if err != nil {
		t.Fatalf("повтор по ключу: %v", err)
	}
	if again.GetDemoCode() != "" || !proto.Equal(again.GetExpiresAt(), res.GetExpiresAt()) {
		t.Fatalf("повтор по ключу: %v", again)
	}
	if n := len(h.emailCodes(u)); n != 1 || len(h.email.sent()) != 1 {
		t.Fatalf("после повтора кодов %d, отправок %d", n, len(h.email.sent()))
	}

	// Тот же адрес в ту же минуту — действующий код уже у него (email_code_already_sent).
	_, err = h.requestEmail(token, "aigerim@example.kz", h.key())
	h.wantRefusal(err, connect.CodeResourceExhausted, "email_code_already_sent")

	// Тот же ключ с другим адресом — idempotency_key_reused.
	_, err = h.requestEmail(token, "other@example.kz", key)
	h.wantRefusal(err, connect.CodeInvalidArgument, "idempotency_key_reused")
}

// Код показывается при провайдере mock независимо от DEMO_MODE.
func TestRequestEmailCodeDemoCodeWithoutDemoMode(t *testing.T) {
	h := newHarness(t, func(c *ServeConfig) { c.DemoMode = false })
	_, token := h.client()
	if code := h.mustRequestEmail(token, "a@example.kz"); !sixDigits.MatchString(code) {
		t.Fatalf("demo_code = %q без DEMO_MODE, want 6 цифр", code)
	}
}

// Лимиты: раз в минуту, 5 в час, 10 в сутки на пользователя.
func TestRequestEmailCodeLimits(t *testing.T) {
	h := newHarness(t, nil)
	u, token := h.client()
	for i := range emailHourly {
		if i > 0 {
			h.clock.advance(emailCooldown + time.Second)
		}
		h.mustRequestEmail(token, "a@example.kz")
	}
	h.clock.advance(emailCooldown + time.Second)
	_, err := h.requestEmail(token, "a@example.kz", h.key())
	h.wantRefusal(err, connect.CodeResourceExhausted, "email_code_too_many")

	// Новый час: ещё 5, затем суточный предел.
	h.clock.advance(time.Hour)
	token = h.session(u) // часы ушли вперёд: прежняя сессия истекла по простою
	for range emailDaily - emailHourly - 1 {
		h.mustRequestEmail(token, "a@example.kz")
		h.clock.advance(emailCooldown + time.Second)
	}
	h.mustRequestEmail(token, "a@example.kz")
	h.clock.advance(time.Hour)
	token = h.session(u)
	_, err = h.requestEmail(token, "a@example.kz", h.key())
	h.wantRefusal(err, connect.CodeResourceExhausted, "email_code_too_many")
	if n := len(h.emailCodes(u)); n != emailDaily {
		t.Fatalf("кодов %d, want %d", n, emailDaily)
	}
}

// Лимиты почты берутся из конфигурации: при 2 кодах в час и паузе 1 с третий запрос отклоняется.
func TestRequestEmailCodeLimitsFromConfig(t *testing.T) {
	h := newHarness(t, func(c *ServeConfig) {
		c.EmailCodeHourlyLimit = 2
		c.EmailCodeCooldown = time.Second
	})
	_, token := h.client()
	for range 2 {
		h.mustRequestEmail(token, "a@example.kz")
		h.clock.advance(2 * time.Second)
	}
	_, err := h.requestEmail(token, "a@example.kz", h.key())
	h.wantRefusal(err, connect.CodeResourceExhausted, "email_code_too_many")
}

func TestRequestEmailCodeValidation(t *testing.T) {
	h := newHarness(t, nil)
	u, token := h.client()
	for _, raw := range []string{"", "   ", "не почта", "a@b", strings.Repeat("a", 250) + "@example.kz"} {
		_, err := h.requestEmail(token, raw, h.key())
		h.wantRefusal(err, connect.CodeInvalidArgument, "email_invalid")
	}
	_, err := h.requestEmail(token, "a@example.kz", "")
	h.wantRefusal(err, connect.CodeInvalidArgument, "invalid_request")
	_, err = h.requestEmail(newToken(t), "a@example.kz", h.key())
	h.wantRefusal(err, connect.CodeUnauthenticated, "session_invalid")
	_, err = h.verifyEmail(newToken(t), "123456", h.key())
	h.wantRefusal(err, connect.CodeUnauthenticated, "session_invalid")
	_, err = h.verifyEmail(token, "123456", "")
	h.wantRefusal(err, connect.CodeInvalidArgument, "invalid_request")
	// Адрес в VerifyEmailCode обязателен и проверяется так же, как в RequestEmailCode.
	for _, raw := range []string{"", "   ", "не почта"} {
		_, err = h.verifyEmailAt(token, raw, "123456", h.key())
		h.wantRefusal(err, connect.CodeInvalidArgument, "email_invalid")
	}
	if n := len(h.emailCodes(u)); n != 0 || len(h.email.sent()) != 0 {
		t.Fatalf("после отказов кодов %d, отправок %d", n, len(h.email.sent()))
	}
	// Отказы по формату не тратят лимит.
	h.mustRequestEmail(token, "a@example.kz")
}

// Почта — у сторон сделки (заказчик, мастер); оператор — role_forbidden на оба метода.
func TestEmailCodeOperatorForbidden(t *testing.T) {
	h := newHarness(t, nil)
	u, token := h.operator()
	_, err := h.requestEmail(token, "op@example.kz", h.key())
	h.wantRefusal(err, connect.CodePermissionDenied, "role_forbidden")
	_, err = h.verifyEmail(token, "123456", h.key())
	h.wantRefusal(err, connect.CodePermissionDenied, "role_forbidden")
	if n := len(h.emailCodes(u)); n != 0 || len(h.email.sent()) != 0 {
		t.Fatalf("оператору выдан код: %d, отправок %d", n, len(h.email.sent()))
	}
	// Мастер — можно.
	m := h.user([]string{"EXECUTOR"}, "EXECUTOR")
	h.mustRequestEmail(h.session(m), "master@example.kz")
}

// Неверный код — email_code_wrong с остатком попыток; пятая неверная — исчерпаны; шестая,
// даже с верным кодом, — тоже отказ, адрес не подтверждается.
func TestVerifyEmailCodeWrongAndExhausted(t *testing.T) {
	h := newHarness(t, nil)
	u, token := h.client()
	code := h.mustRequestEmail(token, "a@example.kz")
	wrong := wrongOf(code)

	_, err := h.verifyEmail(token, wrong, h.key())
	h.wantRefusal(err, connect.CodeInvalidArgument, "email_code_wrong")
	if p := errorParams(t, err); p["left"] != "4" || len(p) != 1 {
		t.Fatalf("params = %v, want left=4", p)
	}
	for i := 2; i < emailMaxAttempts; i++ {
		_, err = h.verifyEmail(token, wrong, h.key())
		h.wantRefusal(err, connect.CodeInvalidArgument, "email_code_wrong")
	}
	_, err = h.verifyEmail(token, wrong, h.key())
	h.wantRefusal(err, connect.CodeResourceExhausted, "email_code_attempts_exhausted")
	_, err = h.verifyEmail(token, code, h.key())
	h.wantRefusal(err, connect.CodeResourceExhausted, "email_code_attempts_exhausted")

	if row, ok := h.personRow(u.ID); ok && (row.Email.Valid || row.EmailVerifiedAt.Valid) {
		t.Fatalf("адрес записан после отказов: %+v", row)
	}
	if c := h.emailCodes(u); len(c) != 1 || c[0].Attempts != emailMaxAttempts || c[0].ConsumedAt.Valid {
		t.Fatalf("строка кода: %+v", c)
	}
}

func TestVerifyEmailCodeExpired(t *testing.T) {
	h := newHarness(t, nil)
	_, token := h.client()
	code := h.mustRequestEmail(token, "a@example.kz")
	h.clock.advance(emailCodeTTL)
	_, err := h.verifyEmail(token, code, h.key())
	h.wantRefusal(err, connect.CodeInvalidArgument, "email_code_expired")

	// Кода не было вовсе — тоже email_code_expired.
	_, other := h.client()
	_, err = h.verifyEmail(other, "123456", h.key())
	h.wantRefusal(err, connect.CodeInvalidArgument, "email_code_expired")
}

// Верный код: в одной транзакции адрес-кандидат становится persons.email, подтверждение
// ставится, код гасится, в outbox — аудит user.email_verified без адреса. Повтор по ключу —
// тот же ответ; тот же код с новым ключом — уже погашен.
func TestVerifyEmailCodeSuccess(t *testing.T) {
	h := newHarness(t, nil)
	u, token := h.client()
	const addr = "aigerim@example.kz"
	code := h.mustRequestEmail(token, "Aigerim@Example.KZ")
	key := h.key()

	res, err := h.verifyEmail(token, code, key)
	if err != nil {
		t.Fatalf("VerifyEmailCode: %v", err)
	}
	want := &identityv1.Person{UserId: u.ID.String(), Email: addr, EmailVerified: true}
	if !proto.Equal(res.GetPerson(), want) {
		t.Fatalf("person = %v, want %v", res.GetPerson(), want)
	}
	row, ok := h.personRow(u.ID)
	if !ok || row.Email.String != addr || !row.EmailVerifiedAt.Valid || !row.EmailVerifiedAt.Time.Equal(h.clock.now()) {
		t.Fatalf("строка persons: %+v", row)
	}
	if c := h.emailCodes(u); len(c) != 1 || !c[0].ConsumedAt.Valid || c[0].Attempts != 1 {
		t.Fatalf("строка кода: %+v", c)
	}
	prof, err := h.getProfile(token)
	if err != nil || !proto.Equal(prof.GetPerson(), want) {
		t.Fatalf("GetProfile: %v, %v", prof, err)
	}

	events := h.auditOf(u.ID.String(), "user.email_verified")
	if len(events) != 1 {
		t.Fatalf("событий user.email_verified %d, want 1", len(events))
	}
	e := events[0]
	if e.GetActorId() != u.ID.String() || e.GetActorRole() != "CLIENT" || e.GetAfterJson() != `{"verified":true}` {
		t.Fatalf("аудит: %v", e)
	}
	changed := h.auditOf(u.ID.String(), "user.email_changed")
	if len(changed) != 1 || changed[0].GetAfterJson() != `{"set":true}` {
		t.Fatalf("аудит смены адреса: %v", changed)
	}
	for _, ev := range append(events, changed...) {
		body, err := proto.Marshal(ev)
		if err != nil {
			t.Fatal(err)
		}
		if bytes.Contains(bytes.ToLower(body), []byte("aigerim")) {
			t.Fatalf("в аудите адрес: %v", ev)
		}
	}

	again, err := h.verifyEmail(token, code, key)
	if err != nil || !proto.Equal(again, res) {
		t.Fatalf("повтор по ключу: %v, %v", again, err)
	}
	_, err = h.verifyEmail(token, code, h.key())
	h.wantRefusal(err, connect.CodeInvalidArgument, "email_code_expired")
	if n := len(h.auditOf(u.ID.String(), "user.email_verified")); n != 1 {
		t.Fatalf("событий после повторов %d, want 1", n)
	}

	if logs := strings.ToLower(h.logs.String()); strings.Contains(logs, "aigerim") || strings.Contains(logs, code) {
		t.Fatalf("в логе адрес или код:\n%s", h.logs.String())
	}
}

// Новый код гасит прежний: старый больше не принимается, новый — да.
func TestEmailCodeNewRetiresOld(t *testing.T) {
	h := newHarness(t, nil)
	_, token := h.client()
	first := h.mustRequestEmail(token, "first@example.kz")
	var second string
	for {
		h.clock.advance(emailCooldown + time.Second)
		second = h.mustRequestEmail(token, "second@example.kz")
		if second != first {
			break
		}
	}
	_, err := h.verifyEmail(token, first, h.key())
	h.wantRefusal(err, connect.CodeInvalidArgument, "email_code_wrong")
	p := h.mustVerifyEmail(token, second)
	if p.GetEmail() != "second@example.kz" || !p.GetEmailVerified() {
		t.Fatalf("person = %v", p)
	}
}

// UpdateContacts (v1): тот же адрес оставляет подтверждение, другой — сбрасывает и гасит
// ожидающий код; пустой — тоже сброс.
func TestUpdateContactsResetsEmailVerification(t *testing.T) {
	h := newHarness(t, nil)
	u, token := h.client()
	h.mustVerifyEmail(token, h.mustRequestEmail(token, "a@example.kz"))

	if p := h.mustUpdateContacts(token, "dala", "A@Example.kz"); !p.GetEmailVerified() || p.GetEmail() != "a@example.kz" {
		t.Fatalf("тот же адрес: %v", p)
	}
	if p := h.mustUpdateContacts(token, "dala", "b@example.kz"); p.GetEmailVerified() || p.GetEmail() != "b@example.kz" {
		t.Fatalf("новый адрес: %v", p)
	}
	if row, _ := h.personRow(u.ID); row.EmailVerifiedAt.Valid {
		t.Fatal("email_verified_at не сброшен")
	}

	// Ожидающий код гасится сменой адреса: иначе он подтвердил бы прежнего кандидата
	// поверх адреса, введённого позже.
	h.clock.advance(emailCooldown + time.Second)
	pending := h.mustRequestEmail(token, "c@example.kz")
	h.mustUpdateContacts(token, "dala", "d@example.kz")
	_, err := h.verifyEmail(token, pending, h.key())
	h.wantRefusal(err, connect.CodeInvalidArgument, "email_code_expired")

	h.clock.advance(emailCooldown + time.Second)
	h.mustVerifyEmail(token, h.mustRequestEmail(token, "d@example.kz"))
	if p := h.mustUpdateContacts(token, "dala", ""); p.GetEmailVerified() || p.GetEmail() != "" {
		t.Fatalf("пустой адрес: %v", p)
	}
}

// Тот же адрес уже подтверждён — email_already_verified: кода, отправки, аудита и траты
// лимита нет. Другой адрес — обычный код.
func TestRequestEmailCodeAlreadyVerified(t *testing.T) {
	h := newHarness(t, nil)
	u, token := h.client()
	h.mustVerifyEmail(token, h.mustRequestEmail(token, "a@example.kz"))
	codes, sent, audits := len(h.emailCodes(u)), len(h.email.sent()), h.auditRows()

	h.clock.advance(emailCooldown + time.Second)
	_, err := h.requestEmail(token, " A@Example.KZ ", h.key())
	h.wantRefusal(err, connect.CodeFailedPrecondition, "email_already_verified")
	if len(h.emailCodes(u)) != codes || len(h.email.sent()) != sent || h.auditRows() != audits {
		t.Fatal("для подтверждённого адреса выдан код, отправлено письмо или записан аудит")
	}
	// Отказ не тратит паузу: другой адрес сразу получает код.
	if code := h.mustRequestEmail(token, "b@example.kz"); !sixDigits.MatchString(code) {
		t.Fatalf("код для другого адреса: %q", code)
	}
}

// Ввод не из шести цифр — invalid_request до счёта: ни попытка, ни суточный лимит не тратятся.
func TestVerifyEmailCodeFormat(t *testing.T) {
	h := newHarness(t, nil)
	u, token := h.client()
	code := h.mustRequestEmail(token, "a@example.kz")
	for range emailVerifyDaily + 1 {
		for _, bad := range []string{"", "12345", "1234567", "12a456", "１２３４５６", "12 456"} {
			_, err := h.verifyEmail(token, bad, h.key())
			h.wantRefusal(err, connect.CodeInvalidArgument, "invalid_request")
		}
	}
	if c := h.emailCodes(u); c[0].Attempts != 0 {
		t.Fatalf("попыток %d после ввода не по формату, want 0", c[0].Attempts)
	}
	// Пробелы по краям обрезаются.
	if p := h.mustVerifyEmail(token, " "+code+" "); !p.GetEmailVerified() {
		t.Fatalf("person = %v", p)
	}
}

// Не больше 20 проверок кода в сутки на пользователя, каким бы ни был код.
func TestVerifyEmailCodeDailyLimit(t *testing.T) {
	h := newHarness(t, nil)
	u, token := h.client()
	code := h.mustRequestEmail(token, "a@example.kz")
	for range emailVerifyDaily {
		_, err := h.verifyEmail(token, wrongOf(code), h.key())
		if _, reason := refusal(t, err); reason != "email_code_wrong" && reason != "email_code_attempts_exhausted" {
			t.Fatalf("до предела: %v", err)
		}
	}
	_, err := h.verifyEmail(token, code, h.key())
	h.wantRefusal(err, connect.CodeResourceExhausted, "email_code_too_many")

	// Через сутки — снова можно (новый код: прежний исчерпан).
	h.clock.advance(day + time.Second)
	token = h.session(u)
	h.mustVerifyEmail(token, h.mustRequestEmail(token, "a@example.kz"))
}

// Тот же ключ с другим кодом — idempotency_key_reused.
func TestVerifyEmailCodeKeyReused(t *testing.T) {
	h := newHarness(t, nil)
	_, token := h.client()
	code := h.mustRequestEmail(token, "a@example.kz")
	key := h.key()
	if _, err := h.verifyEmail(token, code, key); err != nil {
		t.Fatalf("VerifyEmailCode: %v", err)
	}
	_, err := h.verifyEmail(token, wrongOf(code), key)
	h.wantRefusal(err, connect.CodeInvalidArgument, "idempotency_key_reused")
}

// Код пользователя A не подтверждает почту пользователя B: код привязан к пользователю.
func TestVerifyEmailCodeOtherUser(t *testing.T) {
	h := newHarness(t, nil)
	a, tokenA := h.client()
	b, tokenB := h.client()
	codeA := h.mustRequestEmail(tokenA, "a@example.kz")

	_, err := h.verifyEmail(tokenB, codeA, h.key())
	h.wantRefusal(err, connect.CodeInvalidArgument, "email_code_expired")
	codeB := h.mustRequestEmail(tokenB, "b@example.kz")
	if codeB != codeA {
		_, err = h.verifyEmail(tokenB, codeA, h.key())
		h.wantRefusal(err, connect.CodeInvalidArgument, "email_code_wrong")
	}
	if row, ok := h.personRow(b.ID); ok && (row.Email.Valid || row.EmailVerifiedAt.Valid) {
		t.Fatalf("у B адрес: %+v", row)
	}
	if c := h.emailCodes(a); c[0].Attempts != 0 || c[0].ConsumedAt.Valid {
		t.Fatalf("код A тронут: %+v", c[0])
	}
	if p := h.mustVerifyEmail(tokenA, codeA); p.GetEmail() != "a@example.kz" || !p.GetEmailVerified() {
		t.Fatalf("A: %v", p)
	}
}

// Два одновременных верных ввода с разными ключами: один успех, второй — email_code_expired;
// событие подтверждения одно.
func TestVerifyEmailCodeConcurrentEntries(t *testing.T) {
	h := newHarness(t, nil)
	for round := range 5 {
		u, token := h.client()
		code := h.mustRequestEmail(token, "a@example.kz")
		start := make(chan struct{})
		errs := make([]error, 2)
		var wg sync.WaitGroup
		for i := range 2 {
			key := h.key()
			wg.Add(1)
			go func() {
				defer wg.Done()
				<-start
				_, errs[i] = h.verifyEmail(token, code, key)
			}()
		}
		close(start)
		wg.Wait()
		ok := 0
		for _, err := range errs {
			if err == nil {
				ok++
				continue
			}
			if code, reason := callerRefusal(err); code != connect.CodeInvalidArgument || reason != "email_code_expired" {
				t.Fatalf("раунд %d: отказ проигравшего %v/%q", round, code, reason)
			}
		}
		if ok != 1 {
			t.Fatalf("раунд %d: успехов %d, want 1", round, ok)
		}
		if n := len(h.auditOf(u.ID.String(), "user.email_verified")); n != 1 {
			t.Fatalf("раунд %d: событий user.email_verified %d, want 1", round, n)
		}
	}
}

// N одновременных неверных вводов: засчитано ровно min(N, 5) попыток.
func TestVerifyEmailCodeConcurrentWrong(t *testing.T) {
	h := newHarness(t, nil)
	for _, n := range []int{3, 8} {
		u, token := h.client()
		code := h.mustRequestEmail(token, "a@example.kz")
		start := make(chan struct{})
		var wg sync.WaitGroup
		errs := make([]error, n)
		for i := range n {
			key := h.key()
			wg.Add(1)
			go func() {
				defer wg.Done()
				<-start
				_, errs[i] = h.verifyEmail(token, wrongOf(code), key)
			}()
		}
		close(start)
		wg.Wait()
		for _, err := range errs {
			if _, reason := callerRefusal(err); reason != "email_code_wrong" && reason != "email_code_attempts_exhausted" {
				t.Fatalf("N=%d: %v", n, err)
			}
		}
		if got, want := int(h.emailCodes(u)[0].Attempts), min(n, emailMaxAttempts); got != want {
			t.Fatalf("N=%d: попыток %d, want %d", n, got, want)
		}
	}
}

// Повтор с тем же ключом, пока первый вызов ещё в транзакции: ждёт его и получает тот же
// ответ; эффект один (одно событие, одна попытка).
func TestVerifyEmailCodeConcurrentSameKey(t *testing.T) {
	h := newHarness(t, nil)
	u, token := h.client()
	code := h.mustRequestEmail(token, "a@example.kz")
	key := h.key()

	// Блокировка строки пользователя держит вызов A внутри Do (lockedSession ждёт замок).
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
		res *identityv1.VerifyEmailCodeResponse
		err error
	}
	run := func() chan result {
		ch := make(chan result, 1)
		go func() {
			r, err := h.verifyEmail(token, code, key)
			ch <- result{r, err}
		}()
		return ch
	}
	a := run()
	time.Sleep(500 * time.Millisecond) // A в транзакции и ждёт замок
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
	if !proto.Equal(ra.res, rb.res) || !ra.res.GetPerson().GetEmailVerified() {
		t.Fatalf("B вернул не ответ A: %v / %v", ra.res, rb.res)
	}
	if n := len(h.auditOf(u.ID.String(), "user.email_verified")); n != 1 {
		t.Fatalf("событий user.email_verified %d, want 1", n)
	}
	if c := h.emailCodes(u); c[0].Attempts != 1 {
		t.Fatalf("попыток %d, want 1", c[0].Attempts)
	}
}

// Подтверждается ровно показанный адрес: ввод кода с другим адресом — email_code_expired,
// попытка не списана и код не погашен; тот же адрес в другом регистре и с пробелами — успех.
func TestVerifyEmailCodeShownAddress(t *testing.T) {
	h := newHarness(t, nil)
	u, token := h.client()
	code := h.mustRequestEmail(token, "a@example.kz")

	for _, other := range []string{"b@example.kz", "a@example.kz.evil"} {
		_, err := h.verifyEmailAt(token, other, code, h.key())
		h.wantRefusal(err, connect.CodeInvalidArgument, "email_code_expired")
	}
	if c := h.emailCodes(u); len(c) != 1 || c[0].Attempts != 0 || c[0].ConsumedAt.Valid {
		t.Fatalf("код тронут вводом с другим адресом: %+v", c)
	}
	if row, ok := h.personRow(u.ID); ok && (row.Email.Valid || row.EmailVerifiedAt.Valid) {
		t.Fatalf("адрес записан: %+v", row)
	}

	res, err := h.verifyEmailAt(token, "  A@Example.KZ ", code, h.key())
	if err != nil {
		t.Fatalf("тот же адрес в другом регистре: %v", err)
	}
	if p := res.GetPerson(); p.GetEmail() != "a@example.kz" || !p.GetEmailVerified() {
		t.Fatalf("person = %v", p)
	}
}

// Повтор того же запроса подтверждения (тот же ключ и адрес) — тот же ответ; с тем же ключом,
// но другим адресом — idempotency_key_reused.
func TestVerifyEmailCodeShownAddressIdempotent(t *testing.T) {
	h := newHarness(t, nil)
	_, token := h.client()
	code := h.mustRequestEmail(token, "a@example.kz")
	key := h.key()
	first, err := h.verifyEmailAt(token, "a@example.kz", code, key)
	if err != nil {
		t.Fatalf("VerifyEmailCode: %v", err)
	}
	again, err := h.verifyEmailAt(token, "a@example.kz", code, key)
	if err != nil || !proto.Equal(first, again) {
		t.Fatalf("повтор по ключу: %v, %v", again, err)
	}
	_, err = h.verifyEmailAt(token, "b@example.kz", code, key)
	h.wantRefusal(err, connect.CodeInvalidArgument, "idempotency_key_reused")
}

// Запрос раньше минуты: действующий код на тот же адрес — email_code_already_sent (письма и
// нового кода нет, прежний подходит); на другой адрес — email_code_too_often.
func TestRequestEmailCodeAlreadySent(t *testing.T) {
	h := newHarness(t, nil)
	u, token := h.client()
	code := h.mustRequestEmail(token, "a@example.kz")

	_, err := h.requestEmail(token, " A@Example.KZ ", h.key())
	h.wantRefusal(err, connect.CodeResourceExhausted, "email_code_already_sent")
	_, err = h.requestEmail(token, "b@example.kz", h.key())
	h.wantRefusal(err, connect.CodeResourceExhausted, "email_code_too_often")
	if n := len(h.emailCodes(u)); n != 1 || len(h.email.sent()) != 1 {
		t.Fatalf("кодов %d, отправок %d", n, len(h.email.sent()))
	}
	if p := h.mustVerifyEmail(token, code); p.GetEmail() != "a@example.kz" {
		t.Fatalf("person = %v", p)
	}
}

// Тот же адрес, но код не действует (попытки исчерпаны или код погашен) — email_code_too_often:
// вводить нечего. Истечь код в паузу не успевает (срок 10 минут, пауза минута).
func TestRequestEmailCodeAlreadySentOnlyForLiveCode(t *testing.T) {
	h := newHarness(t, nil)

	// Попытки исчерпаны.
	_, token := h.client()
	code := h.mustRequestEmail(token, "a@example.kz")
	for range emailMaxAttempts {
		_, _ = h.verifyEmail(token, wrongOf(code), h.key())
	}
	_, err := h.requestEmail(token, "a@example.kz", h.key())
	h.wantRefusal(err, connect.CodeResourceExhausted, "email_code_too_often")

	// Погашен: подтверждён, затем адрес сброшен сменой контактов (код погашен) и запрошен снова.
	_, other := h.client()
	h.mustVerifyEmail(other, h.mustRequestEmail(other, "c@example.kz"))
	h.mustUpdateContacts(other, "dala", "d@example.kz")
	_, err = h.requestEmail(other, "c@example.kz", h.key())
	h.wantRefusal(err, connect.CodeResourceExhausted, "email_code_too_often")
}
