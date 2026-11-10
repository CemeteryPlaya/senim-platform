package internal

import (
	"bytes"
	"context"
	"errors"
	"fmt"
	"regexp"
	"strings"
	"testing"
	"time"

	"connectrpc.com/connect/v2"
	"google.golang.org/protobuf/proto"

	identityv1 "github.com/CemeteryPlaya/senim-platform/gen/go/senim/identity/v1"
)

var sixDigits = regexp.MustCompile(`^\d{6}$`)

const wantGlobalSubject = "senim.identity.otp.global_limit_reached"

func TestRequestStoresOnlyHMACFor5Min(t *testing.T) {
	h := newHarness(t, nil)
	phone := newPhone()
	// Номер в пользовательском виде: 8 700 …
	raw := "8 " + phone[2:5] + " " + phone[5:8] + " " + phone[8:10] + " " + phone[10:]
	res := h.mustRequest(raw, "203.0.113.7")

	if res.GetPhone() != phone {
		t.Fatalf("phone = %q, want %q", res.GetPhone(), phone)
	}
	if !sixDigits.MatchString(res.GetDemoCode()) {
		t.Fatalf("demo_code = %q, want 6 digits", res.GetDemoCode())
	}
	var hash []byte
	var expires time.Time
	if err := h.pool.QueryRow(context.Background(), `SELECT code_hash, expires_at FROM otp_codes WHERE phone = $1`, phone).Scan(&hash, &expires); err != nil {
		t.Fatal(err)
	}
	if !bytes.Equal(hash, wantHash(phone, res.GetDemoCode())) {
		t.Fatal("в базе не HMAC-SHA256(ключ, otp:v1:телефон:код)")
	}
	if bytes.Contains(hash, []byte(res.GetDemoCode())) {
		t.Fatal("код лежит в базе открытым текстом")
	}
	if want := h.clock.now().Add(5 * time.Minute); !expires.Equal(want) || !res.GetExpiresAt().AsTime().Equal(want) {
		t.Fatalf("expires_at = %v / %v, want %v", expires, res.GetExpiresAt().AsTime(), want)
	}
	if got := h.sender.sent(); len(got) != 1 || got[0].phone != phone || got[0].code != res.GetDemoCode() {
		t.Fatalf("Send вызван так: %v", got)
	}
}

func TestNoDemoCodeOutsideDemo(t *testing.T) {
	for name, tune := range map[string]func(*ServeConfig){
		"не демо":          func(c *ServeConfig) { c.DemoMode = false },
		"демо, не mock":    func(c *ServeConfig) { c.OTPProvider = "sms" },
		"ни демо, ни mock": func(c *ServeConfig) { c.DemoMode, c.OTPProvider = false, "sms" },
	} {
		t.Run(name, func(t *testing.T) {
			h := newHarness(t, tune)
			if code := h.mustRequest(newPhone(), "").GetDemoCode(); code != "" {
				t.Fatalf("demo_code = %q, want empty", code)
			}
			// SMS всё равно уходит.
			if got := h.sender.sent(); len(got) != 1 || !sixDigits.MatchString(got[0].code) {
				t.Fatalf("Send: %v", got)
			}
		})
	}
}

func TestRejectsNonKZMobile(t *testing.T) {
	h := newHarness(t, nil)
	for _, phone := range []string{"+7 912 000 00 00", "", "abc", "+1 700 000 55 01"} {
		_, err := h.request(phone, "203.0.113.7")
		h.wantRefusal(err, connect.CodeInvalidArgument, "invalid_phone")
	}
	if n := h.count(`SELECT count(*) FROM otp_codes`); n != 0 || len(h.sender.sent()) != 0 {
		t.Fatalf("кодов %d, отправок %d, want 0", n, len(h.sender.sent()))
	}
}

func TestCooldown60s(t *testing.T) {
	h := newHarness(t, nil)
	phone := newPhone()
	h.mustRequest(phone, "")
	_, err := h.request(phone, "")
	h.wantRefusal(err, connect.CodeResourceExhausted, "otp_too_often")
	if h.codeRows(phone) != 1 {
		t.Fatal("отказанный запрос создал код")
	}
	h.clock.advance(61 * time.Second)
	h.mustRequest(phone, "")
	if h.codeRows(phone) != 2 {
		t.Fatal("после паузы код не выдан")
	}
}

