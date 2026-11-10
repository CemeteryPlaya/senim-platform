package internal

import (
	"context"
	"crypto/sha256"
	"errors"
	"slices"

	"connectrpc.com/connect/v2"
	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgtype"

	identityv1 "github.com/CemeteryPlaya/senim-platform/gen/go/senim/identity/v1"
	"github.com/CemeteryPlaya/senim-platform/gen/go/senim/identity/v1/identityv1connect"
	"github.com/CemeteryPlaya/senim-platform/services/identity/internal/store"
)

// maxSeedUsers — предел числа пользователей в одном SeedUsers.
const maxSeedUsers = 200

func demoDisabled() error {
	return rpcError(connect.CodeFailedPrecondition, "demo_disabled", nil)
}

func userNotFound() error { return rpcError(connect.CodeNotFound, "user_not_found", nil) }

func invalidRequest() error { return rpcError(connect.CodeInvalidArgument, "invalid_request", nil) }

// demoGate — общее начало демо-методов: вызывающий — web, затем режим. Без DemoMode база
// не затрагивается.
func (s *Service) demoGate(ctx context.Context) error {
	if err := requireCaller(ctx, webCaller); err != nil {
		return err
	}
	if !s.cfg.DemoMode {
		return demoDisabled()
	}
	return nil
}

// seedRow — проверенная запись сида.
type seedRow struct {
	phone, defaultRole string
	roles              []string
	isDemo             bool
	createdAt          pgtype.Timestamptz
}

// validateSeed разбирает и проверяет пользователей запроса в Go: ограничения базы (роли
// известны, роль по умолчанию выдана, оператор и замерщик одни) остаются второй линией.
func validateSeed(users []*identityv1.SeedUser) ([]seedRow, error) {
	if len(users) == 0 || len(users) > maxSeedUsers {
		return nil, invalidRequest()
	}
	rows := make([]seedRow, 0, len(users))
	seen := make(map[string]struct{}, len(users))
	for _, u := range users {
		phone, ok := parsePhone(u.GetPhone())
		if !ok {
			return nil, rpcError(connect.CodeInvalidArgument, "invalid_phone", nil)
		}
		if _, dup := seen[phone]; dup {
			return nil, invalidRequest()
		}
		seen[phone] = struct{}{}

		var roles []string
		for _, r := range u.GetRoles() {
			name, ok := roleName(r)
			if !ok {
				return nil, invalidRequest()
			}
			if !slices.Contains(roles, name) {
				roles = append(roles, name)
			}
		}
		def, ok := roleName(u.GetDefaultRole())
		if !ok || !slices.Contains(roles, def) {
			return nil, invalidRequest()
		}
		if (slices.Contains(roles, "OPERATOR") || slices.Contains(roles, "MEASURER")) && len(roles) != 1 {
			return nil, invalidRequest()
		}
		row := seedRow{phone: phone, defaultRole: def, roles: roles, isDemo: u.GetIsDemo()}
		if u.GetCreatedAt() != nil {
			row.createdAt = ts(u.GetCreatedAt().AsTime())
		}
		rows = append(rows, row)
	}
	return rows, nil
}

// SeedUsers — upsert пользователей по телефону в одной транзакции: существующему
// обновляются роли, роль по умолчанию, is_demo, created_at (если задан), блокировка
// снимается; id остаётся прежним. Ответ — в порядке запроса.
//
// Ни аудита, ни событий: это данные демо-стенда (DemoMode), не рабочие учётные записи.
func (s *Service) SeedUsers(ctx context.Context, req *identityv1.SeedUsersRequest) (*identityv1.SeedUsersResponse, error) {
	if err := s.demoGate(ctx); err != nil {
		return nil, err
	}
	if !validIdempotencyKey(req.GetIdempotencyKey()) {
		return nil, invalidRequest()
	}
	rows, err := validateSeed(req.GetUsers())
	if err != nil {
		return nil, err
	}
	resp := &identityv1.SeedUsersResponse{}
	err = s.idempotent(ctx, "seed_users", identityv1connect.IdentityServiceSeedUsersProcedure, req.GetIdempotencyKey(), req, resp, func(tx pgx.Tx) error {
		q := store.New(tx)
		now := ts(s.now())
		for _, r := range rows {
			u, err := q.UpsertSeedUser(ctx, store.UpsertSeedUserParams{
				Phone: r.phone, Roles: r.roles, DefaultRole: r.defaultRole, IsDemo: r.isDemo,
				CreatedAt: r.createdAt, Now: now,
			})
			if err != nil {
				return err
			}
			resp.Users = append(resp.Users, userProto(u))
		}
		return nil
	})
	if err != nil {
		return nil, err
	}
	return resp, nil
}

