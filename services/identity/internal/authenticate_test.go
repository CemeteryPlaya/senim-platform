package internal

import (
	"context"
	"crypto/sha256"
	"fmt"
	"strings"
	"testing"
	"time"

	"connectrpc.com/connect/v2"
	"github.com/jackc/pgx/v5"
	"google.golang.org/protobuf/proto"

	eventsv1 "github.com/CemeteryPlaya/senim-platform/gen/go/senim/events/v1"
	identityv1 "github.com/CemeteryPlaya/senim-platform/gen/go/senim/identity/v1"
	"github.com/CemeteryPlaya/senim-platform/gen/go/senim/identity/v1/identityv1connect"
	"github.com/CemeteryPlaya/senim-platform/pkg/dbx"
	"github.com/CemeteryPlaya/senim-platform/services/identity/internal/store"
)

// idc вызывает метод IdentityService от имени caller (XFCC, как ставит Envoy). Пустое
// имя — без XFCC.
func idc[Resp any](h *harness, caller string, call func(ctx context.Context, c identityv1connect.IdentityServiceClient) (*Resp, error)) (*Resp, error) {
	h.t.Helper()
	ctx, cancel := context.WithTimeout(context.Background(), 20*time.Second)
	defer cancel()
	ctx, info := connect.NewClientContext(ctx)
	if caller != "" {
		info.RequestHeader().Add("x-forwarded-client-cert", "Hash=4d5f6a;DNS="+caller+";DNS=localhost")
	}
	return call(ctx, identityv1connect.NewIdentityServiceClient(h.rpc))
}

func (h *harness) key() string {
	return fmt.Sprintf("k-%d-%d", time.Now().UnixNano(), h.keySeq.Add(1))
}

func (h *harness) authenticate(token string) (*identityv1.AuthenticateResponse, error) {
	h.t.Helper()
	return idc(h, "web", func(ctx context.Context, c identityv1connect.IdentityServiceClient) (*identityv1.AuthenticateResponse, error) {
		return c.Authenticate(ctx, &identityv1.AuthenticateRequest{SessionToken: token})
	})
}

func (h *harness) mustAuth(token string) *identityv1.AuthenticateResponse {
	h.t.Helper()
	res, err := h.authenticate(token)
	if err != nil {
		h.t.Fatalf("Authenticate: %v", err)
	}
	return res
}

func (h *harness) signOut(token, key string) (*identityv1.SignOutResponse, error) {
	h.t.Helper()
	return idc(h, "web", func(ctx context.Context, c identityv1connect.IdentityServiceClient) (*identityv1.SignOutResponse, error) {
		return c.SignOut(ctx, &identityv1.SignOutRequest{SessionToken: token, IdempotencyKey: key})
	})
}

func (h *harness) signOutEverywhere(token, key string) (*identityv1.SignOutEverywhereResponse, error) {
	h.t.Helper()
	return idc(h, "web", func(ctx context.Context, c identityv1connect.IdentityServiceClient) (*identityv1.SignOutEverywhereResponse, error) {
		return c.SignOutEverywhere(ctx, &identityv1.SignOutEverywhereRequest{SessionToken: token, IdempotencyKey: key})
	})
}

func (h *harness) switchRole(token string, role identityv1.Role, key string) (*identityv1.SwitchRoleResponse, error) {
	h.t.Helper()
	return idc(h, "web", func(ctx context.Context, c identityv1connect.IdentityServiceClient) (*identityv1.SwitchRoleResponse, error) {
		return c.SwitchRole(ctx, &identityv1.SwitchRoleRequest{SessionToken: token, Role: role, IdempotencyKey: key})
	})
}

func (h *harness) grantRole(token string, role identityv1.Role, key string) (*identityv1.GrantRoleResponse, error) {
	h.t.Helper()
	return idc(h, "web", func(ctx context.Context, c identityv1connect.IdentityServiceClient) (*identityv1.GrantRoleResponse, error) {
		return c.GrantRole(ctx, &identityv1.GrantRoleRequest{SessionToken: token, Role: role, IdempotencyKey: key})
	})
}