func TestPhoneHourlyLimit5(t *testing.T) {
	h := newHarness(t, nil)
	phone := newPhone()
	for range 5 {
		h.mustRequest(phone, "")
		h.clock.advance(61 * time.Second)
	}
	_, err := h.request(phone, "")
	h.wantRefusal(err, connect.CodeResourceExhausted, "otp_too_many_requests")
	h.clock.advance(time.Hour)
	h.mustRequest(phone, "")
}

func TestIPHourlyLimit(t *testing.T) {
	h := newHarness(t, nil)
	const ip = "203.0.113.7"
	for i := range 20 {
		h.mustRequest(fmt.Sprintf("+770000600%02d", i), ip)
	}
	_, err := h.request("+77000006099", ip)
	h.wantRefusal(err, connect.CodeResourceExhausted, "otp_too_many_requests")
	if h.codeRows("+77000006099") != 0 {
		t.Fatal("отказанный по IP запрос создал код")
	}
	h.mustRequest("+77000006099", "198.51.100.1")
}

// IPv6: у абонента обычно целая /64, и полный адрес меняется свободно — лимит считается по /64.
func TestIPHourlyLimitIPv6By64(t *testing.T) {
	h := newHarness(t, nil)
	for i := range 20 {
		h.mustRequest(fmt.Sprintf("+770000610%02d", i), fmt.Sprintf("2001:db8:1:2::%x", i+1))
	}
	_, err := h.request("+77000061099", "2001:db8:1:2:ffff:ffff:ffff:ffff")
	h.wantRefusal(err, connect.CodeResourceExhausted, "otp_too_many_requests")
	h.mustRequest("+77000061099", "2001:db8:1:3::1")
}

func TestIPLimitKey(t *testing.T) {
	cases := []struct{ ip, want string }{
		{"203.0.113.7", "203.0.113.7"},
		{"2001:db8:1:2::1", "2001:db8:1:2::/64"},
		{"2001:db8:1:2:ffff:ffff:ffff:ffff", "2001:db8:1:2::/64"},
		{"2001:db8:1:3::1", "2001:db8:1:3::/64"},
		{"::ffff:203.0.113.7", "203.0.113.7"},
	}
	for _, c := range cases {
		if got := ipLimitKey(c.ip); got != c.want {
			t.Errorf("ipLimitKey(%q) = %q, want %q", c.ip, got, c.want)
		}
	}
	if ipLimitKey("2001:db8:1:2::1") != ipLimitKey("2001:db8:1:2:abcd::9") {
		t.Error("два адреса одной /64 дали разные ключи")
	}
	if ipLimitKey("2001:db8:1:2::1") == ipLimitKey("2001:db8:1:3::1") {
		t.Error("разные /64 дали один ключ")
	}
}

func TestUnknownIPUsesPhoneLimits(t *testing.T) {
	h := newHarness(t, nil)
	for i := range 25 {
		h.mustRequest(fmt.Sprintf("+770000700%02d", i), "")
	}
	if n := h.count(`SELECT count(*) FROM rate_limits WHERE key LIKE 'otp:ip:%'`); n != 0 {
		t.Fatalf("счётчиков IP: %d, want 0", n)
	}
	_, err := h.request("+77000070000", "")
	h.wantRefusal(err, connect.CodeResourceExhausted, "otp_too_often")
}

func TestPhoneDailyLimit10(t *testing.T) {
	h := newHarness(t, nil)
	phone := newPhone()
	for range 10 {
		h.mustRequest(phone, "")
		// Минутная пауза и часовое окно истекли — остаётся только суточное.
		if _, err := h.pool.Exec(context.Background(), `DELETE FROM rate_limits WHERE key NOT LIKE '%:day'`); err != nil {
			t.Fatal(err)
		}
	}
	_, err := h.request(phone, "")
	h.wantRefusal(err, connect.CodeResourceExhausted, "otp_too_many_today")
}

func TestGlobalCeiling(t *testing.T) {
	h := newHarness(t, func(c *ServeConfig) { c.OTPDailyGlobalLimit = 3 })
	for i := range 3 {
		h.mustRequest(fmt.Sprintf("+770000800%d0", i), fmt.Sprintf("198.51.100.%d", i))
	}
	_, err := h.request("+77000008099", "198.51.100.99")
	h.wantRefusal(err, connect.CodeResourceExhausted, "otp_global_limit")
	if n := h.count(`SELECT count(*) FROM otp_codes`); n != 3 {
		t.Fatalf("кодов %d, want 3", n)
	}
}

