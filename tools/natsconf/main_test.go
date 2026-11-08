package main

import (
	"os"
	"strings"
	"testing"

	"github.com/CemeteryPlaya/senim-platform/tools/services"
)

func devVars(t *testing.T) map[string]string {
	t.Helper()
	f, err := os.Open("../../deploy/compose/dev.vars")
	if err != nil {
		t.Fatal(err)
	}
	defer func() { _ = f.Close() }()
	vars, err := parseVars(f)
	if err != nil {
		t.Fatal(err)
	}
	return vars
}

// Закоммиченный nats.conf должен совпадать с выводом генератора байт в байт.
func TestCommittedConfMatchesGenerator(t *testing.T) {
	got, err := Generate(services.Go, devVars(t))
	if err != nil {
		t.Fatal(err)
	}
	want, err := os.ReadFile("../../deploy/compose/nats/nats.conf")
	if err != nil {
		t.Fatal(err)
	}
	if got != string(want) {
		t.Fatal("deploy/compose/nats/nats.conf устарел: выполните go run ./tools/natsconf")
	}
}

// Сервис публикует только в свои субъекты и в API своего потока; подписка — только свой inbox.
func TestPermissionsAreOwnOnly(t *testing.T) {
	pub, sub := Permissions("identity")
	for _, p := range pub {
		if !strings.HasPrefix(p, "senim.identity.") && !strings.HasSuffix(p, ".SENIM_IDENTITY") {
			t.Errorf("publish %q — не своё", p)
		}
		if strings.Contains(p, "*") || p == ">" || strings.HasPrefix(p, "$JS.API.>") {
			t.Errorf("publish %q — шаблон шире своего", p)
		}
	}
	if len(sub) != 1 || sub[0] != "_INBOX_identity.>" {
		t.Errorf("subscribe = %v", sub)
	}
}

func TestGenerateRejectsBadInput(t *testing.T) {
	if _, err := Generate([]string{"identity"}, map[string]string{}); err == nil {
		t.Error("нет пароля: ожидалась ошибка")
	}
	if _, err := Generate([]string{"identity"}, map[string]string{"IDENTITY_NATS_PASSWORD": `a"b`}); err == nil {
		t.Error("кавычка в пароле: ожидалась ошибка")
	}
	if _, err := Generate([]string{"Bad"}, map[string]string{"BAD_NATS_PASSWORD": "x"}); err == nil {
		t.Error("плохое имя: ожидалась ошибка")
	}
}
