package internal

import (
	"context"
	"errors"
	"slices"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"

	eventsv1 "github.com/CemeteryPlaya/senim-platform/gen/go/senim/events/v1"
	"github.com/CemeteryPlaya/senim-platform/pkg/dbx"
	"github.com/CemeteryPlaya/senim-platform/pkg/outbox"
	"github.com/CemeteryPlaya/senim-platform/services/identity/internal/store"
)

// grantAdminActor — действующее лицо аудита identity grant-admin (actor_kind "cli").
var grantAdminActor = auditActor{kind: "cli", id: "identity.grant-admin"}

// grantAdmin — тело identity grant-admin: в одной транзакции делает номер phone
// администратором. Номера нет — создаёт пользователя с единственной ролью ADMIN (она же
// роль по умолчанию), пишет RoleGranted и аудит user.role_granted (actor_kind "cli").
// Уже администратор — без изменений и без событий (granted=false). Заблокированный
// пользователь или номер с другими ролями — ошибка без изменений: администратор не
// совмещает роли, блокировку команда не снимает. Ошибки не содержат телефона.
func grantAdmin(ctx context.Context, pool *pgxpool.Pool, phone string, now time.Time) (userID uuid.UUID, granted bool, err error) {
	err = dbx.InTx(ctx, pool, func(tx pgx.Tx) error {
		q := store.New(tx)
		user, err := q.GetUserByPhone(ctx, phone)
		if errors.Is(err, pgx.ErrNoRows) {
			user, err = q.CreateUser(ctx, store.CreateUserParams{Phone: phone, Roles: []string{adminRole}, DefaultRole: adminRole})
			if isUniqueViolation(err, usersPhoneConstraint) {
				return errors.New("grant-admin: номер добавлен параллельно — повторите команду")
			}
			if err != nil {
				return err
			}
			userID, granted = user.ID, true
			if _, err := outbox.Add(ctx, tx, ServiceID, subjectRoleGranted, "senim.events.v1.RoleGranted",
				&eventsv1.RoleGranted{UserId: user.ID.String(), Role: roleProto(adminRole)}); err != nil {
				return err
			}
			return writeAudit(ctx, tx, grantAdminActor, user.ID.String(), "user.role_granted", nil, map[string]string{"role": adminRole}, now)
		}
		if err != nil {
			return err
		}
		if user, err = q.LockUser(ctx, user.ID); err != nil {
			return err
		}
		userID = user.ID
		if user.BlockedAt.Valid {
			return errors.New("grant-admin: пользователь заблокирован")
		}
		if !slices.Equal(user.Roles, []string{adminRole}) {
			return errors.New("grant-admin: у номера уже есть роли — администратор не совмещает роли")
		}
		return nil
	})
	return userID, granted, err
}
