package internal

import (
	"context"
	"crypto/sha256"
	"errors"
	"fmt"
	"slices"
	"time"

	"connectrpc.com/connect/v2"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgconn"
	"github.com/jackc/pgx/v5/pgtype"
	"google.golang.org/protobuf/types/known/timestamppb"

	identityv1 "github.com/CemeteryPlaya/senim-platform/gen/go/senim/identity/v1"
	"github.com/CemeteryPlaya/senim-platform/services/identity/internal/store"
)

const (
	// idleTimeout — простой, после которого сессия истекает (спека §4.4); границу
	// проверяет Authenticate (Task 6).
	idleTimeout = 30 * time.Minute
	// userSessionTTL и staffSessionTTL — абсолютный срок сессии. Сотрудник (оператор,
	// замерщик) живёт 8 часов, остальные 7 дней.
	userSessionTTL  = 7 * day
	staffSessionTTL = 8 * hour
	// maxUserAgent — предел длины user_agent в рунах.
	maxUserAgent = 300
	// sessionTokenConstraint — уникальный индекс sessions.token_hash (имя по умолчанию).
	sessionTokenConstraint = "sessions_token_hash_key"
)

// isStaff — оператор или замерщик площадки: у них короткая сессия.
func isStaff(roles []string) bool {
	return slices.Contains(roles, "OPERATOR") || slices.Contains(roles, "MEASURER")
}

// createSession вставляет сессию для токена, который сгенерировал web. В базе лежит только
// sha256 токена. asRole пуст — активна роль по умолчанию. Выдана ли asRole пользователю,
// createSession не проверяет: это дело вызывающего (Task 9).
func createSession(ctx context.Context, tx pgx.Tx, user store.User, token string, userAgent string, asRole string, now time.Time) (store.Session, error) {
	ttl := userSessionTTL
	if isStaff(user.Roles) {
		ttl = staffSessionTTL
	}
	if asRole == "" {
		asRole = user.DefaultRole
	}
	if r := []rune(userAgent); len(r) > maxUserAgent {
		userAgent = string(r[:maxUserAgent])
	}
	sum := sha256.Sum256([]byte(token))
	sess, err := store.New(tx).InsertSession(ctx, store.InsertSessionParams{
		TokenHash:  sum[:],
		UserID:     user.ID,
		ActiveRole: asRole,
		UserAgent:  userAgent,
		CreatedAt:  pgtype.Timestamptz{Time: now, Valid: true},
		ExpiresAt:  pgtype.Timestamptz{Time: now.Add(ttl), Valid: true},
	})
	var pgErr *pgconn.PgError
	if errors.As(err, &pgErr) && pgErr.Code == "23505" && pgErr.ConstraintName == sessionTokenConstraint {
		// Токен уже принадлежит другой сессии (повтор токена с новым ключом, гонка).
		return store.Session{}, rpcError(connect.CodeInvalidArgument, "session_token_invalid", nil)
	}
	if err != nil {
		return store.Session{}, fmt.Errorf("запись сессии: %w", err)
	}
	return sess, nil
}

// roleProto переводит имя роли из базы («CLIENT») в enum.
func roleProto(name string) identityv1.Role {
	return identityv1.Role(identityv1.Role_value["ROLE_"+name])
}

// userProto — пользователь в ответах сервиса.
func userProto(u store.User) *identityv1.User {
	roles := make([]identityv1.Role, 0, len(u.Roles))
	for _, r := range u.Roles {
		roles = append(roles, roleProto(r))
	}
	out := &identityv1.User{
		Id:          u.ID.String(),
		Phone:       u.Phone,
		DefaultRole: roleProto(u.DefaultRole),
		Roles:       roles,
		IsDemo:      u.IsDemo,
		CreatedAt:   timestamppb.New(u.CreatedAt.Time),
	}
	if u.BlockedAt.Valid {
		out.BlockedAt = timestamppb.New(u.BlockedAt.Time)
	}
	return out
}

// sessionProto — сессия в ответах сервиса; токена в ней нет.
func sessionProto(s store.Session, idle time.Duration) *identityv1.Session {
	return &identityv1.Session{
		Id:            s.ID.String(),
		ActiveRole:    roleProto(s.ActiveRole),
		ExpiresAt:     timestamppb.New(s.ExpiresAt.Time),
		IdleExpiresAt: timestamppb.New(s.LastSeenAt.Time.Add(idle)),
	}
}
