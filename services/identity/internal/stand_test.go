package internal

import (
	"context"
	"testing"
	"time"

	"connectrpc.com/connect/v2"
	"google.golang.org/protobuf/types/known/timestamppb"

	identityv1 "github.com/CemeteryPlaya/senim-platform/gen/go/senim/identity/v1"
	"github.com/CemeteryPlaya/senim-platform/gen/go/senim/identity/v1/identityv1connect"
	"github.com/CemeteryPlaya/senim-platform/pkg/config"
)

const roleOperator = identityv1.Role_ROLE_OPERATOR

const unknownUserID = "00000000-0000-4000-8000-000000000000"

func (h *harness) seed(users ...*identityv1.SeedUser) (*identityv1.SeedUsersResponse, error) {
	h.t.Helper()
	return idc(h, "web", func(ctx context.Context, c identityv1connect.IdentityServiceClient) (*identityv1.SeedUsersResponse, error) {
		return c.SeedUsers(ctx, &identityv1.SeedUsersRequest{Users: users, IdempotencyKey: h.key()})
	})
}

func (h *harness) resetStandAs(caller, key string) error {
	h.t.Helper()
	_, err := idc(h, caller, func(ctx context.Context, c identityv1connect.IdentityServiceClient) (*identityv1.ResetStandResponse, error) {
		return c.ResetStand(ctx, &identityv1.ResetStandRequest{IdempotencyKey: key})
	})
	return err
}

func (h *harness) resetStand(key string) error {
	h.t.Helper()
	return h.resetStandAs("web", key)
}

func seedUser(phone string, def identityv1.Role, roles ...identityv1.Role) *identityv1.SeedUser {
	return &identityv1.SeedUser{Phone: phone, DefaultRole: def, Roles: roles}
}

// seededUser сидит одного пользователя и возвращает его.
func (h *harness) seededUser(def identityv1.Role, roles ...identityv1.Role) *identityv1.User {
	h.t.Helper()
	res, err := h.seed(seedUser(newPhone(), def, roles...))
	if err != nil {
		h.t.Fatalf("SeedUsers: %v", err)
	}
	return res.GetUsers()[0]
}

// login входит по номеру обычным путём (RequestOtp → код с экрана → VerifyOtp) и возвращает
// токен сессии и ответ входа. Другого входа нет — и у людей сида тоже.
func (h *harness) login(phone string) (string, *identityv1.VerifyOtpResponse) {
	h.t.Helper()
	req := h.verifyReq(phone, h.issued(phone), "")
	res, err := h.verifyAs("web", req)
	if err != nil {
		h.t.Fatalf("VerifyOtp: %v", err)
	}
	return req.GetSessionToken(), res
}

// testTotpSecret — секрет TOTP оператора стенда в тестах (20 байт, base32 — 32 символа).
var testTotpSecret = []byte("stand-operator-totp!")

// Сид, сброс стенда и согласия сида в prod (и при пустом APP_ENV) — stand_disabled, база не
// затрагивается; вызывающий не web — отказ до окружения.
func TestStandMethodsDisabledInProd(t *testing.T) {
	for _, env := range []config.AppEnv{config.Prod, ""} {
		t.Run(string(env), func(t *testing.T) {
			h := newHarness(t, func(c *ServeConfig) { c.Env = env })
			phone := newPhone()
			_, err := h.seed(seedUser(phone, roleClient, roleClient))
			h.wantRefusal(err, connect.CodeFailedPrecondition, "stand_disabled")
			if n := h.count(`SELECT count(*) FROM users WHERE phone = $1`, phone); n != 0 {
				t.Fatalf("сид в %q создал пользователя", env)
			}
			u, token := h.client()
			h.mustGrant(pdGrant(token, "2026-11-01"))
			err = h.seedConsents(h.key(), seedBank(u.ID.String(), unknownUserID))
			h.wantRefusal(err, connect.CodeFailedPrecondition, "stand_disabled")
			h.wantRefusal(h.resetStand(h.key()), connect.CodeFailedPrecondition, "stand_disabled")
			if n := h.count(`SELECT count(*) FROM sessions WHERE user_id = $1`, u.ID); n != 1 {
				t.Fatalf("сброс в %q тронул сессии: %d", env, n)
			}
			if n := len(h.consentRows(u.ID)); n != 1 {
				t.Fatalf("согласий %d, want 1", n)
			}
			if err := h.resetStandAs("operator", h.key()); err == nil {
				t.Fatal("ожидался отказ чужому вызывающему")
			}
		})
	}
}

