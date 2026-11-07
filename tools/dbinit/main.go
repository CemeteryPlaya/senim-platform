// Команда dbinit генерирует init-скрипт Postgres: по базе на сервис и пара ролей
// <svc>_owner (владелец, применяет миграции) и <svc>_app (рабочая роль без DDL).
// Пароли — только dev-заглушки из файла переменных (-vars).
package main

import (
	"bufio"
	"flag"
	"fmt"
	"io"
	"os"
	"regexp"
	"strings"
)

const defaultServices = "identity,deal,marketplace,documents,files,notify,operator,audit"

var identRe = regexp.MustCompile(`^[a-z][a-z0-9_]{0,30}$`)

func main() {
	services := flag.String("services", defaultServices, "список сервисов через запятую")
	out := flag.String("out", "deploy/compose/postgres/init/00-roles.sql", "куда писать SQL")
	vars := flag.String("vars", "deploy/compose/dev.vars", "файл с паролями <SVC>_OWNER_PASSWORD и <SVC>_APP_PASSWORD")
	flag.Parse()

	if err := run(*services, *vars, *out); err != nil {
		fmt.Fprintln(os.Stderr, "dbinit:", err)
		os.Exit(1)
	}
}

func run(services, varsPath, outPath string) error {
	f, err := os.Open(varsPath)
	if err != nil {
		return fmt.Errorf("файл переменных: %w", err)
	}
	defer func() { _ = f.Close() }()
	passwords, err := parseVars(f)
	if err != nil {
		return err
	}
	sql, err := Generate(strings.Split(services, ","), passwords)
	if err != nil {
		return err
	}
	return os.WriteFile(outPath, []byte(sql), 0o644)
}

func parseVars(r io.Reader) (map[string]string, error) {
	res := map[string]string{}
	sc := bufio.NewScanner(r)
	for sc.Scan() {
		line := strings.TrimSpace(sc.Text())
		if line == "" || strings.HasPrefix(line, "#") {
			continue
		}
		k, v, ok := strings.Cut(line, "=")
		if !ok {
			return nil, fmt.Errorf("строка без '=': %q", line)
		}
		res[strings.TrimSpace(k)] = strings.TrimSpace(v)
	}
	return res, sc.Err()
}

// Generate строит SQL. Скрипт выполняется суперпользователем postgres при инициализации;
// \connect — мета-команда psql, поэтому файл подходит для docker-entrypoint-initdb.d.
func Generate(services []string, passwords map[string]string) (string, error) {
	var b strings.Builder
	b.WriteString("-- Сгенерировано tools/dbinit. Не править руками.\n")
	b.WriteString(`\set ON_ERROR_STOP on` + "\n")
	// Служебные базы по умолчанию доступны всем ролям; рабочим ролям там делать нечего.
	b.WriteString("REVOKE CONNECT, TEMPORARY ON DATABASE postgres, template1 FROM PUBLIC;\n")
	for _, s := range services {
		s = strings.TrimSpace(s)
		if !identRe.MatchString(s) {
			return "", fmt.Errorf("недопустимое имя сервиса %q", s)
		}
		prefix := strings.ToUpper(s)
		owner, ok1 := passwords[prefix+"_OWNER_PASSWORD"]
		app, ok2 := passwords[prefix+"_APP_PASSWORD"]
		if !ok1 || !ok2 || strings.ContainsAny(owner+app, "'\n\\") || owner == "" || app == "" {
			return "", fmt.Errorf("нет корректных паролей %s_OWNER_PASSWORD/%s_APP_PASSWORD", prefix, prefix)
		}
		fmt.Fprintf(&b, `
-- %[1]s
CREATE ROLE %[1]s_owner LOGIN PASSWORD '%[2]s' NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS;
CREATE ROLE %[1]s_app LOGIN PASSWORD '%[3]s' NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS;
CREATE DATABASE %[1]s OWNER %[1]s_owner;
REVOKE ALL ON DATABASE %[1]s FROM PUBLIC;
GRANT CONNECT ON DATABASE %[1]s TO %[1]s_owner, %[1]s_app;
\connect %[1]s
ALTER SCHEMA public OWNER TO %[1]s_owner;
REVOKE ALL ON SCHEMA public FROM PUBLIC;
GRANT USAGE ON SCHEMA public TO %[1]s_app;
\connect postgres
`, s, owner, app)
	}
	return b.String(), nil
}
