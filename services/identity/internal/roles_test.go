package internal

import (
	"context"
	"fmt"
	"sync"
	"testing"
	"time"

	"connectrpc.com/connect/v2"

	eventsv1 "github.com/CemeteryPlaya/senim-platform/gen/go/senim/events/v1"
	identityv1 "github.com/CemeteryPlaya/senim-platform/gen/go/senim/identity/v1"
	"github.com/CemeteryPlaya/senim-platform/pkg/dbx"
	"github.com/CemeteryPlaya/senim-platform/services/identity/internal/store"
)

const (
	roleClient   = identityv1.Role_ROLE_CLIENT
	roleExecutor = identityv1.Role_ROLE_EXECUTOR
)

func TestActiveRoleRule(t *testing.T) {
	remembered := func(s string) *string { return &s }
	cases := []struct {
		name    string
		granted []string
		def     string
		session *string
		want    string
	}{
		{"выбранная выдана", []string{"EXECUTOR", "CLIENT"}, "EXECUTOR", remembered("CLIENT"), "CLIENT"},
		{"выбранной нет среди выданных", []string{"EXECUTOR"}, "EXECUTOR", remembered("CLIENT"), "EXECUTOR"},
		{"в сессии роли нет", []string{"EXECUTOR", "CLIENT"}, "EXECUTOR", nil, "EXECUTOR"},
	}
	for _, tc := range cases {
		if got := activeRole(tc.granted, tc.def, tc.session); got != tc.want {
			t.Errorf("%s: %q, want %q", tc.name, got, tc.want)
		}
	}
}

// dual — исполнитель, который заказывал и как заказчик: обе роли, по умолчанию исполнитель.
func (h *harness) dual() store.User { return h.user([]string{"EXECUTOR", "CLIENT"}, "EXECUTOR") }

func (h *harness) switches(userID string) []*eventsv1.RoleSwitched {
	h.t.Helper()
	var out []*eventsv1.RoleSwitched
	for _, e := range outboxEvents(h, "senim.identity.role.switched", func() *eventsv1.RoleSwitched { return &eventsv1.RoleSwitched{} }) {
		if e.GetUserId() == userID {
			out = append(out, e)
		}
	}
	return out
}

func (h *harness) grants(userID string) []*eventsv1.RoleGranted {
	h.t.Helper()
	var out []*eventsv1.RoleGranted
	for _, e := range outboxEvents(h, "senim.identity.role.granted", func() *eventsv1.RoleGranted { return &eventsv1.RoleGranted{} }) {
		if e.GetUserId() == userID {
			out = append(out, e)
		}
	}
	return out
}

func (h *harness) wantActive(token string, want identityv1.Role) {
	h.t.Helper()
	if got := h.mustAuth(token).GetSession().GetActiveRole(); got != want {
		h.t.Fatalf("активная роль %v, want %v", got, want)
	}
}

func TestSessionStartsInDefaultRole(t *testing.T) {
	h := newHarness(t, nil)
	token := h.session(h.dual())
	res := h.mustAuth(token)
	if res.GetSession().GetActiveRole() != roleExecutor {
		t.Fatalf("active_role = %v", res.GetSession().GetActiveRole())
	}
	if got := res.GetUser().GetRoles(); len(got) != 2 || got[0] != roleExecutor || got[1] != roleClient {
		t.Fatalf("roles = %v", got)
	}
}

// Review Focus 5: отозванная роль не действует, даже если сессия её помнит.
func TestRevokedRoleNotActive(t *testing.T) {
	h := newHarness(t, nil)
	u := h.dual()
	token := h.session(u)
	if _, err := h.switchRole(token, roleClient, h.key()); err != nil {
		t.Fatal(err)
	}
	h.wantActive(token, roleClient)

	// RPC отзыва роли нет: убираем её из выданных напрямую в базе.
	if _, err := h.pool.Exec(context.Background(), `UPDATE users SET roles = ARRAY['EXECUTOR'], default_role = 'EXECUTOR' WHERE id = $1`, u.ID); err != nil {
		t.Fatal(err)
	}
	res := h.mustAuth(token)
	if res.GetSession().GetActiveRole() != roleExecutor || len(res.GetUser().GetRoles()) != 1 {
		t.Fatalf("session %v, roles %v", res.GetSession().GetActiveRole(), res.GetUser().GetRoles())
	}
}