// Вне prod (staging) сид и сброс работают — стенд staging тот же, что dev.
func TestStandMethodsAllowedInStaging(t *testing.T) {
	h := newHarness(t, func(c *ServeConfig) { c.Env = config.Staging })
	if u := h.seededUser(roleClient, roleClient); !u.GetSeeded() {
		t.Fatalf("seeded = false: %v", u)
	}
	if err := h.resetStand(h.key()); err != nil {
		t.Fatal(err)
	}
}

func TestStandRequiresWebCaller(t *testing.T) {
	h := newHarness(t, nil)
	if err := h.resetStandAs("operator", "k1"); err == nil {
		t.Fatal("ожидался отказ чужому вызывающему")
	}
}

func TestSeedUsersIdempotentByPhone(t *testing.T) {
	h := newHarness(t, nil)
	phone := newPhone()
	created := timestamppb.New(time.Now().Add(-48 * time.Hour).UTC().Truncate(time.Second))
	first, err := h.seed(&identityv1.SeedUser{Phone: phone, DefaultRole: roleClient, Roles: []identityv1.Role{roleClient}, CreatedAt: created})
	if err != nil {
		t.Fatal(err)
	}
	// Второй запуск меняет роли и снимает блокировку; id тот же, created_at без значения не трогается.
	if _, err := h.pool.Exec(context.Background(), `UPDATE users SET blocked_at = now() WHERE phone = $1`, phone); err != nil {
		t.Fatal(err)
	}
	second, err := h.seed(seedUser(phone, roleExecutor, roleClient, roleExecutor))
	if err != nil {
		t.Fatal(err)
	}
	a, b := first.GetUsers()[0], second.GetUsers()[0]
	if a.GetId() != b.GetId() || a.GetPhone() != phone || !a.GetSeeded() || !b.GetSeeded() {
		t.Fatalf("id нестабилен или не seeded: %v %v", a, b)
	}
	if b.GetDefaultRole() != roleExecutor || len(b.GetRoles()) != 2 || b.GetBlockedAt() != nil {
		t.Fatalf("не обновлён: %v", b)
	}
	if !b.GetCreatedAt().AsTime().Equal(created.AsTime()) {
		t.Fatalf("created_at: %v want %v", b.GetCreatedAt().AsTime(), created.AsTime())
	}
}

// Сид не перезаписывает человека, созданного не сидом: весь сид отклоняется, роли, блокировка
// и признак человека не меняются.
func TestSeedDoesNotOverwriteRealPerson(t *testing.T) {
	h := newHarness(t, nil)
	ctx := context.Background()
	person := h.user([]string{"CLIENT"}, "CLIENT")
	if _, err := h.pool.Exec(ctx, `UPDATE users SET blocked_at = now() WHERE id = $1`, person.ID); err != nil {
		t.Fatal(err)
	}
	other := newPhone()
	_, err := h.seed(seedUser(other, roleClient, roleClient), seedUser(person.Phone, roleExecutor, roleClient, roleExecutor))
	h.wantRefusal(err, connect.CodeInvalidArgument, "invalid_request")
	u, err := h.q.GetUserByID(ctx, person.ID)
	if err != nil {
		t.Fatal(err)
	}
	if u.Seeded || len(u.Roles) != 1 || u.DefaultRole != "CLIENT" || !u.BlockedAt.Valid {
		t.Fatalf("настоящий человек изменён сидом: %+v", u)
	}
	if n := h.count(`SELECT count(*) FROM users WHERE phone = $1`, other); n != 0 {
		t.Fatalf("частичный сид: %d", n)
	}
	// Вход кодом (VerifyOtp) создаёт пользователя не засеянным.
	_, res := h.login(newPhone())
	if res.GetUser().GetSeeded() {
		t.Fatalf("пользователь входа seeded: %v", res.GetUser())
	}
}

