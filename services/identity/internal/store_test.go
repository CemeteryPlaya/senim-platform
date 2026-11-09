package internal

import (
	"bytes"
	"context"
	"errors"
	"fmt"
	"os"
	"sync"
	"testing"
	"time"

	"github.com/jackc/pgx/v5/pgconn"
	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/CemeteryPlaya/senim-platform/internal/testdb"
	"github.com/CemeteryPlaya/senim-platform/pkg/dbx"
	"github.com/CemeteryPlaya/senim-platform/services/identity/internal/store"
)

// Один Postgres на все тесты пакета: поднимается при первом обращении, гасится в TestMain.
var (
	pgOnce sync.Once
	pgEnv  *testdb.Env
	pgErr  error
)

func TestMain(m *testing.M) {
	code := m.Run()
	if pgEnv != nil {
		pgEnv.Terminate()
	}
	os.Exit(code)
}

// migratedDB применяет миграции identity (через Migrate сервиса) и возвращает рабочий пул.
func migratedDB(t *testing.T) (*pgxpool.Pool, *store.Queries) {
	t.Helper()
	pgOnce.Do(func() {
		pgEnv, pgErr = testdb.Start(context.Background())
		if pgErr != nil {
			return
		}
		vars := map[string]string{"APP_ENV": "dev", "IDENTITY_OWNER_DSN": pgEnv.OwnerDSN("identity")}
		var logs bytes.Buffer
		if code := Main(context.Background(), []string{"migrate"}, func(k string) (string, bool) { v, ok := vars[k]; return v, ok }, &logs); code != 0 {
			pgErr = fmt.Errorf("migrate: код %d\n%s", code, logs.String())
		}
	})
	if pgErr != nil {
		t.Fatal(pgErr)
	}
	pool, err := dbx.Connect(context.Background(), pgEnv.AppDSN("identity"), "identity-test", 2)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(pool.Close)
	return pool, store.New(pool)
}

var phoneSeq int

// newPhone — уникальный номер на тест (общая база).
func newPhone() string {
	phoneSeq++
	return fmt.Sprintf("+7700%07d", phoneSeq)
}

func createUser(q *store.Queries, roles []string, def string) (store.User, error) {
	return q.CreateUser(context.Background(), store.CreateUserParams{Phone: newPhone(), Roles: roles, DefaultRole: def})
}

func requireCheckViolation(t *testing.T, err error, constraint string) {
	t.Helper()
	var pgErr *pgconn.PgError
	if !errors.As(err, &pgErr) || pgErr.Code != "23514" || pgErr.ConstraintName != constraint {
		t.Fatalf("want check_violation (23514) on %s, got %v", constraint, err)
	}
}

func TestDBUserCRUD(t *testing.T) {
	_, q := migratedDB(t)
	ctx := context.Background()
	phone := newPhone()
	u, err := q.CreateUser(ctx, store.CreateUserParams{Phone: phone, Roles: []string{"CLIENT", "EXECUTOR"}, DefaultRole: "EXECUTOR", IsDemo: true})
	if err != nil {
		t.Fatal(err)
	}
	byPhone, err := q.GetUserByPhone(ctx, phone)
	if err != nil || byPhone.ID != u.ID || !byPhone.IsDemo || byPhone.DefaultRole != "EXECUTOR" {
		t.Fatalf("by phone: %+v %v", byPhone, err)
	}
	byID, err := q.GetUserByID(ctx, u.ID)
	if err != nil || byID.Phone != phone || len(byID.Roles) != 2 || byID.BlockedAt.Valid {
		t.Fatalf("by id: %+v %v", byID, err)
	}
	// Телефон уникален.
	_, err = q.CreateUser(ctx, store.CreateUserParams{Phone: phone, Roles: []string{"CLIENT"}, DefaultRole: "CLIENT"})
	var pgErr *pgconn.PgError
	if !errors.As(err, &pgErr) || pgErr.Code != "23505" {
		t.Fatalf("duplicate phone: want unique_violation, got %v", err)
	}
}

// Ограничения БД, перенесённые из apps/web (roles.int.test.ts, «ограничения БД»).

func TestDBDefaultRoleMustBeGranted(t *testing.T) {
	_, q := migratedDB(t)
	_, err := createUser(q, []string{"EXECUTOR"}, "CLIENT")
	requireCheckViolation(t, err, "users_default_role_granted")
}

func TestDBOperatorIsAlone(t *testing.T) {
	_, q := migratedDB(t)
	_, err := createUser(q, []string{"OPERATOR", "CLIENT"}, "OPERATOR")
	requireCheckViolation(t, err, "users_staff_role_alone")
	if _, err := createUser(q, []string{"OPERATOR"}, "OPERATOR"); err != nil {
		t.Fatalf("operator alone: %v", err)
	}
}

func TestDBMeasurerIsAlone(t *testing.T) {
	_, q := migratedDB(t)
	_, err := createUser(q, []string{"MEASURER", "CLIENT"}, "MEASURER")
	requireCheckViolation(t, err, "users_staff_role_alone")
	if _, err := createUser(q, []string{"MEASURER"}, "MEASURER"); err != nil {
		t.Fatalf("measurer alone: %v", err)
	}
}

func TestDBMeasurerCannotBeClient(t *testing.T) {
	_, q := migratedDB(t)
	_, err := createUser(q, []string{"CLIENT", "MEASURER"}, "CLIENT")
	requireCheckViolation(t, err, "users_staff_role_alone")
}

func TestDBRolesAreKnown(t *testing.T) {
	_, q := migratedDB(t)
	_, err := createUser(q, []string{"CLIENT", "ADMIN"}, "CLIENT")
	requireCheckViolation(t, err, "users_roles_known")
	_, err = createUser(q, []string{}, "CLIENT")
	var pgErr *pgconn.PgError
	if !errors.As(err, &pgErr) || pgErr.Code != "23514" {
		t.Fatalf("empty roles: want check_violation, got %v", err)
	}
}

func TestAppRoleCanDeleteMarkedTables(t *testing.T) {
	pool, q := migratedDB(t)
	ctx := context.Background()
	u, err := createUser(q, []string{"CLIENT"}, "CLIENT")
	if err != nil {
		t.Fatal(err)
	}
	exp := time.Now().Add(time.Hour)
	if _, err := pool.Exec(ctx, `INSERT INTO sessions (token_hash, user_id, active_role, expires_at) VALUES ('\x01', $1, 'CLIENT', $2)`, u.ID, exp); err != nil {
		t.Fatal(err)
	}
	if _, err := pool.Exec(ctx, `INSERT INTO otp_codes (phone, code_hash, expires_at) VALUES ($1, '\x02', $2)`, u.Phone, exp); err != nil {
		t.Fatal(err)
	}
	if _, err := pool.Exec(ctx, `INSERT INTO rate_limits (key, window_start, count) VALUES ($1, now(), 1)`, "k"+u.Phone); err != nil {
		t.Fatal(err)
	}
	for _, table := range []string{"sessions", "otp_codes", "rate_limits"} {
		tag, err := pool.Exec(ctx, "DELETE FROM "+table)
		if err != nil {
			t.Fatalf("DELETE %s: %v", table, err)
		}
		if tag.RowsAffected() == 0 {
			t.Errorf("DELETE %s: ничего не удалено", table)
		}
	}
	_, err = pool.Exec(ctx, `DELETE FROM users WHERE id = $1`, u.ID)
	var pgErr *pgconn.PgError
	if !errors.As(err, &pgErr) || pgErr.Code != "42501" {
		t.Fatalf("DELETE users: want insufficient_privilege (42501), got %v", err)
	}
}