func TestSwitchRoleSwitchesSessionAndDefaultAndAudits(t *testing.T) {
	h := newHarness(t, nil)
	u := h.dual()
	token := h.session(u)

	res, err := h.switchRole(token, roleClient, h.key())
	if err != nil {
		t.Fatal(err)
	}
	if res.GetSession().GetActiveRole() != roleClient || res.GetUser().GetDefaultRole() != roleClient {
		t.Fatalf("ответ: session %v, default %v", res.GetSession().GetActiveRole(), res.GetUser().GetDefaultRole())
	}
	h.wantActive(token, roleClient)
	if got := h.mustAuth(token).GetUser().GetDefaultRole(); got != roleClient {
		t.Fatalf("default_role = %v", got)
	}

	ev := h.switches(u.ID.String())
	if len(ev) != 1 || ev[0].GetFrom() != roleExecutor || ev[0].GetTo() != roleClient {
		t.Fatalf("RoleSwitched = %v", ev)
	}
	audit := h.auditOf(u.ID.String(), "user.role_switched")
	if len(audit) != 1 {
		t.Fatalf("аудит: %d", len(audit))
	}
	a := audit[0]
	if a.GetActorKind() != "user" || a.GetActorId() != u.ID.String() || a.GetActorRole() != "EXECUTOR" ||
		a.GetEntityType() != "user" || a.GetBeforeJson() != `{"role":"EXECUTOR"}` || a.GetAfterJson() != `{"role":"CLIENT"}` {
		t.Fatalf("аудит = %v", a)
	}
}

func TestSwitchRoleNotGrantedIsForbidden(t *testing.T) {
	h := newHarness(t, nil)
	token := h.session(h.user([]string{"CLIENT"}, "CLIENT"))
	_, err := h.switchRole(token, roleExecutor, h.key())
	h.wantRefusal(err, connect.CodePermissionDenied, "role_not_granted")
	h.wantActive(token, roleClient)
}

func TestOperatorDoesNotSwitchToOtherRoles(t *testing.T) {
	h := newHarness(t, nil)
	token := h.session(h.user([]string{"OPERATOR"}, "OPERATOR"))
	_, err := h.switchRole(token, roleClient, h.key())
	h.wantRefusal(err, connect.CodePermissionDenied, "role_not_granted")
	h.wantActive(token, identityv1.Role_ROLE_OPERATOR)
}

func TestSwitchRoleWithoutSessionIsUnauthenticated(t *testing.T) {
	h := newHarness(t, nil)
	for _, tok := range []string{"", "мусор", newToken(t)} {
		_, err := h.switchRole(tok, roleClient, h.key())
		h.wantRefusal(err, connect.CodeUnauthenticated, "session_invalid")
	}
	// Отозванная и просроченная по простою сессия тоже.
	u := h.dual()
	revoked := h.session(u)
	if _, err := h.signOut(revoked, h.key()); err != nil {
		t.Fatal(err)
	}
	_, err := h.switchRole(revoked, roleClient, h.key())
	h.wantRefusal(err, connect.CodeUnauthenticated, "session_invalid")
	idle := h.session(u)
	h.setLastSeen(idle, h.clock.now().Add(-idleTimeout))
	_, err = h.switchRole(idle, roleClient, h.key())
	h.wantRefusal(err, connect.CodeUnauthenticated, "session_invalid")
	if len(h.switches(u.ID.String())) != 0 {
		t.Fatal("отказ оставил событие")
	}
}

func TestSwitchRoleArgumentValidation(t *testing.T) {
	h := newHarness(t, nil)
	token := h.session(h.dual())
	for _, r := range []identityv1.Role{identityv1.Role_ROLE_UNSPECIFIED, identityv1.Role(99)} {
		_, err := h.switchRole(token, r, h.key())
		h.wantRefusal(err, connect.CodeInvalidArgument, "invalid_request")
	}
	_, err := h.switchRole(token, roleClient, "")
	h.wantRefusal(err, connect.CodeInvalidArgument, "invalid_request")
}

