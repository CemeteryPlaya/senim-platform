package dbx_test

import (
	"context"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"testing/fstest"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgconn"
	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/testcontainers/testcontainers-go"
	tcpg "github.com/testcontainers/testcontainers-go/modules/postgres"

	"github.com/CemeteryPlaya/senim-platform/pkg/dbx"
)

const (
	sqlInsufficientPrivilege = "42501"
	superPassword            = "test-super"
)

var testMigrations = fstest.MapFS{
	"00001_init.sql": {Data: []byte(`-- +goose Up
CREATE TABLE items (id bigserial PRIMARY KEY, name text NOT NULL);

-- senim:append-only ledger
CREATE TABLE ledger (id bigserial PRIMARY KEY, amount bigint NOT NULL);

-- +goose StatementBegin
CREATE FUNCTION ledger_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RETURN NEW;
END;
$$;
-- +goose StatementEnd
CREATE TRIGGER ledger_guard_trg BEFORE INSERT ON ledger FOR EACH ROW EXECUTE FUNCTION ledger_guard();

-- +goose Down
DROP TABLE ledger;
DROP TABLE items;
`)},
}

const platformSchema = `CREATE TABLE IF NOT EXISTS platform_outbox (id bigserial PRIMARY KEY, payload text NOT NULL);`

type env struct {
	host string
	port string
}

// startPostgres поднимает postgres:17 и применяет настоящий сгенерированный 00-roles.sql.
func startPostgres(t *testing.T) env {
	t.Helper()
	ctx := context.Background()
	rolesSQL, err := filepath.Abs("../../deploy/compose/postgres/init/00-roles.sql")
	if err != nil {
		t.Fatal(err)
	}
	if _, err := os.Stat(rolesSQL); err != nil {
		t.Fatalf("нет сгенерированного 00-roles.sql: %v", err)
	}
	// Файл кладётся в initdb.d: контейнер выполняет его так же, как docker compose.
	ctr, err := tcpg.Run(ctx, "postgres:17",
		tcpg.WithPassword(superPassword),
		testcontainers.WithFiles(testcontainers.ContainerFile{
			HostFilePath:      rolesSQL,
			ContainerFilePath: "/docker-entrypoint-initdb.d/00-roles.sql",
			FileMode:          0o644,
		}),
		tcpg.BasicWaitStrategies(),
	)
	if err != nil {
		t.Fatalf("старт postgres: %v", err)
	}
	t.Cleanup(func() { _ = testcontainers.TerminateContainer(ctr) })
	host, err := ctr.Host(ctx)
	if err != nil {
		t.Fatal(err)
	}
	port, err := ctr.MappedPort(ctx, "5432/tcp")
	if err != nil {
		t.Fatal(err)
	}
	return env{host: host, port: port.Port()}
}

func (e env) dsn(user, pass, db string) string {
	return fmt.Sprintf("postgres://%s:%s@%s:%s/%s?sslmode=disable", user, pass, e.host, e.port, db)
}

func (e env) ownerDSN() string { return e.dsn("identity_owner", "dev-identity-owner", "identity") }

func (e env) migrated(t *testing.T) *pgxpool.Pool {
	t.Helper()
	ctx, cancel := context.WithTimeout(context.Background(), 60*time.Second)
	defer cancel()
	if err := dbx.Migrate(ctx, e.ownerDSN(), "identity", testMigrations, platformSchema); err != nil {
		t.Fatalf("Migrate: %v", err)
	}
	pool, err := dbx.Connect(ctx, e.dsn("identity_app", "dev-identity-app", "identity"), "identity")
	if err != nil {
		t.Fatalf("Connect: %v", err)
	}
	t.Cleanup(pool.Close)
	return pool
}

func requireSQLState(t *testing.T, err error, want string) {
	t.Helper()
	var pgErr *pgconn.PgError
	if !errors.As(err, &pgErr) {
		t.Fatalf("ожидалась PgError %s, получено: %v", want, err)
	}
	if pgErr.Code != want {
		t.Fatalf("SQLSTATE = %s (%s), ожидался %s", pgErr.Code, pgErr.Message, want)
	}
}

func setup(t *testing.T) (env, *pgxpool.Pool) {
	t.Helper()
	e := startPostgres(t)
	return e, e.migrated(t)
}

func TestAppRoleCannotTruncate(t *testing.T) {
	_, pool := setup(t)
	_, err := pool.Exec(context.Background(), `TRUNCATE items`)
	requireSQLState(t, err, sqlInsufficientPrivilege)
	_, err = pool.Exec(context.Background(), `TRUNCATE ledger`)
	requireSQLState(t, err, sqlInsufficientPrivilege)
}