// user создаёт пользователя с ролями roles и ролью по умолчанию def.
func (h *harness) user(roles []string, def string) store.User {
	h.t.Helper()
	u, err := createUser(h.q, roles, def)
	if err != nil {
		h.t.Fatal(err)
	}
	return u
}

// session открывает сессию пользователя в текущий момент часов (роль — по умолчанию).
func (h *harness) session(u store.User) string {
	h.t.Helper()
	token := newToken(h.t)
	err := dbx.InTx(context.Background(), h.pool, func(tx pgx.Tx) error {
		_, err := createSession(context.Background(), tx, u, token, "test", "", sessionOpenedByOtp, h.clock.now())
		return err
	})
	if err != nil {
		h.t.Fatal(err)
	}
	return token
}

func (h *harness) sessionRow(token string) store.Session {
	h.t.Helper()
	sum := sha256.Sum256([]byte(token))
	s, err := h.q.GetSessionByTokenHash(context.Background(), sum[:])
	if err != nil {
		h.t.Fatal(err)
	}
	return s
}

func (h *harness) setLastSeen(token string, at time.Time) {
	h.t.Helper()
	sum := sha256.Sum256([]byte(token))
	if _, err := h.pool.Exec(context.Background(), `UPDATE sessions SET last_seen_at = $2 WHERE token_hash = $1`, sum[:], at); err != nil {
		h.t.Fatal(err)
	}
}

// outboxEvents читает из outbox события subject и разбирает payload.
func outboxEvents[T proto.Message](h *harness, subject string, fresh func() T) []T {
	h.t.Helper()
	rows, err := h.pool.Query(context.Background(), `SELECT envelope FROM outbox WHERE subject = $1 ORDER BY created_at, id`, subject)
	if err != nil {
		h.t.Fatal(err)
	}
	defer rows.Close()
	var out []T
	for rows.Next() {
		var raw []byte
		if err := rows.Scan(&raw); err != nil {
			h.t.Fatal(err)
		}
		env := &eventsv1.Envelope{}
		if err := proto.Unmarshal(raw, env); err != nil {
			h.t.Fatal(err)
		}
		msg := fresh()
		if err := proto.Unmarshal(env.GetPayload(), msg); err != nil {
			h.t.Fatal(err)
		}
		out = append(out, msg)
	}
	if err := rows.Err(); err != nil {
		h.t.Fatal(err)
	}
	return out
}

// auditOf — события аудита про пользователя с действием action.
func (h *harness) auditOf(userID, action string) []*eventsv1.AuditEvent {
	h.t.Helper()
	var out []*eventsv1.AuditEvent
	for _, e := range outboxEvents(h, subjectAudit, func() *eventsv1.AuditEvent { return &eventsv1.AuditEvent{} }) {
		if e.GetEntityId() == userID && e.GetAction() == action {
			out = append(out, e)
		}
	}
	return out
}

func (h *harness) wantInvalid(token string) {
	h.t.Helper()
	_, err := h.authenticate(token)
	h.wantRefusal(err, connect.CodeUnauthenticated, "session_invalid")
}

// --- Authenticate ---

func TestAuthenticateCallerMustBeWeb(t *testing.T) {
	h := newHarness(t, nil)
	token := h.session(h.user([]string{"CLIENT"}, "CLIENT"))
	for _, caller := range []string{"", "deal", "identity"} {
		_, err := idc(h, caller, func(ctx context.Context, c identityv1connect.IdentityServiceClient) (*identityv1.AuthenticateResponse, error) {
			return c.Authenticate(ctx, &identityv1.AuthenticateRequest{SessionToken: token})
		})
		h.wantRefusal(err, connect.CodePermissionDenied, "caller_forbidden")
	}
}

