package internal

import (
	"context"
	"slices"
	"strings"
	"time"

	"connectrpc.com/connect/v2"
	"github.com/jackc/pgx/v5"
	"google.golang.org/protobuf/proto"

	eventsv1 "github.com/CemeteryPlaya/senim-platform/gen/go/senim/events/v1"
	identityv1 "github.com/CemeteryPlaya/senim-platform/gen/go/senim/identity/v1"
	"github.com/CemeteryPlaya/senim-platform/gen/go/senim/identity/v1/identityv1connect"
	"github.com/CemeteryPlaya/senim-platform/pkg/outbox"
	"github.com/CemeteryPlaya/senim-platform/services/identity/internal/store"
)

const (
	subjectRoleSwitched = "senim.identity.role.switched"
	subjectRoleGranted  = "senim.identity.role.granted"
)

// activeRole — активная роль сессии: выбранная в сессии, если она всё ещё выдана, иначе
// роль по умолчанию. Отозванная роль не действует, даже если сессия её помнит (правило
// activeRoleOf из apps/web/src/modules/identity/roles.ts).
func activeRole(granted []string, defaultRole string, sessionRole *string) string {
	if sessionRole != nil && slices.Contains(granted, *sessionRole) {
		return *sessionRole
	}
	return defaultRole
}

// roleName переводит enum в имя роли базы («ROLE_CLIENT» → «CLIENT»); ok=false для
// ROLE_UNSPECIFIED и неизвестных значений.
func roleName(r identityv1.Role) (name string, ok bool) {
	if r == identityv1.Role_ROLE_UNSPECIFIED {
		return "", false
	}
	full, known := identityv1.Role_name[int32(r)]
	if !known {
		return "", false
	}
	return strings.TrimPrefix(full, "ROLE_"), true
}

// lockedSession находит сессию по токену и берёт блокировку строки пользователя, затем
// перечитывает сессию под блокировкой: параллельные переключения и выдачи ролей
// выстраиваются в очередь, а выход, случившийся раньше, виден. Недействительная сессия
// или заблокированный пользователь — session_invalid.
func lockedSession(ctx context.Context, tx pgx.Tx, token string, now time.Time) (store.Session, store.User, error) {
	q := store.New(tx)
	sess, ok, err := sessionByToken(ctx, q, token, false)
	if err != nil {
		return sess, store.User{}, err
	}
	if !ok {
		return sess, store.User{}, sessionInvalid()
	}
	user, err := q.LockUser(ctx, sess.UserID)
	if err != nil {
		return sess, user, err
	}
	sess, ok, err = sessionByToken(ctx, q, token, true)
	if err != nil {
		return sess, user, err
	}
	if !ok || !sessionUsable(sess, user, now) {
		return sess, user, sessionInvalid()
	}
	return sess, user, nil
}

// recordRoleEvent пишет в outbox событие о роли и событие аудита в той же транзакции.
// actorRole — активная роль пользователя до действия; before == nil — полей «до» нет.
func recordRoleEvent(ctx context.Context, tx pgx.Tx, subject, eventType string, payload proto.Message, user store.User, actorRole, action string, before, after map[string]string, now time.Time) error {
	if _, err := outbox.Add(ctx, tx, ServiceID, subject, eventType, payload); err != nil {
		return err
	}
	// nil-карта в any — не nil: «до» без полей передаётся явным nil.
	var b any
	if before != nil {
		b = before
	}
	return recordAudit(ctx, tx, user, actorRole, action, b, after, now)
}