func TestSeedUsersKeepsRequestOrder(t *testing.T) {
	h := newHarness(t, nil)
	p1, p2, p3 := newPhone(), newPhone(), newPhone()
	res, err := h.seed(
		seedUser(p3, roleClient, roleClient),
		seedUser(p1, roleOperator, roleOperator),
		seedUser(p2, roleExecutor, roleExecutor),
	)
	if err != nil {
		t.Fatal(err)
	}
	got := []string{res.GetUsers()[0].GetPhone(), res.GetUsers()[1].GetPhone(), res.GetUsers()[2].GetPhone()}
	if got[0] != p3 || got[1] != p1 || got[2] != p2 {
		t.Fatalf("порядок: %v", got)
	}
}

func TestSeedRespectsStaffCheck(t *testing.T) {
	h := newHarness(t, nil)
	phone := newPhone()
	_, err := h.seed(seedUser(phone, roleOperator, roleOperator, roleClient))
	h.wantRefusal(err, connect.CodeInvalidArgument, "invalid_request")
	if n := h.count(`SELECT count(*) FROM users WHERE phone = $1`, phone); n != 0 {
		t.Fatalf("пользователь создан: %d", n)
	}
}

// Администратор стенда — тоже сотрудник: с другой ролью сид отклоняется; один — с секретом
// TOTP проходит, вход требует второго фактора, код по секрету сида принимается.
func TestSeedAdmin(t *testing.T) {
	h := newHarness(t, nil)
	roleAdmin := identityv1.Role_ROLE_ADMIN
	mixed := newPhone()
	for _, u := range []*identityv1.SeedUser{seedUser(mixed, roleAdmin, roleAdmin, roleClient), seedUser(mixed, roleClient, roleClient, roleAdmin)} {
		_, err := h.seed(u)
		h.wantRefusal(err, connect.CodeInvalidArgument, "invalid_request")
	}
	if n := h.count(`SELECT count(*) FROM users WHERE phone = $1`, mixed); n != 0 {
		t.Fatalf("пользователь создан: %d", n)
	}

	phone := newPhone()
	admin := seedUser(phone, roleAdmin, roleAdmin)
	admin.TotpSecretBase32 = b32.EncodeToString(testTotpSecret)
	res, err := h.seed(admin)
	if err != nil {
		t.Fatal(err)
	}
	if got := res.GetUsers()[0]; got.GetDefaultRole() != roleAdmin || len(got.GetRoles()) != 1 || got.GetRoles()[0] != roleAdmin {
		t.Fatalf("администратор сида: %v", got)
	}
	if f, ok := h.factor(res.GetUsers()[0].GetId()); !ok || !f.ConfirmedAt.Valid {
		t.Fatalf("фактор сида: %+v %v", f, ok)
	}
	token, login := h.login(phone)
	if s := login.GetSession(); !s.GetMfaRequired() || s.GetMfaVerifiedAt() != nil || s.GetActiveRole() != roleAdmin {
		t.Fatalf("администратор стенда вошёл без второго фактора: %v", s)
	}
	if _, err := h.verify2FA(token, h.codeNow(testTotpSecret), h.key()); err != nil {
		t.Fatalf("код по секрету сида: %v", err)
	}
}