// Без сессии пользователя нет; с токеном входа есть.
func TestAuthenticateReturnsUserAndSession(t *testing.T) {
	h := newHarness(t, nil)
	u := h.user([]string{"CLIENT"}, "CLIENT")

	h.wantInvalid("")
	h.wantInvalid("не-токен")
	h.wantInvalid(newToken(t)) // верный формат, но такой сессии нет

	token := h.session(u)
	res := h.mustAuth(token)
	if res.GetUser().GetId() != u.ID.String() || res.GetUser().GetDefaultRole() != identityv1.Role_ROLE_CLIENT {
		t.Fatalf("user = %v", res.GetUser())
	}
	if res.GetSession().GetActiveRole() != identityv1.Role_ROLE_CLIENT {
		t.Fatalf("active_role = %v", res.GetSession().GetActiveRole())
	}
	if !res.GetSession().GetIdleExpiresAt().AsTime().Equal(h.clock.now().Add(idleTimeout)) {
		t.Fatalf("idle_expires_at = %v", res.GetSession().GetIdleExpiresAt().AsTime())
	}
	if res.GetAccessToken() == "" || res.GetAccessExpiresAt() == nil {
		t.Fatalf("внутренний токен не выдан: %q %v", res.GetAccessToken(), res.GetAccessExpiresAt())
	}
}

func TestAuthenticateBlockedUserLosesAccessAtOnce(t *testing.T) {
	h := newHarness(t, nil)
	u := h.user([]string{"CLIENT"}, "CLIENT")
	token := h.session(u)
	h.mustAuth(token)
	if _, err := h.pool.Exec(context.Background(), `UPDATE users SET blocked_at = $2 WHERE id = $1`, u.ID, h.clock.now()); err != nil {
		t.Fatal(err)
	}
	h.wantInvalid(token)
}

// last_seen_at обновляется не чаще раза в минуту.
func TestAuthenticateLastSeenThrottle(t *testing.T) {
	h := newHarness(t, nil)
	token := h.session(h.user([]string{"CLIENT"}, "CLIENT"))

	recent := h.clock.now().Add(-30 * time.Second)
	h.setLastSeen(token, recent)
	res := h.mustAuth(token)
	if got := h.sessionRow(token).LastSeenAt.Time; !got.Equal(recent) {
		t.Fatalf("last_seen_at = %v, want прежний %v", got, recent)
	}
	if !res.GetSession().GetIdleExpiresAt().AsTime().Equal(recent.Add(idleTimeout)) {
		t.Fatalf("idle_expires_at = %v", res.GetSession().GetIdleExpiresAt().AsTime())
	}

	h.setLastSeen(token, h.clock.now().Add(-2*time.Minute))
	res = h.mustAuth(token)
	if got := h.sessionRow(token).LastSeenAt.Time; !got.Equal(h.clock.now()) {
		t.Fatalf("last_seen_at = %v, want %v", got, h.clock.now())
	}
	if !res.GetSession().GetIdleExpiresAt().AsTime().Equal(h.clock.now().Add(idleTimeout)) {
		t.Fatalf("idle_expires_at = %v", res.GetSession().GetIdleExpiresAt().AsTime())
	}
}

// Review Focus 2: граница простоя ровно 30 минут.
func TestIdleBoundary(t *testing.T) {
	h := newHarness(t, nil)
	token := h.session(h.user([]string{"CLIENT"}, "CLIENT"))
	h.setLastSeen(token, h.clock.now().Add(-29*time.Minute-59*time.Second))
	h.mustAuth(token)

	token2 := h.session(h.user([]string{"CLIENT"}, "CLIENT"))
	h.setLastSeen(token2, h.clock.now().Add(-idleTimeout))
	h.wantInvalid(token2)
	// Просроченная по простою сессия не оживает от повтора.
	h.wantInvalid(token2)
	if got := h.sessionRow(token2).LastSeenAt.Time; !got.Equal(h.clock.now().Add(-idleTimeout)) {
		t.Fatalf("last_seen_at просроченной сессии изменился: %v", got)
	}
}