func TestAppRoleCannotDDL(t *testing.T) {
	_, pool := setup(t)
	ctx := context.Background()
	for _, stmt := range []string{
		`ALTER TABLE items ADD COLUMN x int`,
		`DROP TRIGGER ledger_guard_trg ON ledger`,
		`DROP TABLE items`,
		`CREATE TABLE evil (id int)`,
		`CREATE TRIGGER t2 BEFORE INSERT ON items FOR EACH ROW EXECUTE FUNCTION ledger_guard()`,
	} {
		_, err := pool.Exec(ctx, stmt)
		if err == nil {
			t.Fatalf("%q выполнилось от app-роли", stmt)
		}
		requireSQLState(t, err, sqlInsufficientPrivilege)
	}
}

func TestAppendOnlyGrant(t *testing.T) {
	_, pool := setup(t)
	ctx := context.Background()
	if _, err := pool.Exec(ctx, `INSERT INTO ledger (amount) VALUES (100)`); err != nil {
		t.Fatalf("INSERT в ledger: %v", err)
	}
	for _, stmt := range []string{`UPDATE ledger SET amount = 1`, `DELETE FROM ledger`} {
		_, err := pool.Exec(ctx, stmt)
		requireSQLState(t, err, sqlInsufficientPrivilege)
	}
	// Обычные таблицы, платформенные таблицы и последовательности работают.
	for _, stmt := range []string{
		`INSERT INTO items (name) VALUES ('a')`,
		`UPDATE items SET name = 'b'`,
		`INSERT INTO platform_outbox (payload) VALUES ('x')`,
		`UPDATE platform_outbox SET payload = 'y'`,
	} {
		if _, err := pool.Exec(ctx, stmt); err != nil {
			t.Fatalf("%q: %v", stmt, err)
		}
	}
	// Служебная таблица goose недоступна app-роли.
	_, err := pool.Exec(ctx, `UPDATE goose_db_version SET is_applied = false`)
	requireSQLState(t, err, sqlInsufficientPrivilege)
}

func TestMigrateIsIdempotentAndRegrants(t *testing.T) {
	e, pool := setup(t)
	ctx := context.Background()
	if err := dbx.Migrate(ctx, e.ownerDSN(), "identity", testMigrations, platformSchema); err != nil {
		t.Fatalf("повторный Migrate: %v", err)
	}
	_, err := pool.Exec(ctx, `UPDATE ledger SET amount = 1`)
	requireSQLState(t, err, sqlInsufficientPrivilege)
}

func TestMigrateRejectsUnknownAppendOnlyTable(t *testing.T) {
	e := startPostgres(t)
	bad := fstest.MapFS{"00001_x.sql": {Data: []byte("-- +goose Up\n-- senim:append-only nope\nCREATE TABLE t (id int);\n-- +goose Down\nDROP TABLE t;\n")}}
	if err := dbx.Migrate(context.Background(), e.ownerDSN(), "identity", bad); err == nil {
		t.Fatal("ожидалась ошибка для несуществующей append-only таблицы")
	}
}

func TestNoCrossServiceAccess(t *testing.T) {
	e := startPostgres(t)
	_, err := dbx.Connect(context.Background(), e.dsn("identity_app", "dev-identity-app", "deal"), "identity")
	if err == nil {
		t.Fatal("identity_app подключился к базе deal")
	}
	requireSQLState(t, err, sqlInsufficientPrivilege)
}

func TestInTxRollsBackOnError(t *testing.T) {
	_, pool := setup(t)
	ctx := context.Background()
	boom := errors.New("boom")
	err := dbx.InTx(ctx, pool, func(tx pgx.Tx) error {
		if _, err := tx.Exec(ctx, `INSERT INTO items (name) VALUES ('rolled-back')`); err != nil {
			return err
		}
		return boom
	})
	if !errors.Is(err, boom) {
		t.Fatalf("err = %v", err)
	}
	var n int
	if err := pool.QueryRow(ctx, `SELECT count(*) FROM items WHERE name = 'rolled-back'`).Scan(&n); err != nil {
		t.Fatal(err)
	}
	if n != 0 {
		t.Fatalf("вставка видна после отката: %d", n)
	}
}

func TestInTxRollsBackOnPanicAndCommitsOnSuccess(t *testing.T) {
	_, pool := setup(t)
	ctx := context.Background()
	func() {
		defer func() { _ = recover() }()
		_ = dbx.InTx(ctx, pool, func(tx pgx.Tx) error {
			_, _ = tx.Exec(ctx, `INSERT INTO items (name) VALUES ('panic')`)
			panic("x")
		})
	}()
	if err := dbx.InTx(ctx, pool, func(tx pgx.Tx) error {
		_, err := tx.Exec(ctx, `INSERT INTO items (name) VALUES ('ok')`)
		return err
	}); err != nil {
		t.Fatal(err)
	}
	rows, err := pool.Query(ctx, `SELECT name FROM items ORDER BY name`)
	if err != nil {
		t.Fatal(err)
	}
	names, err := pgx.CollectRows(rows, pgx.RowTo[string])
	if err != nil {
		t.Fatal(err)
	}
	if len(names) != 1 || names[0] != "ok" {
		t.Fatalf("names = %v", names)
	}
}

