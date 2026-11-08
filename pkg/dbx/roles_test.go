package dbx_test

import (
	"context"
	"errors"
	"strings"
	"testing"
	"testing/fstest"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgconn"
	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/CemeteryPlaya/senim-platform/internal/testdb"
	"github.com/CemeteryPlaya/senim-platform/pkg/dbx"
)

const sqlInsufficientPrivilege = "42501"

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

// env — Postgres с настоящими ролями (internal/testdb).
type env struct{ *testdb.Env }

func startPostgres(t *testing.T) env {
	t.Helper()
	return env{testdb.StartT(t)}
}

func (e env) dsn(user, pass, db string) string { return e.DSN(user, pass, db) }

func (e env) ownerDSN() string { return e.OwnerDSN("identity") }

func (e env) migrated(t *testing.T) *pgxpool.Pool {
	t.Helper()
	ctx, cancel := context.WithTimeout(context.Background(), 60*time.Second)
	defer cancel()
	if err := dbx.Migrate(ctx, e.ownerDSN(), "identity", testMigrations, platformSchema); err != nil {
		t.Fatalf("Migrate: %v", err)
	}
	pool, err := dbx.Connect(ctx, e.dsn("identity_app", "dev-identity-app", "identity"), "identity", dbx.DefaultMaxConns)
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
	_, err := dbx.Connect(context.Background(), e.dsn("identity_app", "dev-identity-app", "deal"), "identity", dbx.DefaultMaxConns)
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
		_, err := dbx.Connect(context.Background(), e.dsn("identity_app", "dev-identity-app", db), "identity", dbx.DefaultMaxConns)
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
	defer func() { _ = conn.Close(ctx) }()
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
	pool, err := dbx.Connect(ctx, e.dsn("identity_app", "dev-identity-app", "identity"), "identity", dbx.DefaultMaxConns)
	if err != nil {
		t.Fatal(err)
	}
	defer pool.Close()
	if _, err := pool.Exec(ctx, `INSERT INTO platform_outbox (payload) VALUES ('x')`); err != nil {
		t.Fatal(err)
	}
}

// Опечатки и другой регистр маркера не должны молча оставлять журнал изменяемым:
// каждая такая строка — ошибка Migrate до подключения к базе.
func TestAppendOnlyMarkerTyposFail(t *testing.T) {
	for _, marker := range []string{
		"-- SENIM:APPEND-ONLY ledger",
		"-- Senim:Append-Only ledger",
		"-- senim:append_only ledger",
		"-- senim:appendonly ledger",
		"-- senim:append only ledger",
		"-- senim: append-only ledger",
		"-- senim :append-only ledger",
		"-- senim:apend-only ledger",
		"-- senim:append-onyl ledger",
		"-- senim:readonly ledger",
		"--  SENIM:append-only ledger",
		"-- append-only ledger",
		"-- append_only: ledger",
	} {
		m := fstest.MapFS{"00001_x.sql": {Data: []byte("-- +goose Up\n" + marker + "\nCREATE TABLE ledger (id int);\n-- +goose Down\nDROP TABLE ledger;\n")}}
		err := dbx.Migrate(context.Background(), "postgres://x:y@127.0.0.1:1/z", "identity", m)
		if err == nil || !strings.Contains(err.Error(), "senim:append-only") {
			t.Errorf("маркер %q: ожидалась ошибка маркера, получено %v", marker, err)
		}
	}
}

// Обычные комментарии, где слово append-only стоит внутри фразы, маркером не считаются.
func TestAppendOnlyInProseIsNotAMarker(t *testing.T) {
	m := fstest.MapFS{"00001_x.sql": {Data: []byte("-- +goose Up\n-- журнал хранит записи, таблица по смыслу append-only\n-- TODO: append rows in batches\nCREATE TABLE t (id int);\n-- +goose Down\nDROP TABLE t;\n")}}
	err := dbx.Migrate(context.Background(), "postgres://x:y@127.0.0.1:1/z", "identity", m)
	if err == nil || strings.Contains(err.Error(), "senim:append-only") {
		t.Fatalf("комментарий-фраза не маркер: ожидалась только ошибка подключения, получено %v", err)
	}
}

// Размер пула задаётся явно (POOL_MAX_CONNS), а не max(4, NumCPU) pgxpool.
func TestConnectPoolSize(t *testing.T) {
	e := startPostgres(t)
	dsn := e.dsn("identity_app", "dev-identity-app", "identity")
	pool, err := dbx.Connect(context.Background(), dsn, "identity", 3)
	if err != nil {
		t.Fatal(err)
	}
	defer pool.Close()
	if got := pool.Config().MaxConns; got != 3 {
		t.Fatalf("MaxConns = %d, want 3", got)
	}
	if _, err := dbx.Connect(context.Background(), dsn, "identity", 0); err == nil {
		t.Fatal("maxConns = 0: want error")
	}
}

// dbinit ставит рабочей роли тайм-ауты: зависший запрос и забытая транзакция не держат
// соединение и блокировки бесконечно.
func TestAppRoleTimeouts(t *testing.T) {
	_, pool := setup(t)
	for setting, want := range map[string]string{
		"statement_timeout":                   "15s",
		"idle_in_transaction_session_timeout": "30s",
	} {
		var got string
		if err := pool.QueryRow(context.Background(), "SHOW "+setting).Scan(&got); err != nil {
			t.Fatal(err)
		}
		if got != want {
			t.Errorf("%s = %q, want %q", setting, got, want)
		}
	}
}
