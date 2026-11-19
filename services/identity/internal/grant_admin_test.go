package internal

import (
	"bytes"
	"context"
	"slices"
	"strings"
	"testing"

	identityv1 "github.com/CemeteryPlaya/senim-platform/gen/go/senim/identity/v1"
)

// grantAdminCmd запускает «identity grant-admin» с рабочей ролью базы теста.
func (h *harness) grantAdminCmd(args ...string) (int, string) {
	h.t.Helper()
	vars := map[string]string{"APP_ENV": "dev", "IDENTITY_APP_DSN": pgEnv.AppDSN("identity")}
	src := func(k string) (string, bool) { v, ok := vars[k]; return v, ok }
	var logs bytes.Buffer
	code := Main(context.Background(), append([]string{"grant-admin"}, args...), src, &logs)
	return code, logs.String()
}

// Новый номер — пользователь с единственной ролью ADMIN; событие RoleGranted и аудит от
// имени cli. Повтор — без изменений и без второго события. Телефона в логе нет.
func TestGrantAdminNewPhone(t *testing.T) {
	h := newHarness(t, nil)
	phone := newPhone()
	code, logs := h.grantAdminCmd("--phone", phone)
	if code != 0 {
		t.Fatalf("grant-admin: код %d\n%s", code, logs)
	}
	if strings.Contains(logs, phone) {
		t.Fatal("телефон в логе")
	}
	u, err := h.q.GetUserByPhone(context.Background(), phone)
	if err != nil {
		t.Fatal(err)
	}
	if !slices.Equal(u.Roles, []string{"ADMIN"}) || u.DefaultRole != "ADMIN" || u.Seeded || u.BlockedAt.Valid {
		t.Fatalf("пользователь: %+v", u)
	}
	if !strings.Contains(logs, u.ID.String()) {
		t.Fatalf("в логе нет user_id: %s", logs)
	}
	grants := h.grants(u.ID.String())
	if len(grants) != 1 || grants[0].GetRole() != identityv1.Role_ROLE_ADMIN {
		t.Fatalf("RoleGranted: %v", grants)
	}
	audit := h.auditOf(u.ID.String(), "user.role_granted")
	if len(audit) != 1 || audit[0].GetActorKind() != "cli" || audit[0].GetActorId() != "identity.grant-admin" ||
		audit[0].GetAfterJson() != `{"role":"ADMIN"}` || audit[0].GetBeforeJson() != "" {
		t.Fatalf("аудит: %v", audit)
	}

	// Повтор: уже администратор — без изменений, без второго события и аудита.
	if code, logs := h.grantAdminCmd("--phone", phone); code != 0 {
		t.Fatalf("повтор: код %d\n%s", code, logs)
	}
	again, err := h.q.GetUserByPhone(context.Background(), phone)
	if err != nil || again.ID != u.ID || !again.UpdatedAt.Time.Equal(u.UpdatedAt.Time) {
		t.Fatalf("повтор изменил пользователя: %+v %v", again, err)
	}
	if len(h.grants(u.ID.String())) != 1 || len(h.auditOf(u.ID.String(), "user.role_granted")) != 1 {
		t.Fatal("повтор оставил второе событие")
	}

	// Администратор входит как сотрудник: второй фактор обязателен.
	if s := h.mustAuth(h.session(u)).GetSession(); !s.GetMfaRequired() || s.GetActiveRole() != identityv1.Role_ROLE_ADMIN {
		t.Fatalf("сессия администратора: %v", s)
	}
}

// Номер с другими ролями — ошибка без изменений: администратор не совмещает роли.
func TestGrantAdminRefusesOtherRoles(t *testing.T) {
	h := newHarness(t, nil)
	for _, roles := range [][]string{{"CLIENT"}, {"CLIENT", "EXECUTOR"}, {"OPERATOR"}, {"MEASURER"}} {
		u := h.user(roles, roles[0])
		_, _, err := grantAdmin(context.Background(), h.pool, u.Phone, h.clock.now())
		if err == nil || !strings.Contains(err.Error(), "администратор не совмещает роли") || strings.Contains(err.Error(), u.Phone) {
			t.Fatalf("%v: ошибка %v", roles, err)
		}
		if code, _ := h.grantAdminCmd("--phone", u.Phone); code == 0 {
			t.Fatalf("%v: код 0", roles)
		}
		after, err := h.q.GetUserByID(context.Background(), u.ID)
		if err != nil || !slices.Equal(after.Roles, roles) || after.DefaultRole != roles[0] {
			t.Fatalf("%v: роли изменились: %+v %v", roles, after, err)
		}
		if len(h.grants(u.ID.String())) != 0 || len(h.auditOf(u.ID.String(), "user.role_granted")) != 0 {
			t.Fatalf("%v: событие при отказе", roles)
		}
	}
}

// Заблокированный пользователь — ошибка (и уже администратор): блокировку команда не снимает.
func TestGrantAdminRefusesBlocked(t *testing.T) {
	h := newHarness(t, nil)
	for _, roles := range [][]string{{"ADMIN"}, {"CLIENT"}} {
		u := h.user(roles, roles[0])
		h.block(u)
		_, _, err := grantAdmin(context.Background(), h.pool, u.Phone, h.clock.now())
		if err == nil || !strings.Contains(err.Error(), "заблокирован") || strings.Contains(err.Error(), u.Phone) {
			t.Fatalf("%v: ошибка %v", roles, err)
		}
		after, err := h.q.GetUserByID(context.Background(), u.ID)
		if err != nil || !slices.Equal(after.Roles, roles) || !after.BlockedAt.Valid {
			t.Fatalf("%v: пользователь изменился: %+v %v", roles, after, err)
		}
		if len(h.grants(u.ID.String())) != 0 {
			t.Fatalf("%v: событие при отказе", roles)
		}
	}
}

// Без номера, с кривым номером или лишними аргументами — ошибка до базы.
func TestGrantAdminArguments(t *testing.T) {
	h := newHarness(t, nil)
	for _, args := range [][]string{{}, {"--phone", "8700"}, {"--phone", newPhone(), "лишнее"}, {"--unknown"}} {
		if code, _ := h.grantAdminCmd(args...); code == 0 {
			t.Errorf("%v: код 0", args)
		}
	}
}