func TestCeilingDefaults500And50(t *testing.T) {
	cfg, err := load(t, serveVars())
	if err != nil {
		t.Fatal(err)
	}
	if cfg.OTPDailyGlobalLimit != 500 || cfg.OTPDailyPrefixLimit != 50 {
		t.Fatalf("потолки по умолчанию %d / %d, want 500 / 50", cfg.OTPDailyGlobalLimit, cfg.OTPDailyPrefixLimit)
	}
}

func TestCeilingSkipsRegisteredUsers(t *testing.T) {
	h := newHarness(t, func(c *ServeConfig) { c.OTPDailyGlobalLimit = 2 })
	user := h.registered("+77010008001")
	for i := range 2 {
		h.mustRequest(fmt.Sprintf("+770200080%d0", i), "")
	}
	_, err := h.request("+77020008099", "")
	h.wantRefusal(err, connect.CodeResourceExhausted, "otp_global_limit")

	h.mustRequest(user, "")
	// Лимиты номера для зарегистрированного по-прежнему действуют.
	_, err = h.request(user, "")
	h.wantRefusal(err, connect.CodeResourceExhausted, "otp_too_often")
}

func TestGlobalCeilingEventOncePerDay(t *testing.T) {
	h := newHarness(t, func(c *ServeConfig) { c.OTPDailyGlobalLimit = 1 })
	events := func() int {
		return h.count(`SELECT count(*) FROM outbox WHERE subject = $1`, wantGlobalSubject)
	}
	before := events()
	h.mustRequest("+77020009000", "")
	for i := 1; i <= 3; i++ {
		_, err := h.request(fmt.Sprintf("+770200090%d0", i), "")
		h.wantRefusal(err, connect.CodeResourceExhausted, "otp_global_limit")
	}
	if got := events() - before; got != 1 {
		t.Fatalf("событий за сутки %d, want 1", got)
	}
	if n := strings.Count(h.logs.String(), "otp.global_limit_reached"); n != 1 {
		t.Fatalf("предупреждений в логе %d, want 1", n)
	}
	if strings.Contains(h.logs.String(), "770200090") {
		t.Fatal("номер телефона попал в лог")
	}
	// Через сутки потолок снова достигается — новое событие.
	h.clock.advance(25 * time.Hour)
	h.mustRequest("+77020009100", "")
	_, err := h.request("+77020009110", "")
	h.wantRefusal(err, connect.CodeResourceExhausted, "otp_global_limit")
	if got := events() - before; got != 2 {
		t.Fatalf("событий за двое суток %d, want 2", got)
	}
}

func TestPrefixCeiling(t *testing.T) {
	h := newHarness(t, func(c *ServeConfig) { c.OTPDailyPrefixLimit = 2 })
	registered := h.registered("+77030001999")
	h.mustRequest("+77030001000", "")
	h.mustRequest("+77030002000", "")

	_, err := h.request("+77030003000", "")
	h.wantRefusal(err, connect.CodeResourceExhausted, "otp_global_limit")
	if h.codeRows("+77030003000") != 0 {
		t.Fatal("отказанный по префиксу запрос создал код")
	}
	// Другой префикс и зарегистрированный номер того же префикса — проходят.
	h.mustRequest("+77040001000", "")
	h.mustRequest(registered, "")
}

func TestPhoneRefusalDoesNotSpendCeiling(t *testing.T) {
	h := newHarness(t, func(c *ServeConfig) { c.OTPDailyGlobalLimit = 2 })
	phone := newPhone()
	h.mustRequest(phone, "")
	for range 5 {
		if _, err := h.request(phone, ""); err == nil {
			t.Fatal("повтор прошёл")
		}
	}
	// Отказы по лимиту номера потолок не тронули: второй новый номер ещё проходит.
	h.mustRequest(newPhone(), "")
	var n int
	if err := h.pool.QueryRow(context.Background(), `SELECT count FROM rate_limits WHERE key = 'otp:global:day'`).Scan(&n); err != nil {
		t.Fatal(err)
	}
	if n != 2 {
		t.Fatalf("счётчик потолка %d, want 2", n)
	}
}