func TestSeedUsersValidation(t *testing.T) {
	h := newHarness(t, nil)
	ph := newPhone()
	tooMany := make([]*identityv1.SeedUser, 201)
	for i := range tooMany {
		tooMany[i] = seedUser(newPhone(), roleClient, roleClient)
	}
	withSecret := func(u *identityv1.SeedUser, secret string) *identityv1.SeedUser {
		u.TotpSecretBase32 = secret
		return u
	}
	cases := []struct {
		name   string
		users  []*identityv1.SeedUser
		reason string
	}{
		{"телефон", []*identityv1.SeedUser{seedUser("123", roleClient, roleClient)}, "invalid_phone"},
		{"пустые роли", []*identityv1.SeedUser{seedUser(ph, roleClient)}, "invalid_request"},
		{"неизвестная роль", []*identityv1.SeedUser{seedUser(ph, roleClient, identityv1.Role_ROLE_UNSPECIFIED)}, "invalid_request"},
		{"роль по умолчанию не выдана", []*identityv1.SeedUser{seedUser(ph, roleExecutor, roleClient)}, "invalid_request"},
		{"повтор телефона", []*identityv1.SeedUser{seedUser(ph, roleClient, roleClient), seedUser(ph, roleClient, roleClient)}, "invalid_request"},
		{"слишком много", tooMany, "invalid_request"},
		{"пустой список", nil, "invalid_request"},
		{"секрет TOTP не оператору", []*identityv1.SeedUser{withSecret(seedUser(ph, roleClient, roleClient), b32.EncodeToString(testTotpSecret))}, "invalid_request"},
		{"секрет TOTP не base32", []*identityv1.SeedUser{withSecret(seedUser(ph, roleOperator, roleOperator), "not base32!")}, "invalid_request"},
		{"секрет TOTP с «=»", []*identityv1.SeedUser{withSecret(seedUser(ph, roleOperator, roleOperator), b32.EncodeToString(testTotpSecret[:16])+"======")}, "invalid_request"},
		{"секрет TOTP короче 16 байт", []*identityv1.SeedUser{withSecret(seedUser(ph, roleOperator, roleOperator), b32.EncodeToString(testTotpSecret[:15]))}, "invalid_request"},
		{"секрет TOTP длиннее 64 байт", []*identityv1.SeedUser{withSecret(seedUser(ph, roleOperator, roleOperator), b32.EncodeToString(make([]byte, 65)))}, "invalid_request"},
	}
	for _, c := range cases {
		t.Run(c.name, func(_ *testing.T) {
			_, err := h.seed(c.users...)
			h.wantRefusal(err, connect.CodeInvalidArgument, c.reason)
		})
	}
	if n := h.count(`SELECT count(*) FROM users WHERE phone = $1`, ph); n != 0 {
		t.Fatalf("пользователь создан: %d", n)
	}
}

