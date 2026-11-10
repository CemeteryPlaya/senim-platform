package internal

import (
	"context"
	"testing"
	"time"

	"connectrpc.com/connect/v2"
	"google.golang.org/protobuf/types/known/timestamppb"

	identityv1 "github.com/CemeteryPlaya/senim-platform/gen/go/senim/identity/v1"
	"github.com/CemeteryPlaya/senim-platform/gen/go/senim/identity/v1/identityv1connect"
)

const roleOperator = identityv1.Role_ROLE_OPERATOR

const unknownUserID = "00000000-0000-4000-8000-000000000000"

func (h *harness) seed(users ...*identityv1.SeedUser) (*identityv1.SeedUsersResponse, error) {
	h.t.Helper()
	return idc(h, "web", func(ctx context.Context, c identityv1connect.IdentityServiceClient) (*identityv1.SeedUsersResponse, error) {
		return c.SeedUsers(ctx, &identityv1.SeedUsersRequest{Users: users, IdempotencyKey: h.key()})
	})
}

func (h *harness) startDemo(req *identityv1.StartDemoSessionRequest) (*identityv1.StartDemoSessionResponse, error) {
	h.t.Helper()
	if req.IdempotencyKey == "" {
		req.IdempotencyKey = h.key()
	}
	if req.SessionToken == "" {
		req.SessionToken = newToken(h.t)
	}
	return idc(h, "web", func(ctx context.Context, c identityv1connect.IdentityServiceClient) (*identityv1.StartDemoSessionResponse, error) {
		return c.StartDemoSession(ctx, req)
	})
}

func (h *harness) resetDemoAs(caller, key string) error {
	h.t.Helper()
	_, err := idc(h, caller, func(ctx context.Context, c identityv1connect.IdentityServiceClient) (*identityv1.ResetDemoResponse, error) {
		return c.ResetDemo(ctx, &identityv1.ResetDemoRequest{IdempotencyKey: key})
	})
	return err
}

func (h *harness) resetDemo(key string) error {
	h.t.Helper()
	return h.resetDemoAs("web", key)
}

func seedUser(phone string, def identityv1.Role, isDemo bool, roles ...identityv1.Role) *identityv1.SeedUser {
	return &identityv1.SeedUser{Phone: phone, DefaultRole: def, Roles: roles, IsDemo: isDemo}
}

// demoUser сидит одного пользователя и возвращает его.
func (h *harness) demoUser(def identityv1.Role, isDemo bool, roles ...identityv1.Role) *identityv1.User {
	h.t.Helper()
	res, err := h.seed(seedUser(newPhone(), def, isDemo, roles...))
	if err != nil {
		h.t.Fatalf("SeedUsers: %v", err)
	}
	return res.GetUsers()[0]
}

func TestStartDemoSessionSetsSession(t *testing.T) {
	h := newHarness(t, nil)
	u := h.demoUser(roleClient, true, roleClient, roleExecutor)
	token := newToken(t)
	res, err := h.startDemo(&identityv1.StartDemoSessionRequest{UserId: u.GetId(), SessionToken: token, UserAgent: "vitest"})
	if err != nil {
		t.Fatal(err)
	}
	if res.GetUser().GetId() != u.GetId() || res.GetSession().GetActiveRole() != roleClient {
		t.Fatalf("ответ: %v", res)
	}
	if auth := h.mustAuth(token); auth.GetUser().GetId() != u.GetId() {
		t.Fatalf("Authenticate: %v", auth)
	}
}

func TestStartDemoSessionAsGrantedRole(t *testing.T) {
	h := newHarness(t, nil)
	u := h.demoUser(roleClient, true, roleClient, roleExecutor)
	res, err := h.startDemo(&identityv1.StartDemoSessionRequest{UserId: u.GetId(), AsRole: roleExecutor})
	if err != nil {
		t.Fatal(err)
	}
	if res.GetSession().GetActiveRole() != roleExecutor {
		t.Fatalf("роль: %v", res.GetSession().GetActiveRole())
	}
}

func TestStartDemoSessionRoleNotGrantedMakesNoSession(t *testing.T) {
	h := newHarness(t, nil)
	u := h.demoUser(roleClient, true, roleClient)
	_, err := h.startDemo(&identityv1.StartDemoSessionRequest{UserId: u.GetId(), AsRole: roleExecutor})
	h.wantRefusal(err, connect.CodePermissionDenied, "role_not_granted")
	if n := h.count(`SELECT count(*) FROM sessions WHERE user_id = $1`, u.GetId()); n != 0 {
		t.Fatalf("сессий: %d", n)
	}
}

func TestStartDemoSessionNonDemoUnavailable(t *testing.T) {
	h := newHarness(t, nil)
	u := h.demoUser(roleClient, false, roleClient)
	_, err := h.startDemo(&identityv1.StartDemoSessionRequest{UserId: u.GetId()})
	h.wantRefusal(err, connect.CodeNotFound, "user_not_found")
	// Неизвестный и кривой id — тот же отказ: эндпоинт не выдаёт, кто есть.
	_, err = h.startDemo(&identityv1.StartDemoSessionRequest{UserId: unknownUserID})
	h.wantRefusal(err, connect.CodeNotFound, "user_not_found")
	_, err = h.startDemo(&identityv1.StartDemoSessionRequest{UserId: "not-a-uuid"})
	h.wantRefusal(err, connect.CodeNotFound, "user_not_found")
}