func TestOnlyLatestCodeValid(t *testing.T) {
	h := newHarness(t, nil)
	phone := newPhone()
	first := h.mustRequest(phone, "").GetDemoCode()
	h.clock.advance(61 * time.Second)
	second := h.mustRequest(phone, "").GetDemoCode()

	// Проверка кода берёт самую свежую строку: это второй код, первый уже не подходит.
	var latest []byte
	if err := h.pool.QueryRow(context.Background(),
		`SELECT code_hash FROM otp_codes WHERE phone = $1 AND consumed_at IS NULL ORDER BY created_at DESC LIMIT 1`, phone).Scan(&latest); err != nil {
		t.Fatal(err)
	}
	if !bytes.Equal(latest, wantHash(phone, second)) || bytes.Equal(latest, wantHash(phone, first)) {
		t.Fatal("самая свежая строка не соответствует последнему коду")
	}
	if h.codeRows(phone) != 2 {
		t.Fatal("ожидались две строки кодов")
	}
}

func TestRequestOtpReplaySameKey(t *testing.T) {
	h := newHarness(t, nil)
	phone := newPhone()
	req := &identityv1.RequestOtpRequest{Phone: phone, ClientIp: "203.0.113.7", IdempotencyKey: "replay-key-1"}
	first, err := h.callAs("web", req)
	if err != nil {
		t.Fatal(err)
	}
	if first.GetDemoCode() == "" {
		t.Fatal("в демо первый ответ несёт код")
	}
	// Сразу же: без идемпотентности это был бы отказ cooldown.
	again, err := h.callAs("web", proto.Clone(req).(*identityv1.RequestOtpRequest))
	if err != nil {
		t.Fatalf("повтор с тем же ключом: %v", err)
	}
	if !again.GetExpiresAt().AsTime().Equal(first.GetExpiresAt().AsTime()) || again.GetPhone() != first.GetPhone() {
		t.Fatalf("повтор вернул другой ответ: %v vs %v", again, first)
	}
	if again.GetDemoCode() != "" {
		t.Fatal("код попал в сохранённый ответ идемпотентности")
	}
	if h.codeRows(phone) != 1 || len(h.sender.sent()) != 1 {
		t.Fatalf("кодов %d, отправок %d, want 1/1", h.codeRows(phone), len(h.sender.sent()))
	}
	// Повтор не расходует лимиты.
	if n := h.count(`SELECT count FROM rate_limits WHERE key = $1`, "otp:phone:"+phone+":cooldown"); n != 1 {
		t.Fatalf("cooldown-счётчик %d, want 1", n)
	}
	// Тот же ключ с другим запросом.
	other := proto.Clone(req).(*identityv1.RequestOtpRequest)
	other.Phone = newPhone()
	_, err = h.callAs("web", other)
	h.wantRefusal(err, connect.CodeInvalidArgument, "idempotency_key_reused")
}

func TestRequestOtpKeyRequired(t *testing.T) {
	h := newHarness(t, nil)
	for _, key := range []string{"", strings.Repeat("k", 129)} {
		_, err := h.callAs("web", &identityv1.RequestOtpRequest{Phone: newPhone(), IdempotencyKey: key})
		h.wantRefusal(err, connect.CodeInvalidArgument, "invalid_request")
	}
	if len(h.sender.sent()) != 0 {
		t.Fatal("SMS ушла при неверном ключе")
	}
}

func TestRequestOtpRejectsBadClientIP(t *testing.T) {
	h := newHarness(t, nil)
	for _, ip := range []string{"203.0.113.7:443", "203.0.113.7, 198.51.100.1", "not-an-ip", "203.0.113.256"} {
		_, err := h.callAs("web", &identityv1.RequestOtpRequest{Phone: newPhone(), ClientIp: ip, IdempotencyKey: "bad-ip-" + ip})
		h.wantRefusal(err, connect.CodeInvalidArgument, "invalid_request")
	}
	if n := h.count(`SELECT count(*) FROM rate_limits`); n != 0 || len(h.sender.sent()) != 0 {
		t.Fatalf("счётчиков %d, отправок %d, want 0", n, len(h.sender.sent()))
	}
}