// StartDemoSession начинает сессию демо-персоны. Нет пользователя, он не демо или
// заблокирован — один и тот же отказ user_not_found: метод не показывает, кто есть.
// Роль as_role должна быть выдана (createSession этого не проверяет).
func (s *Service) StartDemoSession(ctx context.Context, req *identityv1.StartDemoSessionRequest) (*identityv1.StartDemoSessionResponse, error) {
	if err := s.demoGate(ctx); err != nil {
		return nil, err
	}
	if !validSessionToken(req.GetSessionToken()) {
		return nil, rpcError(connect.CodeInvalidArgument, "session_token_invalid", nil)
	}
	if !validIdempotencyKey(req.GetIdempotencyKey()) {
		return nil, invalidRequest()
	}
	asRole := ""
	if req.GetAsRole() != identityv1.Role_ROLE_UNSPECIFIED {
		name, ok := roleName(req.GetAsRole())
		if !ok {
			return nil, invalidRequest()
		}
		asRole = name
	}
	userID, err := uuid.Parse(req.GetUserId())
	if err != nil {
		return nil, userNotFound()
	}

	resp := &identityv1.StartDemoSessionResponse{}
	err = s.idempotent(ctx, "start_demo_session", identityv1connect.IdentityServiceStartDemoSessionProcedure, req.GetIdempotencyKey(), req, resp, func(tx pgx.Tx) error {
		q := store.New(tx)
		user, err := q.GetUserByID(ctx, userID)
		if errors.Is(err, pgx.ErrNoRows) || (err == nil && (!user.IsDemo || user.BlockedAt.Valid)) {
			return userNotFound()
		}
		if err != nil {
			return err
		}
		if asRole != "" && !slices.Contains(user.Roles, asRole) {
			return rpcError(connect.CodePermissionDenied, "role_not_granted", nil)
		}
		// Токен уже у другой сессии (новый ключ, старый токен): как в VerifyOtp.
		sum := sha256.Sum256([]byte(req.GetSessionToken()))
		taken, err := q.SessionTokenExists(ctx, sum[:])
		if err != nil {
			return err
		}
		if taken {
			return rpcError(connect.CodeInvalidArgument, "session_token_invalid", nil)
		}
		now := s.now()
		sess, err := createSession(ctx, tx, user, req.GetSessionToken(), req.GetUserAgent(), asRole, now)
		if err != nil {
			return err
		}
		// Демо-оператор считается прошедшим вторую ступень: у демо-персон нет телефона с
		// приложением, а сценарии оператора идут сразу в кабинет (только DEMO_MODE).
		if sess.ActiveRole == mfaRole {
			if sess, err = q.SetSessionMfaVerified(ctx, store.SetSessionMfaVerifiedParams{At: ts(now), ID: sess.ID}); err != nil {
				return err
			}
		}
		resp.User = userProto(user)
		resp.Session = sessionProto(sess, idleTimeout)
		return nil
	})
	if err != nil {
		return nil, err
	}
	return resp, nil
}

// ResetDemo чистит одноразовое и временное состояние стенда: коды, счётчики лимитов,
// сессии, вторые факторы операторов (повторный прогон e2e подключает TOTP заново, а не
// упирается в mfa_already_enrolled) и сохранённые ответы идемпотентности (иначе повтор
// вернул бы вход с уже несуществующей сессией). Пользователи остаются. Только демо-стенд
// (demoGate). Сам вызов остаётся идемпотентным:
// запись его ключа в idempotency не удаляется, а ответ сохраняется после очистки.
func (s *Service) ResetDemo(ctx context.Context, req *identityv1.ResetDemoRequest) (*identityv1.ResetDemoResponse, error) {
	if err := s.demoGate(ctx); err != nil {
		return nil, err
	}
	if !validIdempotencyKey(req.GetIdempotencyKey()) {
		return nil, invalidRequest()
	}
	const method = identityv1connect.IdentityServiceResetDemoProcedure
	resp := &identityv1.ResetDemoResponse{}
	err := s.idempotent(ctx, "reset_demo", method, req.GetIdempotencyKey(), req, resp, func(tx pgx.Tx) error {
		q := store.New(tx)
		if _, err := q.DeleteAllSessions(ctx); err != nil {
			return err
		}
		if _, err := q.DeleteAllOtpCodes(ctx); err != nil {
			return err
		}
		if _, err := q.DeleteAllRateLimits(ctx); err != nil {
			return err
		}
		if _, err := q.DeleteAllMfaFactors(ctx); err != nil {
			return err
		}
		_, err := q.DeleteIdempotencyExcept(ctx, store.DeleteIdempotencyExceptParams{Method: method, Key: req.GetIdempotencyKey()})
		return err
	})
	if err != nil {
		return nil, err
	}
	return resp, nil
}