// Двойной клик: одно переключение в журнале, роль та же.
func TestSwitchRoleRepeatedOneEvent(t *testing.T) {
	h := newHarness(t, nil)
	u := h.dual()
	token := h.session(u)
	for range 3 {
		if _, err := h.switchRole(token, roleClient, h.key()); err != nil {
			t.Fatal(err)
		}
	}
	if n := len(h.switches(u.ID.String())); n != 1 {
		t.Fatalf("событий %d, want 1", n)
	}
	// Повтор с тем же ключом даёт тот же ответ без второго эффекта.
	key := h.key()
	first, err := h.switchRole(token, roleExecutor, key)
	if err != nil {
		t.Fatal(err)
	}
	again, err := h.switchRole(token, roleExecutor, key)
	if err != nil {
		t.Fatal(err)
	}
	if first.GetSession().GetActiveRole() != roleExecutor || again.GetSession().GetActiveRole() != roleExecutor {
		t.Fatalf("повтор по ключу вернул другой ответ: %v / %v", first, again)
	}
	if n := len(h.switches(u.ID.String())); n != 2 {
		t.Fatalf("событий %d, want 2 (в CLIENT и обратно)", n)
	}
	_, err = h.switchRole(token, roleClient, key)
	h.wantRefusal(err, connect.CodeInvalidArgument, "idempotency_key_reused")
}

// Review Focus 5: переключение на другом устройстве не меняет роль этой сессии.
func TestSwitchOnOtherDeviceKeepsThisSession(t *testing.T) {
	h := newHarness(t, nil)
	u := h.dual()
	phone := h.session(u)
	laptop := h.session(u)

	if _, err := h.switchRole(laptop, roleClient, h.key()); err != nil {
		t.Fatal(err)
	}
	h.wantActive(phone, roleExecutor)
	h.wantActive(laptop, roleClient)
}

// Новый вход начинается в последней активной роли.
func TestNewSessionStartsInLastActiveRole(t *testing.T) {
	h := newHarness(t, nil)
	u := h.dual()
	if _, err := h.switchRole(h.session(u), roleClient, h.key()); err != nil {
		t.Fatal(err)
	}
	fresh, err := h.q.GetUserByID(context.Background(), u.ID)
	if err != nil {
		t.Fatal(err)
	}
	h.wantActive(h.session(fresh), roleClient)
}

// Два SwitchRole с разными ключами одновременно: одно событие RoleSwitched. Тест ждёт
// настоящего состояния «оба вызова стоят на блокировке строки пользователя».
func TestConcurrentSwitchOneEvent(t *testing.T) {
	h := newHarness(t, nil)
	u := h.dual()
	token := h.session(u)
	ctx := context.Background()

	// Свой пул: пул сервиса мал (2 соединения), блокирующий и опрашивающий запросы
	// не должны отбирать их у вызовов.
	probe, err := dbx.Connect(ctx, pgEnv.AppDSN("identity"), "identity-test-probe", 2)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(probe.Close)
	holder, err := probe.Begin(ctx)
	if err != nil {
		t.Fatal(err)
	}
	released := false
	release := func() {
		if !released {
			released = true
			_ = holder.Commit(ctx)
		}
	}
	defer release()
	if _, err := holder.Exec(ctx, `SELECT 1 FROM users WHERE id = $1 FOR UPDATE`, u.ID); err != nil {
		t.Fatal(err)
	}

	errs := make([]error, 2)
	var wg sync.WaitGroup
	for i := range errs {
		wg.Add(1)
		key := h.key()
		go func() {
			defer wg.Done()
			_, errs[i] = h.switchRole(token, roleClient, key)
		}()
	}
	deadline := time.Now().Add(15 * time.Second)
	for {
		var waiting int
		if err := probe.QueryRow(ctx, `SELECT count(*) FROM pg_stat_activity
			WHERE datname = current_database() AND wait_event_type = 'Lock' AND query ILIKE '%FOR UPDATE%'`).Scan(&waiting); err != nil {
			t.Fatal(err)
		}
		if waiting >= 2 {
			break
		}
		if time.Now().After(deadline) {
			release()
			wg.Wait()
			t.Fatalf("вызовы не встали на блокировку (ждут: %d)", waiting)
		}
		time.Sleep(10 * time.Millisecond)
	}
	release()
	wg.Wait()
	for i, err := range errs {
		if err != nil {
			t.Fatalf("вызов %d: %v", i, err)
		}
	}
	if n := len(h.switches(u.ID.String())); n != 1 {
		t.Fatalf("RoleSwitched: %d, want 1", n)
	}
	if n := len(h.auditOf(u.ID.String(), "user.role_switched")); n != 1 {
		t.Fatalf("аудит: %d, want 1", n)
	}
	h.wantActive(token, roleClient)
}

