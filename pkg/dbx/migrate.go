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
// Второй маркер — право удаления:
//
//	-- senim:app-delete sessions
//
// Роль <svc>_app получает на такую таблицу ещё и DELETE (для очистки по сроку хранения
// и сброса демо). Без маркера DELETE запрещён. Разбор тот же, что у append-only:
// опечатки («senim:app_delete», «SENIM:APP-DELETE», «senim app-delete», ...) и
// несуществующая таблица — ошибка. Таблица с обоими маркерами — ошибка: append-only
// означает отсутствие UPDATE и DELETE.
//
// Внимание: внешний ключ с ON DELETE CASCADE / SET NULL (или ON UPDATE CASCADE) от
// append-only таблицы на app-delete таблицу обходит append-only: ссылочные действия
// выполняются с правами владельца таблицы. Таких ключей не заводить.
//
// Разбор двухступенчатый и закрыт по умолчанию: свободный регистронезависимый шаблон
// находит любую строку-комментарий, похожую на директиву, — «senim:» в любом
// регистре и с пробелами («SENIM:APPEND-ONLY», «senim :append-only», «senim:readonly»),
// строку, начинающуюся с append-only/append_only/appendonly, а также любую строку-
// комментарий, где есть и senim, и append («senim append-only», «senim.append-only»).
// Каждая такая
// строка обязана точно совпасть со строгой формой (маленькие буквы, одно имя таблицы
// без схемы, запятых и комментариев). Иначе — ошибка, а не обычная таблица с UPDATE.
// Слово append-only внутри обычной фразы маркером не считается.
var (
	suspectRe = regexp.MustCompile(`(?im)^[ \t]*--[ \t]*(?:senim[ \t]*:|append[ \t_-]*only\b|\w+[ \t]*:[ \t]*append[ \t_-]*only|.*senim.*append|.*append.*senim|app[ \t_-]*delete\b|\w+[ \t]*:[ \t]*app[ \t_-]*delete|.*senim.*delete|.*delete.*senim).*$`)
	markerRe  = regexp.MustCompile(`^[ \t]*--[ \t]*senim:append-only[ \t]+([a-z_][a-z0-9_]*)[ \t]*\r?$`)
	deleteRe  = regexp.MustCompile(`^[ \t]*--[ \t]*senim:app-delete[ \t]+([a-z_][a-z0-9_]*)[ \t]*\r?$`)
	serviceRe = regexp.MustCompile(`^[a-z][a-z0-9_]{0,30}$`)
)

// advisoryLockID — один ключ у goose (сессионная блокировка) и у транзакции выдачи
// прав: параллельные Migrate одной базы не гоняются.
var advisoryLockID = lock.DefaultLockID

// gooseTable — служебная таблица версий; рабочая роль к ней доступа не получает.
const gooseTable = "goose_db_version"

// Migrate применяет миграции сервиса от имени владельца базы (ownerDSN, роль
// <service>_owner) и выдаёт рабочей роли <service>_app минимально нужные права.
//
// Права: SELECT, INSERT, UPDATE на таблицы public (SELECT, INSERT на append-only,
// плюс DELETE на таблицы с маркером senim:app-delete),
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
	markers, err := findMarkers(migrations, platformSchemas)
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
	return grant(ctx, db, service+"_app", markers)
}

// markers — таблицы с маркерами из миграций.
type markers struct{ appendOnly, appDelete map[string]bool }

func findMarkers(migrations fs.FS, extra []string) (markers, error) {
	res := markers{appendOnly: map[string]bool{}, appDelete: map[string]bool{}}
	var bad []string
	add := func(where, src string) {
		for _, line := range suspectRe.FindAllString(src, -1) {
			if t := markerRe.FindStringSubmatch(line); t != nil {
				res.appendOnly[t[1]] = true
			} else if t := deleteRe.FindStringSubmatch(line); t != nil {
				res.appDelete[t[1]] = true
			} else {
				bad = append(bad, fmt.Sprintf("%s: %q", where, strings.TrimSpace(line)))
			}
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
		return markers{}, fmt.Errorf("dbx: чтение миграций: %w", err)
	}
	if len(bad) > 0 {
		return markers{}, fmt.Errorf("dbx: неверный маркер senim:append-only или senim:app-delete (нужно «-- senim:append-only <таблица>» или «-- senim:app-delete <таблица>»): %s", strings.Join(bad, "; "))
	}
	var both []string
	for t := range res.appendOnly {
		if res.appDelete[t] {
			both = append(both, t)
		}
	}
	if len(both) > 0 {
		sort.Strings(both)
		return markers{}, fmt.Errorf("dbx: таблица помечена и senim:append-only, и senim:app-delete (append-only запрещает DELETE): %s", strings.Join(both, ", "))
	}
	return res, nil
}

func grant(ctx context.Context, db *sql.DB, appRole string, mk markers) error {
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
	for _, kind := range []struct {
		name   string
		tables map[string]bool
	}{{"senim:append-only", mk.appendOnly}, {"senim:app-delete", mk.appDelete}} {
		var missing []string
		for t := range kind.tables {
			if !existing[t] {
				missing = append(missing, t)
			}
		}
		if len(missing) > 0 {
			sort.Strings(missing)
			return fmt.Errorf("dbx: %s указывает на несуществующие таблицы: %s", kind.name, strings.Join(missing, ", "))
		}
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
		switch {
		case mk.appendOnly[t]:
			privs = "SELECT, INSERT"
		case mk.appDelete[t]:
			privs = "SELECT, INSERT, UPDATE, DELETE"
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