func TestStartDemoSessionBlockedUnavailable(t *testing.T) {
	h := newHarness(t, nil)
	u := h.demoUser(roleClient, true, roleClient)
	if _, err := h.pool.Exec(context.Background(), `UPDATE users SET blocked_at = now() WHERE id = $1`, u.GetId()); err != nil {
		t.Fatal(err)
	}
	_, err := h.startDemo(&identityv1.StartDemoSessionRequest{UserId: u.GetId()})
	h.wantRefusal(err, connect.CodeNotFound, "user_not_found")
}

func TestDemoDisabled(t *testing.T) {
	h := newHarness(t, func(c *ServeConfig) { c.DemoMode = false })
	_, err := h.startDemo(&identityv1.StartDemoSessionRequest{UserId: unknownUserID})
	h.wantRefusal(err, connect.CodeFailedPrecondition, "demo_disabled")
	_, err = h.seed(seedUser(newPhone(), roleClient, true, roleClient))
	h.wantRefusal(err, connect.CodeFailedPrecondition, "demo_disabled")
	h.wantRefusal(h.resetDemo("k1"), connect.CodeFailedPrecondition, "demo_disabled")
}

func TestDemoRequiresWebCaller(t *testing.T) {
	h := newHarness(t, nil)
	if err := h.resetDemoAs("operator", "k1"); err == nil {
		t.Fatal("ожидался отказ чужому вызывающему")
	}
}

func TestStartDemoSessionTokenReuse(t *testing.T) {
	h := newHarness(t, nil)
	u := h.demoUser(roleClient, true, roleClient)
	token := newToken(t)
	if _, err := h.startDemo(&identityv1.StartDemoSessionRequest{UserId: u.GetId(), SessionToken: token}); err != nil {
		t.Fatal(err)
	}
	_, err := h.startDemo(&identityv1.StartDemoSessionRequest{UserId: u.GetId(), SessionToken: token})
	h.wantRefusal(err, connect.CodeInvalidArgument, "session_token_invalid")
	_, err = h.startDemo(&identityv1.StartDemoSessionRequest{UserId: u.GetId(), SessionToken: "short"})
	h.wantRefusal(err, connect.CodeInvalidArgument, "session_token_invalid")
}

func TestStartDemoSessionIdempotent(t *testing.T) {
	h := newHarness(t, nil)
	u := h.demoUser(roleClient, true, roleClient)
	req := &identityv1.StartDemoSessionRequest{UserId: u.GetId(), SessionToken: newToken(t), IdempotencyKey: h.key()}
	a, err := h.startDemo(req)
	if err != nil {
		t.Fatal(err)
	}
	b, err := h.startDemo(req)
	if err != nil || a.GetSession().GetId() != b.GetSession().GetId() {
		t.Fatalf("повтор: %v %v", b, err)
	}
	if n := h.count(`SELECT count(*) FROM sessions WHERE user_id = $1`, u.GetId()); n != 1 {
		t.Fatalf("сессий: %d", n)
	}
}

func TestSeedUsersIdempotentByPhone(t *testing.T) {
	h := newHarness(t, nil)
	phone := newPhone()
	created := timestamppb.New(time.Now().Add(-48 * time.Hour).UTC().Truncate(time.Second))
	first, err := h.seed(&identityv1.SeedUser{Phone: phone, DefaultRole: roleClient, Roles: []identityv1.Role{roleClient}, IsDemo: true, CreatedAt: created})
	if err != nil {
		t.Fatal(err)
	}
	// Второй запуск меняет роли и снимает блокировку; id тот же, created_at без значения не трогается.
	if _, err := h.pool.Exec(context.Background(), `UPDATE users SET blocked_at = now() WHERE phone = $1`, phone); err != nil {
		t.Fatal(err)
	}
	second, err := h.seed(seedUser(phone, roleExecutor, true, roleClient, roleExecutor))
	if err != nil {
		t.Fatal(err)
	}
	a, b := first.GetUsers()[0], second.GetUsers()[0]
	if a.GetId() != b.GetId() || a.GetPhone() != phone {
		t.Fatalf("id нестабилен: %v %v", a, b)
	}
	if b.GetDefaultRole() != roleExecutor || len(b.GetRoles()) != 2 || b.GetBlockedAt() != nil {
		t.Fatalf("не обновлён: %v", b)
	}
	if !b.GetCreatedAt().AsTime().Equal(created.AsTime()) {
		t.Fatalf("created_at: %v want %v", b.GetCreatedAt().AsTime(), created.AsTime())
	}
}