// --- GrantRole ---

func TestGrantRoleTwiceAddsNothing(t *testing.T) {
	h := newHarness(t, nil)
	u := h.user([]string{"CLIENT"}, "CLIENT")
	token := h.session(u)

	res, err := h.grantRole(token, roleExecutor, h.key())
	if err != nil {
		t.Fatal(err)
	}
	if !res.GetGranted() || len(res.GetUser().GetRoles()) != 2 || res.GetUser().GetRoles()[1] != roleExecutor {
		t.Fatalf("первая выдача: %v", res)
	}
	res, err = h.grantRole(token, roleExecutor, h.key())
	if err != nil {
		t.Fatal(err)
	}
	if res.GetGranted() || len(res.GetUser().GetRoles()) != 2 {
		t.Fatalf("вторая выдача: %v", res)
	}
	if n := len(h.grants(u.ID.String())); n != 1 {
		t.Fatalf("RoleGranted: %d", n)
	}
	audit := h.auditOf(u.ID.String(), "user.role_granted")
	if len(audit) != 1 || audit[0].GetActorId() != u.ID.String() || audit[0].GetAfterJson() != `{"role":"EXECUTOR"}` {
		t.Fatalf("аудит = %v", audit)
	}
	// Выдача не меняет ни роль по умолчанию, ни активную.
	h.wantActive(token, roleClient)
	if got := h.mustAuth(token).GetUser().GetDefaultRole(); got != roleClient {
		t.Fatalf("default_role = %v", got)
	}
}

func TestGrantRoleReplayByKeyAndReuse(t *testing.T) {
	h := newHarness(t, nil)
	u := h.user([]string{"CLIENT"}, "CLIENT")
	token := h.session(u)
	key := h.key()
	first, err := h.grantRole(token, roleExecutor, key)
	if err != nil {
		t.Fatal(err)
	}
	again, err := h.grantRole(token, roleExecutor, key)
	if err != nil {
		t.Fatal(err)
	}
	if !first.GetGranted() || !again.GetGranted() {
		t.Fatalf("повтор по ключу должен вернуть прежний ответ granted=true: %v %v", first, again)
	}
	if n := len(h.grants(u.ID.String())); n != 1 {
		t.Fatalf("RoleGranted: %d", n)
	}
	_, err = h.grantRole(token, roleClient, key)
	h.wantRefusal(err, connect.CodeInvalidArgument, "idempotency_key_reused")
}

func TestGrantRoleStaffForbidden(t *testing.T) {
	h := newHarness(t, nil)
	operator := h.user([]string{"OPERATOR"}, "OPERATOR")
	measurer := h.user([]string{"MEASURER"}, "MEASURER")
	for _, u := range []struct {
		name  string
		token string
		id    string
	}{{"оператор", h.session(operator), operator.ID.String()}, {"замерщик", h.session(measurer), measurer.ID.String()}} {
		// Сотруднику роли не выдаются.
		_, err := h.grantRole(u.token, roleClient, h.key())
		h.wantRefusal(err, connect.CodePermissionDenied, "role_forbidden")
		// Роль сотрудника не выдаётся никому, в том числе себе.
		_, err = h.grantRole(u.token, identityv1.Role_ROLE_OPERATOR, h.key())
		h.wantRefusal(err, connect.CodePermissionDenied, "role_forbidden")
		_, err = h.grantRole(u.token, identityv1.Role_ROLE_MEASURER, h.key())
		h.wantRefusal(err, connect.CodePermissionDenied, "role_forbidden")
		if len(h.grants(u.id)) != 0 {
			t.Fatalf("%s: отказ оставил событие", u.name)
		}
	}
	var roles []string
	if err := h.pool.QueryRow(context.Background(), `SELECT roles FROM users WHERE id = $1`, measurer.ID).Scan(&roles); err != nil {
		t.Fatal(err)
	}
	if fmt.Sprint(roles) != "[MEASURER]" {
		t.Fatalf("roles = %v", roles)
	}
	// Клиенту роль сотрудника тоже не выдаётся.
	client := h.session(h.user([]string{"CLIENT"}, "CLIENT"))
	_, err := h.grantRole(client, identityv1.Role_ROLE_OPERATOR, h.key())
	h.wantRefusal(err, connect.CodePermissionDenied, "role_forbidden")
}