// Абсолютный срок: 7 суток у пользователя, 8 часов у сотрудника (простоя нет: сессия активна).
func TestAbsoluteExpiry7dAnd8h(t *testing.T) {
	cases := []struct {
		name  string
		roles []string
		def   string
		ttl   time.Duration
	}{
		{"client 7d", []string{"CLIENT"}, "CLIENT", 7 * 24 * time.Hour},
		{"operator 8h", []string{"OPERATOR"}, "OPERATOR", 8 * time.Hour},
		{"measurer 8h", []string{"MEASURER"}, "MEASURER", 8 * time.Hour},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			h := newHarness(t, nil)
			opened := h.clock.now()
			token := h.session(h.user(tc.roles, tc.def))
			if got := h.sessionRow(token).ExpiresAt.Time; !got.Equal(opened.Add(tc.ttl)) {
				t.Fatalf("expires_at = %v, want %v", got, opened.Add(tc.ttl))
			}
			// За секунду до срока сессия действует (человек был на связи минуту назад).
			h.clock.advance(tc.ttl - time.Second)
			h.setLastSeen(token, h.clock.now().Add(-time.Minute))
			res := h.mustAuth(token)
			if !res.GetSession().GetExpiresAt().AsTime().Equal(opened.Add(tc.ttl)) {
				t.Fatalf("expires_at в ответе = %v", res.GetSession().GetExpiresAt().AsTime())
			}
			// Ровно в срок нет, хотя простоя нет.
			h.clock.advance(time.Second)
			h.setLastSeen(token, h.clock.now().Add(-time.Minute))
			h.wantInvalid(token)
		})
	}
}

// --- SignOut ---

func TestSignOutRevokesThisSessionOnly(t *testing.T) {
	h := newHarness(t, nil)
	u := h.user([]string{"CLIENT"}, "CLIENT")
	here, other := h.session(u), h.session(u)

	if _, err := h.signOut(here, h.key()); err != nil {
		t.Fatal(err)
	}
	h.wantInvalid(here)
	h.mustAuth(other)

	// Выход идемпотентен: повтор, неизвестный и кривой токен дают успех без изменений.
	for _, tok := range []string{here, newToken(t), "мусор", ""} {
		if _, err := h.signOut(tok, h.key()); err != nil {
			t.Fatalf("SignOut(%q): %v", tok, err)
		}
	}
	h.mustAuth(other)
}

func TestSignOutValidatesKeyAndCaller(t *testing.T) {
	h := newHarness(t, nil)
	token := h.session(h.user([]string{"CLIENT"}, "CLIENT"))
	for _, k := range []string{"", strings.Repeat("k", 129)} {
		_, err := h.signOut(token, k)
		h.wantRefusal(err, connect.CodeInvalidArgument, "invalid_request")
	}
	_, err := idc(h, "deal", func(ctx context.Context, c identityv1connect.IdentityServiceClient) (*identityv1.SignOutResponse, error) {
		return c.SignOut(ctx, &identityv1.SignOutRequest{SessionToken: token, IdempotencyKey: h.key()})
	})
	h.wantRefusal(err, connect.CodePermissionDenied, "caller_forbidden")
	h.mustAuth(token)
}

// Тот же ключ и тот же запрос дают тот же ответ; тот же ключ с другим токеном — idempotency_key_reused.
func TestSignOutIdempotencyKey(t *testing.T) {
	h := newHarness(t, nil)
	u := h.user([]string{"CLIENT"}, "CLIENT")
	a, b := h.session(u), h.session(u)
	key := h.key()
	if _, err := h.signOut(a, key); err != nil {
		t.Fatal(err)
	}
	if _, err := h.signOut(a, key); err != nil {
		t.Fatalf("повтор: %v", err)
	}
	_, err := h.signOut(b, key)
	h.wantRefusal(err, connect.CodeInvalidArgument, "idempotency_key_reused")
	h.mustAuth(b)
}

func TestSignOutEverywhereRevokesAllSessionsOfUser(t *testing.T) {
	h := newHarness(t, nil)
	u := h.user([]string{"CLIENT"}, "CLIENT")
	phone, laptop := h.session(u), h.session(u)
	stranger := h.session(h.user([]string{"CLIENT"}, "CLIENT"))

	if _, err := h.signOutEverywhere(laptop, h.key()); err != nil {
		t.Fatal(err)
	}
	h.wantInvalid(phone)
	h.wantInvalid(laptop)
	h.mustAuth(stranger)

	// Повтор и неизвестный токен дают успех без изменений.
	for _, tok := range []string{laptop, newToken(t), "мусор"} {
		if _, err := h.signOutEverywhere(tok, h.key()); err != nil {
			t.Fatalf("SignOutEverywhere(%q): %v", tok, err)
		}
	}
	h.mustAuth(stranger)
}
