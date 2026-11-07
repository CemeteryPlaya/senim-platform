package dbx

import (
	"context"
	"database/sql"
	"errors"
	"fmt"
	"io/fs"
	"regexp"
	"sort"
	"strings"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/stdlib"
	"github.com/pressly/goose/v3"
	"github.com/pressly/goose/v3/lock"
)

// Маркер append-only таблицы: отдельная строка-комментарий в SQL-миграции (или в
// platformSchemas), в любом месте файла:
//
//	-- senim:append-only ledger
//
// Роль <svc>_app получает на такую таблицу только SELECT и INSERT. Если таблицы с
// таким именем нет после миграций — Migrate возвращает ошибку (защита от опечаток).
//
// Разбор двухступенчатый: любая строка, начинающаяся с маркера, находится свободным
// шаблоном, а её хвост проверяется строго (одно имя в нижнем регистре, без схемы,
// запятых и комментариев). Неверная форма — ошибка, а не обычная таблица с UPDATE.
var (
	markerRe     = regexp.MustCompile(`(?m)^[ \t]*--[ \t]*senim:append-only\b(.*)$`)
	markerTailRe = regexp.MustCompile(`^[ \t]+([a-z_][a-z0-9_]*)[ \t]*\r?$`)
	serviceRe    = regexp.MustCompile(`^[a-z][a-z0-9_]{0,30}$`)
)

// advisoryLockID — один ключ у goose (сессионная блокировка) и у транзакции выдачи
// прав: параллельные Migrate одной базы не гоняются.
var advisoryLockID = lock.DefaultLockID

// gooseTable — служебная таблица версий; рабочая роль к ней доступа не получает.
const gooseTable = "goose_db_version"

// Migrate применяет миграции сервиса от имени владельца базы (ownerDSN, роль
// <service>_owner) и выдаёт рабочей роли <service>_app минимально нужные права.
//
// Права: SELECT, INSERT, UPDATE на таблицы public (SELECT, INSERT на append-only),
// USAGE и SELECT на последовательности, кроме goose. У PUBLIC отзывается EXECUTE на
// функции схемы public: функции, нужные app-роли, выдаются явно. Представления прав
// не получают. Права, выданные кем-то помимо Migrate на таблицы public, пересчёт
// сбрасывает (REVOKE ALL), права на другие объекты — нет.
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
	defer func() { _ = db.Close() }()

	for i, schema := range platformSchemas {
		if _, err := db.ExecContext(ctx, schema); err != nil {
			return fmt.Errorf("dbx: платформенная схема #%d: %w", i, err)
		}
	}

	locker, err := lock.NewPostgresSessionLocker(lock.WithLockID(advisoryLockID))
	if err != nil {
		return fmt.Errorf("dbx: блокировка миграций: %w", err)
	}
	provider, err := goose.NewProvider(goose.DialectPostgres, db, migrations, goose.WithSessionLocker(locker))
	switch {
	case errors.Is(err, goose.ErrNoMigrations):
		// У сервиса только платформенные таблицы — это нормально.
	case err != nil:
		return fmt.Errorf("dbx: goose: %w", err)
	default:
		if _, err := provider.Up(ctx); err != nil {
			return fmt.Errorf("dbx: миграции %s: %w", service, err)
		}
	}
	return grant(ctx, db, service+"_app", appendOnly)
}

func findAppendOnly(migrations fs.FS, extra []string) (map[string]bool, error) {
	res := map[string]bool{}
	var bad []string
	add := func(where, src string) {
		for _, m := range markerRe.FindAllStringSubmatch(src, -1) {
			t := markerTailRe.FindStringSubmatch(m[1])
			if t == nil {
				bad = append(bad, fmt.Sprintf("%s: %q", where, strings.TrimSpace(m[0])))
				continue
			}
			res[t[1]] = true
		}
	}
	for i, s := range extra {
		add(fmt.Sprintf("platformSchemas[%d]", i), s)
	}
	err := fs.WalkDir(migrations, ".", func(path string, d fs.DirEntry, err error) error {
		if err != nil || d.IsDir() || !strings.HasSuffix(path, ".sql") {
			return err
		}
		b, err := fs.ReadFile(migrations, path)
		if err != nil {
			return err
		}
		add(path, string(b))
		return nil
	})
	if err != nil {
		return nil, fmt.Errorf("dbx: чтение миграций: %w", err)
	}
	if len(bad) > 0 {
		return nil, fmt.Errorf("dbx: неверный маркер senim:append-only (нужно «-- senim:append-only <таблица>»): %s", strings.Join(bad, "; "))
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

	if _, err := tx.ExecContext(ctx, "SELECT pg_advisory_xact_lock($1)", advisoryLockID); err != nil {
		return fmt.Errorf("dbx: блокировка прав: %w", err)
	}
	seqRows, err := tx.QueryContext(ctx,
		`SELECT sequencename FROM pg_sequences WHERE schemaname = 'public' AND sequencename <> $1 ORDER BY sequencename`, gooseTable+"_id_seq")
	if err != nil {
		return fmt.Errorf("dbx: список последовательностей: %w", err)
	}
	var seqs []string
	for seqRows.Next() {
		var n string
		if err := seqRows.Scan(&n); err != nil {
			_ = seqRows.Close()
			return fmt.Errorf("dbx: список последовательностей: %w", err)
		}
		seqs = append(seqs, n)
	}
	if err := seqRows.Err(); err != nil {
		return fmt.Errorf("dbx: список последовательностей: %w", err)
	}
	_ = seqRows.Close()

	stmts := []string{
		"REVOKE EXECUTE ON ALL FUNCTIONS IN SCHEMA public FROM PUBLIC",
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
	for _, q := range seqs {
		stmts = append(stmts, fmt.Sprintf("GRANT USAGE, SELECT ON SEQUENCE %s TO %s", pgx.Identifier{"public", q}.Sanitize(), role))
	}
	for _, s := range stmts {
		if _, err := tx.ExecContext(ctx, s); err != nil {
			return fmt.Errorf("dbx: права (%s): %w", s, err)
		}
	}
	return tx.Commit()
}
