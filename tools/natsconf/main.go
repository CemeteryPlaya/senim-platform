// Команда natsconf генерирует конфиг сервера NATS стенда: TLS с обязательным клиентским
// сертификатом внутреннего CA и учётная запись на каждый Go-сервис с правами по ADR-012.
// Пароли — только dev-заглушки из файла переменных (-vars), как у tools/dbinit.
package main

import (
	"bufio"
	"flag"
	"fmt"
	"io"
	"os"
	"regexp"
	"strings"

	"github.com/CemeteryPlaya/senim-platform/pkg/natsx"
	"github.com/CemeteryPlaya/senim-platform/pkg/outbox"
	"github.com/CemeteryPlaya/senim-platform/tools/services"
)

var nameRe = regexp.MustCompile(`^[a-z][a-z0-9_]{0,30}$`)

func main() {
	out := flag.String("out", "deploy/compose/nats/nats.conf", "куда писать конфиг")
	vars := flag.String("vars", "deploy/compose/dev.vars", "файл с паролями <SVC>_NATS_PASSWORD")
	flag.Parse()
	if err := run(*vars, *out); err != nil {
		fmt.Fprintln(os.Stderr, "natsconf:", err)
		os.Exit(1)
	}
}

func run(varsPath, outPath string) error {
	f, err := os.Open(varsPath)
	if err != nil {
		return fmt.Errorf("файл переменных: %w", err)
	}
	defer func() { _ = f.Close() }()
	passwords, err := parseVars(f)
	if err != nil {
		return err
	}
	conf, err := Generate(services.Go, passwords)
	if err != nil {
		return err
	}
	return os.WriteFile(outPath, []byte(conf), 0o644)
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

// Permissions — что разрешено учётной записи сервиса: публикация только в свои субъекты
// и в API JetStream своего потока (EnsureStream: UPDATE, затем CREATE; INFO), подписка —
// только на свой префикс ответов (подтверждения публикаций и ответы API). Получатели
// событий (план 2) добавят сюда права своих консьюмеров — с тестом на живом NATS.
func Permissions(service string) (publish, subscribe []string) {
	stream := outbox.StreamName(service)
	publish = []string{
		"senim." + service + ".>",
		"$JS.API.STREAM.CREATE." + stream,
		"$JS.API.STREAM.UPDATE." + stream,
		"$JS.API.STREAM.INFO." + stream,
	}
	subscribe = []string{natsx.InboxPrefix(service) + ".>"}
	return publish, subscribe
}

// Generate строит конфиг NATS для сервисов names с паролями <SVC>_NATS_PASSWORD.
func Generate(names []string, passwords map[string]string) (string, error) {
	var b strings.Builder
	b.WriteString(`# Сгенерировано tools/natsconf (go run ./tools/natsconf). Не править руками.
# Права и учётные записи — ADR-012. Пароли — dev-заглушки из deploy/compose/dev.vars.
port: 4222
# Мониторинг (healthcheck контейнера) — только изнутри контейнера.
http: "127.0.0.1:8222"
jetstream {
  store_dir: "/data"
}
# TLS обязателен, клиент предъявляет сертификат внутреннего CA (тот же, что для gRPC).
tls {
  cert_file: "/certs/nats.pem"
  key_file: "/certs/nats-key.pem"
  ca_file: "/certs/ca.pem"
  verify: true
  timeout: 2
}
authorization {
  users: [
`)
	for _, s := range names {
		if !nameRe.MatchString(s) {
			return "", fmt.Errorf("недопустимое имя сервиса %q", s)
		}
		key := strings.ToUpper(s) + "_NATS_PASSWORD"
		pw, ok := passwords[key]
		if !ok || pw == "" || strings.ContainsAny(pw, "\"\\\n'$") {
			return "", fmt.Errorf("нет корректного пароля %s", key)
		}
		pub, sub := Permissions(s)
		fmt.Fprintf(&b, "    {\n      user: %q\n      password: %q\n      permissions: {\n", s, pw)
		fmt.Fprintf(&b, "        publish: { allow: [%s] }\n", quoteAll(pub))
		fmt.Fprintf(&b, "        subscribe: { allow: [%s] }\n", quoteAll(sub))
		b.WriteString("      }\n    }\n")
	}
	b.WriteString("  ]\n}\n")
	return b.String(), nil
}

func quoteAll(xs []string) string {
	q := make([]string, len(xs))
	for i, x := range xs {
		q[i] = fmt.Sprintf("%q", x)
	}
	return strings.Join(q, ", ")
}
