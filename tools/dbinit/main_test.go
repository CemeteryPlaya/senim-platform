package main

import (
	"os"
	"strings"
	"testing"
)

// Закоммиченный 00-roles.sql должен совпадать с выводом генератора байт в байт.
func TestCommittedRolesSQLMatchesGenerator(t *testing.T) {
	f, err := os.Open("../../deploy/compose/dev.vars")
	if err != nil {
		t.Fatal(err)
	}
	defer func() { _ = f.Close() }()
	pw, err := parseVars(f)
	if err != nil {
		t.Fatal(err)
	}
	got, err := Generate(strings.Split(defaultServices, ","), pw)
	if err != nil {
		t.Fatal(err)
	}
	want, err := os.ReadFile("../../deploy/compose/postgres/init/00-roles.sql")
	if err != nil {
		t.Fatal(err)
	}
	if got != string(want) {
		t.Fatal("00-roles.sql устарел: выполните go run ./tools/dbinit")
	}
}

// 01-web.sql пишется руками; пароль роли web должен совпадать с WEB_DB_PASSWORD из dev.vars.
func TestWebInitPasswordMatchesVars(t *testing.T) {
	f, err := os.Open("../../deploy/compose/dev.vars")
	if err != nil {
		t.Fatal(err)
	}
	defer func() { _ = f.Close() }()
	vars, err := parseVars(f)
	if err != nil {
		t.Fatal(err)
	}
	pw := vars["WEB_DB_PASSWORD"]
	if pw == "" {
		t.Fatal("в dev.vars нет WEB_DB_PASSWORD")
	}
	sql, err := os.ReadFile("../../deploy/compose/postgres/init/01-web.sql")
	if err != nil {
		t.Fatal(err)
	}
	if !strings.Contains(string(sql), "CREATE ROLE web LOGIN PASSWORD '"+pw+"' ") {
		t.Fatal("01-web.sql: пароль роли web не совпадает с WEB_DB_PASSWORD в dev.vars")
	}
}
