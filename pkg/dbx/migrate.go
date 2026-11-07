package dbx

import (
	"context"
	"database/sql"
	"fmt"
	"io/fs"
	"regexp"
	"sort"
	"strings"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/stdlib"
	"github.com/pressly/goose/v3"
)

// Маркер append-only таблицы: отдельная строка-комментарий в SQL-миграции (или в
// platformSchemas), в любом месте файла:
//
//	-- senim:append-only ledger
//
// Роль <svc>_app получает на такую таблицу только SELECT и INSERT. Если таблицы с
// таким именем нет после миграций — Migrate возвращает ошибку (защита от опечаток).
var (
	appendOnlyRe = regexp.MustCompile(`(?m)^[ \t]*--[ \t]*senim:append-only[ \t]+([a-z_][a-z0-9_]*)[ \t]*\r?$`)
	serviceRe    = regexp.MustCompile(`^[a-z][a-z0-9_]{0,30}$`)
)

// gooseTable — служебная таблица версий; рабочая роль к ней доступа не получает.
const gooseTable = "goose_db_version"

// Migrate применяет миграции сервиса от имени владельца базы (ownerDSN, роль
// <service>_owner) и выдаёт рабочей роли <service>_app минимально нужные права.
//
// Порядок: platformSchemas (идемпотентные "CREATE TABLE IF NOT EXISTS ..."),
// затем goose-миграции из корня migrations (SQL-файлы вида 00001_name.sql), затем
// права. Права пересчитываются при каждом вызове с нуля (REVOKE ALL + GRANT), так что
// новые таблицы покрыты, а UPDATE на append-only таблицах отозван явно.
func Migrate(ctx context.Context, ownerDSN string, service string, migrations fs.FS, platformSchemas ...string) error {
	if !serviceRe.MatchString(service) {
		return fmt.Errorf("dbx: недопустимое имя сервиса %q", service)
	}
	appendOnly, err := findAppendOnly(migrations, platformSchemas)
	if err != nil {
		return err
	}

	cfg, err := pgx.ParseConfig(ownerDSN)
	if err != nil {
		return fmt.Errorf("dbx: разбор DSN владельца: %w", err)
	}
	cfg.RuntimeParams["application_name"] = service + "-migrate"
	db := stdlib.OpenDB(*cfg)
	defer db.Close()

	for i, schema := range platformSchemas {
		if _, err := db.ExecContext(ctx, schema); err != nil {
			return fmt.Errorf("dbx: платформенная схема #%d: %w", i, err)
		}
	}

	provider, err := goose.NewProvider(goose.DialectPostgres, db, migrations)
	if err != nil {
		return fmt.Errorf("dbx: goose: %w", err)
	}
	if _, err := provider.Up(ctx); err != nil {
		return fmt.Errorf("dbx: миграции %s: %w", service, err)
	}
	return grant(ctx, db, service+"_app", appendOnly)
}

func findAppendOnly(migrations fs.FS, extra []string) (map[string]bool, error) {
	res := map[string]bool{}
	add := func(src string) {
		for _, m := range appendOnlyRe.FindAllStringSubmatch(src, -1) {
			res[m[1]] = true
		}
	}
	for _, s := range extra {
		add(s)
	}
	err := fs.WalkDir(migrations, ".", func(path string, d fs.DirEntry, err error) error {
		if err != nil || d.IsDir() || !strings.HasSuffix(path, ".sql") {
			return err
		}
		b, err := fs.ReadFile(migrations, path)
		if err != nil {
			return err
		}
		add(string(b))
		return nil
	})
	if err != nil {
		return nil, fmt.Errorf("dbx: чтение миграций: %w", err)
	}
	return res, nil
}

func grant(ctx context.Context, db *sql.DB, appRole string, appendOnly map[string]bool) error {
	rows, err := db.QueryContext(ctx,
		`SELECT tablename FROM pg_tables WHERE schemaname = 'public' AND tablename <> $1 ORDER BY tablename`, gooseTable)
	if err != nil {
		return fmt.Errorf("dbx: список таблиц: %w", err)
	}
	var tables []string
	for rows.Next() {
		var n string
		if err := rows.Scan(&n); err != nil {
			_ = rows.Close()
			return fmt.Errorf("dbx: список таблиц: %w", err)
		}
		tables = append(tables, n)
	}
	if err := rows.Err(); err != nil {
		return fmt.Errorf("dbx: список таблиц: %w", err)
	}
	_ = rows.Close()

	existing := map[string]bool{}
	for _, t := range tables {
		existing[t] = true
	}
	var missing []string
	for t := range appendOnly {
		if !existing[t] {
			missing = append(missing, t)
		}
	}
	if len(missing) > 0 {
		sort.Strings(missing)
		return fmt.Errorf("dbx: senim:append-only указывает на несуществующие таблицы: %s", strings.Join(missing, ", "))
	}

	role := pgx.Identifier{appRole}.Sanitize()
	tx, err := db.BeginTx(ctx, nil)
	if err != nil {
		return fmt.Errorf("dbx: права: %w", err)
	}
	defer func() { _ = tx.Rollback() }()

	stmts := []string{
		fmt.Sprintf("REVOKE ALL ON ALL TABLES IN SCHEMA public FROM %s", role),
		fmt.Sprintf("REVOKE ALL ON ALL SEQUENCES IN SCHEMA public FROM %s", role),
	}
	for _, t := range tables {
		privs := "SELECT, INSERT, UPDATE"
		if appendOnly[t] {
			privs = "SELECT, INSERT"
		}
		stmts = append(stmts, fmt.Sprintf("GRANT %s ON TABLE %s TO %s", privs, pgx.Identifier{"public", t}.Sanitize(), role))
	}
	stmts = append(stmts, fmt.Sprintf("GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO %s", role))
	for _, s := range stmts {
		if _, err := tx.ExecContext(ctx, s); err != nil {
			return fmt.Errorf("dbx: права (%s): %w", s, err)
		}
	}
	return tx.Commit()
}