func TestConnectSetsApplicationName(t *testing.T) {
	_, pool := setup(t)
	var name string
	if err := pool.QueryRow(context.Background(), `SHOW application_name`).Scan(&name); err != nil {
		t.Fatal(err)
	}
	if name != "identity" {
		t.Fatalf("application_name = %q", name)
	}
}

func TestMalformedAppendOnlyMarkerFails(t *testing.T) {
	for _, marker := range []string{
		"-- senim:append-only MoneyTransaction",
		"-- senim:append-only money_tx -- журнал денег",
		"-- senim:append-only public.ledger",
		"-- senim:append-only a, b",
		"-- senim:append-only",
		"--senim:append-only:ledger",
	} {
		m := fstest.MapFS{"00001_x.sql": {Data: []byte("-- +goose Up\n" + marker + "\nCREATE TABLE ledger (id int);\n-- +goose Down\nDROP TABLE ledger;\n")}}
		// DSN недостижим: разбор маркеров идёт до подключения.
		err := dbx.Migrate(context.Background(), "postgres://x:y@127.0.0.1:1/z", "identity", m)
		if err == nil || !strings.Contains(err.Error(), "senim:append-only") {
			t.Fatalf("маркер %q: ожидалась ошибка маркера, получено %v", marker, err)
		}
	}
	// Тот же маркер в platformSchemas.
	err := dbx.Migrate(context.Background(), "postgres://x:y@127.0.0.1:1/z", "identity", fstest.MapFS{}, "-- senim:append-only Bad\nSELECT 1")
	if err == nil || !strings.Contains(err.Error(), "senim:append-only") {
		t.Fatalf("platformSchemas: %v", err)
	}
}

func TestAppRoleCannotConnectToServiceDatabases(t *testing.T) {
	e := startPostgres(t)
	for _, db := range []string{"postgres", "template1"} {
		_, err := dbx.Connect(context.Background(), e.dsn("identity_app", "dev-identity-app", db), "identity")
		if err == nil {
			t.Fatalf("identity_app подключился к %s", db)
		}
		requireSQLState(t, err, sqlInsufficientPrivilege)
	}
}

func TestExactAppPrivileges(t *testing.T) {
	e, _ := setup(t)
	ctx := context.Background()
	conn, err := pgx.Connect(ctx, e.ownerDSN())
	if err != nil {
		t.Fatal(err)
	}
	defer conn.Close(ctx)
	all := []string{"SELECT", "INSERT", "UPDATE", "DELETE", "TRUNCATE", "REFERENCES", "TRIGGER"}
	want := map[string][]string{
		"items":            {"SELECT", "INSERT", "UPDATE"},
		"ledger":           {"SELECT", "INSERT"},
		"platform_outbox":  {"SELECT", "INSERT", "UPDATE"},
		"goose_db_version": {},
	}
	for table, exp := range want {
		var got []string
		for _, p := range all {
			var ok bool
			if err := conn.QueryRow(ctx, `SELECT has_table_privilege('identity_app', $1, $2)`, table, p).Scan(&ok); err != nil {
				t.Fatal(err)
			}
			if ok {
				got = append(got, p)
			}
		}
		if strings.Join(got, ",") != strings.Join(exp, ",") {
			t.Errorf("%s: права %v, ожидались %v", table, got, exp)
		}
	}
	// Последовательности: рабочие доступны, goose — нет.
	for seq, exp := range map[string]bool{"items_id_seq": true, "ledger_id_seq": true, "platform_outbox_id_seq": true, "goose_db_version_id_seq": false} {
		var u, s bool
		if err := conn.QueryRow(ctx, `SELECT has_sequence_privilege('identity_app', $1, 'USAGE'), has_sequence_privilege('identity_app', $1, 'SELECT')`, seq).Scan(&u, &s); err != nil {
			t.Fatal(err)
		}
		if u != exp || s != exp {
			t.Errorf("sequence %s: usage=%v select=%v, ожидалось %v", seq, u, s, exp)
		}
	}
	// EXECUTE на функции схемы у PUBLIC отозван.
	var pub bool
	if err := conn.QueryRow(ctx, `SELECT has_function_privilege('identity_app', 'ledger_guard()', 'EXECUTE')`).Scan(&pub); err != nil {
		t.Fatal(err)
	}
	if pub {
		t.Error("identity_app имеет EXECUTE на ledger_guard() через PUBLIC")
	}
}

func TestMigrateWithOnlyPlatformSchemas(t *testing.T) {
	e := startPostgres(t)
	ctx := context.Background()
	if err := dbx.Migrate(ctx, e.ownerDSN(), "identity", fstest.MapFS{}, platformSchema); err != nil {
		t.Fatalf("Migrate без миграций: %v", err)
	}
	pool, err := dbx.Connect(ctx, e.dsn("identity_app", "dev-identity-app", "identity"), "identity")
	if err != nil {
		t.Fatal(err)
	}
	defer pool.Close()
	if _, err := pool.Exec(ctx, `INSERT INTO platform_outbox (payload) VALUES ('x')`); err != nil {
		t.Fatal(err)
	}
}
