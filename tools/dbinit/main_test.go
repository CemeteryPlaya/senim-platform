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
	defer f.Close()
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