func TestIPRefusalDoesNotSpendCeilings(t *testing.T) {
	h := newHarness(t, nil)
	const ip = "203.0.113.9"
	for i := range 20 {
		h.mustRequest(fmt.Sprintf("+770000900%02d", i), ip)
	}
	var global, prefix int
	if err := h.pool.QueryRow(context.Background(), `SELECT count FROM rate_limits WHERE key = 'otp:global:day'`).Scan(&global); err != nil {
		t.Fatal(err)
	}
	if err := h.pool.QueryRow(context.Background(), `SELECT count FROM rate_limits WHERE key = 'otp:prefix:770000:day'`).Scan(&prefix); err != nil {
		t.Fatal(err)
	}
	_, err := h.request("+77000090099", ip)
	h.wantRefusal(err, connect.CodeResourceExhausted, "otp_too_many_requests")
	if got := h.count(`SELECT count FROM rate_limits WHERE key = 'otp:global:day'`); got != global {
		t.Fatalf("общий потолок %d -> %d: отказ по IP его расходует", global, got)
	}
	if got := h.count(`SELECT count FROM rate_limits WHERE key = 'otp:prefix:770000:day'`); got != prefix {
		t.Fatalf("потолок префикса %d -> %d: отказ по IP его расходует", prefix, got)
	}
}

// Тот же ключ и тот же запрос при действующем cooldown: сохранённый ответ, а не otp_too_often.
func TestSameKeyDuringCooldownReturnsSavedResponse(t *testing.T) {
	h := newHarness(t, nil)
	req := &identityv1.RequestOtpRequest{Phone: newPhone(), IdempotencyKey: "cooldown-replay-1"}
	first, err := h.callAs("web", req)
	if err != nil {
		t.Fatal(err)
	}
	// Другой ключ в те же секунды — действительно отказ cooldown.
	_, err = h.request(req.GetPhone(), "")
	h.wantRefusal(err, connect.CodeResourceExhausted, "otp_too_often")
	again, err := h.callAs("web", proto.Clone(req).(*identityv1.RequestOtpRequest))
	if err != nil {
		t.Fatalf("тот же ключ при cooldown: %v", err)
	}
	if !again.GetExpiresAt().AsTime().Equal(first.GetExpiresAt().AsTime()) {
		t.Fatal("вернулся не сохранённый ответ")
	}
}

func TestRequestOtpCallerMustBeWeb(t *testing.T) {
	h := newHarness(t, nil)
	req := func() *identityv1.RequestOtpRequest {
		return &identityv1.RequestOtpRequest{Phone: newPhone(), IdempotencyKey: fmt.Sprintf("caller-%d", h.keySeq.Add(1))}
	}
	for _, caller := range []string{"deal", "operator", ""} {
		_, err := h.callAs(caller, req())
		h.wantRefusal(err, connect.CodePermissionDenied, "caller_forbidden")
	}
	if n := h.count(`SELECT count(*) FROM otp_codes`); n != 0 || len(h.sender.sent()) != 0 {
		t.Fatalf("чужой вызывающий оставил следы: кодов %d, отправок %d", n, len(h.sender.sent()))
	}
	if n := h.count(`SELECT count(*) FROM rate_limits`); n != 0 {
		t.Fatalf("чужой вызывающий расходует лимиты: %d", n)
	}
	if _, err := h.callAs("web", req()); err != nil {
		t.Fatalf("web: %v", err)
	}
}

func TestSendFailureLeavesNoCodeAndKeyIsReusable(t *testing.T) {
	h := newHarness(t, nil)
	phone := newPhone()
	req := &identityv1.RequestOtpRequest{Phone: phone, IdempotencyKey: "send-fails-1"}
	h.sender.failWith(errors.New("provider down"))
	_, err := h.callAs("web", req)
	if code := connect.CodeOf(err); code != connect.CodeInternal {
		t.Fatalf("код %v, want internal (после побочного эффекта Unavailable запрещён)", code)
	}
	if h.codeRows(phone) != 0 {
		t.Fatal("код остался после неудачной отправки")
	}
	h.sender.failWith(nil)
	// Счётчики уже засчитаны: немедленный повтор того же ключа упирается в cooldown.
	_, err = h.callAs("web", req)
	h.wantRefusal(err, connect.CodeResourceExhausted, "otp_too_often")
	h.clock.advance(61 * time.Second)
	if _, err := h.callAs("web", req); err != nil {
		t.Fatalf("повтор того же ключа после сбоя: %v", err)
	}
}