// Оператор стенда входит как все: код из SMS, затем второй фактор — исключений нет. Секрет из
// сида — подключённый фактор: код по нему проходит VerifySecondFactor, новое подключение не
// нужно (mfa_already_enrolled). Повторный сид с другим секретом заменяет фактор.
func TestSeedOperatorTotpSecret(t *testing.T) {
	h := newHarness(t, nil)
	phone := newPhone()
	op := seedUser(phone, roleOperator, roleOperator)
	op.TotpSecretBase32 = b32.EncodeToString(testTotpSecret)
	res, err := h.seed(op)
	if err != nil {
		t.Fatal(err)
	}
	opID := res.GetUsers()[0].GetId()
	f, ok := h.factor(opID)
	if !ok || !f.ConfirmedAt.Valid || f.LastUsedStep != 0 {
		t.Fatalf("фактор сида: %+v %v", f, ok)
	}
	secret, err := h.svc.cfg.PII.Open(f.SecretEnc, mfaSecretAAD(f.UserID))
	if err != nil || string(secret) != string(testTotpSecret) {
		t.Fatalf("секрет сида расшифрован неверно: %v", err)
	}

	token, login := h.login(phone)
	if s := login.GetSession(); !s.GetMfaRequired() || s.GetMfaVerifiedAt() != nil {
		t.Fatalf("оператор стенда вошёл без второго фактора: %v", s)
	}
	if c := h.tokenClaims(token); c["mfa"] != false {
		t.Fatalf("токен до второго фактора: mfa=%v", c["mfa"])
	}
	_, err = h.startTotp(token, h.key())
	h.wantRefusal(err, connect.CodeFailedPrecondition, "mfa_already_enrolled")
	_, err = h.verify2FA(token, h.wrongCode(testTotpSecret), h.key())
	h.wantRefusal(err, connect.CodeInvalidArgument, "mfa_wrong_code")
	now := h.clock.now()
	ver, err := h.verify2FA(token, h.codeNow(testTotpSecret), h.key())
	if err != nil {
		t.Fatalf("код по секрету сида: %v", err)
	}
	if !ver.GetSession().GetMfaVerifiedAt().AsTime().Equal(now) {
		t.Fatalf("mfa_verified_at: %v", ver.GetSession())
	}
	if c := h.tokenClaims(token); c["mfa"] != true {
		t.Fatalf("токен после второго фактора: mfa=%v", c["mfa"])
	}

	// Пересев тем же секретом не открывает повтор уже принятого кода; другим — заменяет фактор
	// и снимает отметку второго фактора в сессиях.
	h.clock.advance(totpPeriod * time.Second)
	if _, err := h.seed(op); err != nil {
		t.Fatal(err)
	}
	if f2, _ := h.factor(opID); f2.LastUsedStep != now.Unix()/totpPeriod {
		t.Fatalf("пересев сбросил шаг: %d", f2.LastUsedStep)
	}
	other := []byte("another-stand-secret")
	op.TotpSecretBase32 = b32.EncodeToString(other)
	if _, err := h.seed(op); err != nil {
		t.Fatal(err)
	}
	if s := h.sessionRow(token); s.MfaVerifiedAt.Valid {
		t.Fatal("отметка второго фактора осталась после замены секрета")
	}
	h.clock.advance(totpPeriod * time.Second)
	_, err = h.verify2FA(token, h.codeNow(testTotpSecret), h.key())
	h.wantRefusal(err, connect.CodeInvalidArgument, "mfa_wrong_code")
	if _, err := h.verify2FA(token, h.codeNow(other), h.key()); err != nil {
		t.Fatalf("код по новому секрету: %v", err)
	}
	// Пересев без секрета фактор не трогает.
	op.TotpSecretBase32 = ""
	if _, err := h.seed(op); err != nil {
		t.Fatal(err)
	}
	if f3, ok := h.factor(opID); !ok || !f3.ConfirmedAt.Valid {
		t.Fatalf("фактор после пересева без секрета: %+v %v", f3, ok)
	}
}

// Засеянный оператор без секрета входит кодом и проходит второй фактор как настоящий:
// подключает приложение (StartTotpEnrollment), до этого mfa в токене нет.
func TestSeededOperatorWithoutSecretEnrolls(t *testing.T) {
	h := newHarness(t, nil)
	phone := newPhone()
	if _, err := h.seed(seedUser(phone, roleOperator, roleOperator)); err != nil {
		t.Fatal(err)
	}
	token, login := h.login(phone)
	if s := login.GetSession(); !s.GetMfaRequired() || s.GetMfaVerifiedAt() != nil {
		t.Fatalf("сессия оператора: %v", s)
	}
	if c := h.tokenClaims(token); c["mfa"] != false {
		t.Fatal("mfa до подключения")
	}
	h.enrolled(token)
	if c := h.tokenClaims(token); c["mfa"] != true {
		t.Fatal("mfa после подключения")
	}
}