// SwitchRole делает выданную роль активной в этой сессии и ролью по умолчанию (новый вход
// начнётся в ней). Другие сессии пользователя не меняются. Та же роль — без изменений и
// без события.
func (s *Service) SwitchRole(ctx context.Context, req *identityv1.SwitchRoleRequest) (*identityv1.SwitchRoleResponse, error) {
	if err := requireCaller(ctx, webCaller); err != nil {
		return nil, err
	}
	target, ok := roleName(req.GetRole())
	if !ok || !validIdempotencyKey(req.GetIdempotencyKey()) {
		return nil, rpcError(connect.CodeInvalidArgument, "invalid_request", nil)
	}
	resp := &identityv1.SwitchRoleResponse{}
	err := s.idempotent(ctx, "switch_role", identityv1connect.IdentityServiceSwitchRoleProcedure, req.GetIdempotencyKey(), req, resp, func(tx pgx.Tx) error {
		now := s.now()
		sess, user, err := lockedSession(ctx, tx, req.GetSessionToken(), now)
		if err != nil {
			return err
		}
		if !slices.Contains(user.Roles, target) {
			return rpcError(connect.CodePermissionDenied, "role_not_granted", nil)
		}
		current := activeRole(user.Roles, user.DefaultRole, &sess.ActiveRole)
		if current != target {
			q := store.New(tx)
			if sess, err = q.SetSessionActiveRole(ctx, store.SetSessionActiveRoleParams{ID: sess.ID, ActiveRole: target}); err != nil {
				return err
			}
			if user, err = q.SetUserDefaultRole(ctx, store.SetUserDefaultRoleParams{ID: user.ID, DefaultRole: target, UpdatedAt: ts(now)}); err != nil {
				return err
			}
			err = recordRoleEvent(ctx, tx, subjectRoleSwitched, "senim.events.v1.RoleSwitched",
				&eventsv1.RoleSwitched{UserId: user.ID.String(), From: roleProto(current), To: roleProto(target)},
				user, current, "user.role_switched", map[string]string{"role": current}, map[string]string{"role": target}, now)
			if err != nil {
				return err
			}
		}
		resp.User = userProto(user)
		resp.Session = sessionView(sess, user)
		return nil
	})
	if err != nil {
		return nil, err
	}
	return resp, nil
}

// GrantRole выдаёт себе роль CLIENT или EXECUTOR. Сотрудник (оператор, замерщик) не
// совмещает роли, а роли сотрудников не выдаются никому. Уже выданная роль — granted=false
// без события. Роль по умолчанию и активная роль не меняются.
func (s *Service) GrantRole(ctx context.Context, req *identityv1.GrantRoleRequest) (*identityv1.GrantRoleResponse, error) {
	if err := requireCaller(ctx, webCaller); err != nil {
		return nil, err
	}
	target, ok := roleName(req.GetRole())
	if !ok || !validIdempotencyKey(req.GetIdempotencyKey()) {
		return nil, rpcError(connect.CodeInvalidArgument, "invalid_request", nil)
	}
	resp := &identityv1.GrantRoleResponse{}
	err := s.idempotent(ctx, "grant_role", identityv1connect.IdentityServiceGrantRoleProcedure, req.GetIdempotencyKey(), req, resp, func(tx pgx.Tx) error {
		now := s.now()
		sess, user, err := lockedSession(ctx, tx, req.GetSessionToken(), now)
		if err != nil {
			return err
		}
		if (target != "CLIENT" && target != "EXECUTOR") || isStaff(user.Roles) {
			return rpcError(connect.CodePermissionDenied, "role_forbidden", nil)
		}
		if slices.Contains(user.Roles, target) {
			resp.User = userProto(user)
			return nil
		}
		current := activeRole(user.Roles, user.DefaultRole, &sess.ActiveRole)
		if user, err = store.New(tx).AddUserRole(ctx, store.AddUserRoleParams{ID: user.ID, Role: target, Now: ts(now)}); err != nil {
			return err
		}
		err = recordRoleEvent(ctx, tx, subjectRoleGranted, "senim.events.v1.RoleGranted",
			&eventsv1.RoleGranted{UserId: user.ID.String(), Role: roleProto(target)},
			user, current, "user.role_granted", nil, map[string]string{"role": target}, now)
		if err != nil {
			return err
		}
		resp.User = userProto(user)
		resp.Granted = true
		return nil
	})
	if err != nil {
		return nil, err
	}
	return resp, nil
}