func TestGrantRoleArgumentsAndSession(t *testing.T) {
	h := newHarness(t, nil)
	token := h.session(h.user([]string{"CLIENT"}, "CLIENT"))
	for _, r := range []identityv1.Role{identityv1.Role_ROLE_UNSPECIFIED, identityv1.Role(99)} {
		_, err := h.grantRole(token, r, h.key())
		h.wantRefusal(err, connect.CodeInvalidArgument, "invalid_request")
	}
	_, err := h.grantRole(token, roleExecutor, "")
	h.wantRefusal(err, connect.CodeInvalidArgument, "invalid_request")
	for _, tok := range []string{"", "мусор", newToken(t)} {
		_, err := h.grantRole(tok, roleExecutor, h.key())
		h.wantRefusal(err, connect.CodeUnauthenticated, "session_invalid")
	}
}

// --- Ограничения схемы и долг плана 2 ---

func TestUsersRejectDuplicateRoles(t *testing.T) {
	_, q := migratedDB(t)
	_, err := createUser(q, []string{"CLIENT", "CLIENT"}, "CLIENT")
	requireCheckViolation(t, err, "users_roles_distinct")
}

func TestSessionsRejectUnknownRole(t *testing.T) {
	pool, q := migratedDB(t)
	u, err := createUser(q, []string{"CLIENT"}, "CLIENT")
	if err != nil {
		t.Fatal(err)
	}
	_, err = pool.Exec(context.Background(), `INSERT INTO sessions (token_hash, user_id, active_role, expires_at, opened_by)
		VALUES ($1, $2, 'ADMIN', now() + interval '1 hour', 'otp')`, []byte(newToken(t)), u.ID)
	requireCheckViolation(t, err, "sessions_active_role_known")
}

func (h *harness) block(u store.User) {
	h.t.Helper()
	if _, err := h.pool.Exec(context.Background(), `UPDATE users SET blocked_at = now() WHERE id = $1`, u.ID); err != nil {
		h.t.Fatal(err)
	}
}

// Заблокированный пользователь теряет доступ сразу: сессия для него недействительна
// (user_blocked отдаёт только вход по OTP).
func TestSwitchRoleBlockedUser(t *testing.T) {
	h := newHarness(t, nil)
	u := h.dual()
	token := h.session(u)
	h.block(u)
	_, err := h.switchRole(token, roleClient, h.key())
	h.wantRefusal(err, connect.CodeUnauthenticated, "session_invalid")
	if len(h.switches(u.ID.String())) != 0 {
		t.Fatal("отказ оставил событие")
	}
}

func TestGrantRoleBlockedUser(t *testing.T) {
	h := newHarness(t, nil)
	u := h.user([]string{"CLIENT"}, "CLIENT")
	token := h.session(u)
	h.block(u)
	_, err := h.grantRole(token, roleExecutor, h.key())
	h.wantRefusal(err, connect.CodeUnauthenticated, "session_invalid")
	if len(h.grants(u.ID.String())) != 0 {
		t.Fatal("отказ оставил событие")
	}
}

func TestGrantRoleRevokedSession(t *testing.T) {
	h := newHarness(t, nil)
	u := h.user([]string{"CLIENT"}, "CLIENT")
	token := h.session(u)
	if _, err := h.signOut(token, h.key()); err != nil {
		t.Fatal(err)
	}
	_, err := h.grantRole(token, roleExecutor, h.key())
	h.wantRefusal(err, connect.CodeUnauthenticated, "session_invalid")
	if len(h.grants(u.ID.String())) != 0 {
		t.Fatal("отказ оставил событие")
	}
}

func TestGrantRoleIdleSession(t *testing.T) {
	h := newHarness(t, nil)
	u := h.user([]string{"CLIENT"}, "CLIENT")
	token := h.session(u)
	h.setLastSeen(token, h.clock.now().Add(-idleTimeout))
	_, err := h.grantRole(token, roleExecutor, h.key())
	h.wantRefusal(err, connect.CodeUnauthenticated, "session_invalid")
	if len(h.grants(u.ID.String())) != 0 {
		t.Fatal("отказ оставил событие")
	}
}