func TestResetStandClearsLimits(t *testing.T) {
	h := newHarness(t, nil)
	phone := h.registered(newPhone())
	h.mustRequest(phone, "")
	// Повторный запрос упирается в паузу между кодами.
	_, err := h.request(phone, "")
	h.wantRefusal(err, connect.CodeResourceExhausted, "otp_too_often")
	if n := h.count(`SELECT count(*) FROM otp_codes WHERE phone = $1`, phone); n != 1 {
		t.Fatalf("кодов до сброса: %d", n)
	}

	// Второй фактор: засеянный оператор с секретом сида и засеянный, подключивший сам, — после
	// сброса без фактора; настоящий оператор свой фактор сохраняет.
	opSeed := seedUser(newPhone(), roleOperator, roleOperator)
	opSeed.TotpSecretBase32 = b32.EncodeToString(testTotpSecret)
	seededOps, err := h.seed(opSeed, seedUser(newPhone(), roleOperator, roleOperator))
	if err != nil {
		t.Fatal(err)
	}
	enrollToken, _ := h.login(seededOps.GetUsers()[1].GetPhone())
	h.enrolled(enrollToken)
	realOp, realToken := h.operator()
	h.enrolled(realToken)
	seededIDs := []string{seededOps.GetUsers()[0].GetId(), seededOps.GetUsers()[1].GetId()}
	if n := h.count(`SELECT count(*) FROM mfa_factors WHERE user_id = ANY($1)`, seededIDs); n != 2 {
		t.Fatalf("факторов засеянных до сброса: %d", n)
	}
	// Код почты заказчика.
	_, clientToken := h.client()
	h.mustRequestEmail(clientToken, "a@example.kz")
	usersBefore := h.count(`SELECT count(*) FROM users`)

	if err := h.resetStand(h.key()); err != nil {
		t.Fatal(err)
	}
	for _, table := range []string{"sessions", "otp_codes", "email_codes", "rate_limits"} {
		if n := h.count(`SELECT count(*) FROM ` + table); n != 0 {
			t.Fatalf("%s: %d строк после сброса", table, n)
		}
	}
	if n := h.count(`SELECT count(*) FROM mfa_factors f JOIN users u ON u.id = f.user_id WHERE u.seeded`); n != 0 {
		t.Fatalf("факторов засеянных после сброса: %d", n)
	}
	if _, ok := h.factor(realOp.ID.String()); !ok {
		t.Fatal("сброс стенда удалил фактор настоящего оператора")
	}
	if n := h.count(`SELECT count(*) FROM users`); n != usersBefore {
		t.Fatalf("пользователей было %d, стало %d", usersBefore, n)
	}
	h.mustRequest(phone, "") // пауза сброшена вместе с лимитами
	// Пересев возвращает оператору фактор с секретом сида.
	if _, err := h.seed(opSeed); err != nil {
		t.Fatal(err)
	}
	if f, ok := h.factor(seededIDs[0]); !ok || !f.ConfirmedAt.Valid {
		t.Fatalf("фактор после пересева: %+v %v", f, ok)
	}
}

func TestResetStandIsIdempotentAndDropsStaleReplays(t *testing.T) {
	h := newHarness(t, nil)
	u := h.seededUser(roleClient, roleClient)
	token, _ := h.login(u.GetPhone())
	switchKey := h.key()
	if _, err := h.switchRole(token, roleClient, switchKey); err != nil {
		t.Fatal(err)
	}
	if n := h.count(`SELECT count(*) FROM idempotency WHERE key = $1`, switchKey); n != 1 {
		t.Fatalf("ключ до сброса: %d", n)
	}
	key := h.key()
	if err := h.resetStand(key); err != nil {
		t.Fatal(err)
	}
	if err := h.resetStand(key); err != nil { // повтор — тот же успех
		t.Fatalf("повтор ResetStand: %v", err)
	}
	// Сохранённые ответы прежних вызовов забыты: повтор не вернёт вход в удалённую сессию.
	if n := h.count(`SELECT count(*) FROM idempotency WHERE key = $1`, switchKey); n != 0 {
		t.Fatalf("старый ключ после сброса: %d", n)
	}
	if n := h.count(`SELECT count(*) FROM idempotency WHERE key = $1`, key); n != 1 {
		t.Fatalf("ключ сброса: %d", n)
	}
	h.wantInvalid(token)
}