func TestSeedUsersKeepsRequestOrder(t *testing.T) {
	h := newHarness(t, nil)
	p1, p2, p3 := newPhone(), newPhone(), newPhone()
	res, err := h.seed(
		seedUser(p3, roleClient, true, roleClient),
		seedUser(p1, roleOperator, true, roleOperator),
		seedUser(p2, roleExecutor, true, roleExecutor),
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
	_, err := h.seed(seedUser(phone, roleOperator, true, roleOperator, roleClient))
	h.wantRefusal(err, connect.CodeInvalidArgument, "invalid_request")
	if n := h.count(`SELECT count(*) FROM users WHERE phone = $1`, phone); n != 0 {
		t.Fatalf("пользователь создан: %d", n)
	}
}

func TestSeedUsersValidation(t *testing.T) {
	h := newHarness(t, nil)
	ph := newPhone()
	tooMany := make([]*identityv1.SeedUser, 201)
	for i := range tooMany {
		tooMany[i] = seedUser(newPhone(), roleClient, true, roleClient)
	}
	cases := []struct {
		name   string
		users  []*identityv1.SeedUser
		reason string
	}{
		{"телефон", []*identityv1.SeedUser{seedUser("123", roleClient, true, roleClient)}, "invalid_phone"},
		{"пустые роли", []*identityv1.SeedUser{seedUser(ph, roleClient, true)}, "invalid_request"},
		{"неизвестная роль", []*identityv1.SeedUser{seedUser(ph, roleClient, true, identityv1.Role_ROLE_UNSPECIFIED)}, "invalid_request"},
		{"роль по умолчанию не выдана", []*identityv1.SeedUser{seedUser(ph, roleExecutor, true, roleClient)}, "invalid_request"},
		{"повтор телефона", []*identityv1.SeedUser{seedUser(ph, roleClient, true, roleClient), seedUser(ph, roleClient, true, roleClient)}, "invalid_request"},
		{"слишком много", tooMany, "invalid_request"},
		{"пустой список", nil, "invalid_request"},
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

func TestResetDemoClearsLimits(t *testing.T) {
	h := newHarness(t, nil)
	phone := h.registered(newPhone())
	h.mustRequest(phone, "")
	// Повторный запрос упирается в паузу между кодами.
	_, err := h.request(phone, "")
	h.wantRefusal(err, connect.CodeResourceExhausted, "otp_too_often")
	if n := h.count(`SELECT count(*) FROM otp_codes WHERE phone = $1`, phone); n != 1 {
		t.Fatalf("кодов до сброса: %d", n)
	}

	u := h.demoUser(roleClient, true, roleClient)
	if _, err := h.startDemo(&identityv1.StartDemoSessionRequest{UserId: u.GetId()}); err != nil {
		t.Fatal(err)
	}
	// Второй фактор оператора стенда: подтверждённый и начатый (Ruling E — повторный прогон
	// e2e подключает TOTP заново).
	enrolledOp, opToken := h.operator()
	h.enrolled(opToken)
	pendingOp, pendingToken := h.operator()
	h.mustStart(pendingToken)
	// База общая для тестов пакета (и для -count=2): считаются факторы этих двух операторов.
	if n := h.count(`SELECT count(*) FROM mfa_factors WHERE user_id = ANY($1)`, []string{enrolledOp.ID.String(), pendingOp.ID.String()}); n != 2 {
		t.Fatalf("факторов до сброса: %d", n)
	}
	usersBefore := h.count(`SELECT count(*) FROM users`)

	if err := h.resetDemo(h.key()); err != nil {
		t.Fatal(err)
	}
	for _, table := range []string{"sessions", "otp_codes", "rate_limits", "mfa_factors"} {
		if n := h.count(`SELECT count(*) FROM ` + table); n != 0 {
			t.Fatalf("%s: %d строк после сброса", table, n)
		}
	}
	if n := h.count(`SELECT count(*) FROM users`); n != usersBefore {
		t.Fatalf("пользователей было %d, стало %d", usersBefore, n)
	}
	h.mustRequest(phone, "") // пауза сброшена вместе с лимитами
}

func TestResetDemoIsIdempotentAndDropsStaleReplays(t *testing.T) {
	h := newHarness(t, nil)
	u := h.demoUser(roleClient, true, roleClient)
	req := &identityv1.StartDemoSessionRequest{UserId: u.GetId(), SessionToken: newToken(t), IdempotencyKey: h.key()}
	if _, err := h.startDemo(req); err != nil {
		t.Fatal(err)
	}
	key := h.key()
	if err := h.resetDemo(key); err != nil {
		t.Fatal(err)
	}
	if err := h.resetDemo(key); err != nil { // повтор — тот же успех
		t.Fatalf("повтор ResetDemo: %v", err)
	}
	// Ответ старого входа не воспроизводится: сессии уже нет, ключ забыт, токен свободен.
	if _, err := h.startDemo(req); err != nil {
		t.Fatalf("вход после сброса: %v", err)
	}
	if n := h.count(`SELECT count(*) FROM sessions WHERE user_id = $1`, u.GetId()); n != 1 {
		t.Fatalf("сессий: %d", n)
	}
	if n := h.count(`SELECT count(*) FROM idempotency WHERE key = $1`, key); n != 1 {
		t.Fatalf("ключ сброса: %d", n)
	}
}
