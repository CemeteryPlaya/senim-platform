package natsx_test

import (
	"bufio"
	"bytes"
	"context"
	"encoding/base64"
	"fmt"
	"log/slog"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/nats-io/nats.go"
	"github.com/nats-io/nats.go/jetstream"

	"github.com/CemeteryPlaya/senim-platform/internal/testnats"
	"github.com/CemeteryPlaya/senim-platform/pkg/config"
	"github.com/CemeteryPlaya/senim-platform/pkg/logging"
	"github.com/CemeteryPlaya/senim-platform/pkg/natsx"
	"github.com/CemeteryPlaya/senim-platform/pkg/outbox"
	"github.com/CemeteryPlaya/senim-platform/pkg/tlsx"
)

var (
	natsEnv *testnats.Env
	certDir string
	devVars map[string]string // пароли стенда: сервер поднят с закоммиченным nats.conf
)

func TestMain(m *testing.M) {
	os.Exit(run(m))
}

func run(m *testing.M) int {
	var err error
	if devVars, err = readVars("../../deploy/compose/dev.vars"); err != nil {
		fmt.Fprintln(os.Stderr, err)
		return 1
	}
	dir, err := os.MkdirTemp("", "natsx-certs")
	if err != nil {
		fmt.Fprintln(os.Stderr, err)
		return 1
	}
	defer func() { _ = os.RemoveAll(dir) }()
	certDir = dir
	if err := writePKI(dir, "nats", "identity", "deal", "web"); err != nil {
		fmt.Fprintln(os.Stderr, err)
		return 1
	}
	ctx, cancel := context.WithTimeout(context.Background(), 3*time.Minute)
	natsEnv, err = testnats.StartSecure(ctx, dir)
	cancel()
	if err != nil {
		fmt.Fprintln(os.Stderr, err)
		return 1
	}
	defer natsEnv.Terminate()
	return m.Run()
}

func readVars(path string) (map[string]string, error) {
	f, err := os.Open(path)
	if err != nil {
		return nil, err
	}
	defer func() { _ = f.Close() }()
	res := map[string]string{}
	sc := bufio.NewScanner(f)
	for sc.Scan() {
		line := strings.TrimSpace(sc.Text())
		if k, v, ok := strings.Cut(line, "="); ok && !strings.HasPrefix(line, "#") {
			res[k] = v
		}
	}
	return res, sc.Err()
}

func password(t *testing.T, service string) string {
	t.Helper()
	pw := devVars[strings.ToUpper(service)+"_NATS_PASSWORD"]
	if pw == "" {
		t.Fatalf("dev.vars: нет пароля NATS для %s", service)
	}
	return pw
}

// writePKI пишет ca.pem и <name>.pem/<name>-key.pem (SAN name и localhost).
func writePKI(dir string, names ...string) error {
	caCert, caKey, err := tlsx.NewCA("test-ca", time.Hour)
	if err != nil {
		return err
	}
	if err := os.WriteFile(filepath.Join(dir, "ca.pem"), caCert, 0o600); err != nil {
		return err
	}
	for _, n := range names {
		c, k, err := tlsx.Issue(caCert, caKey, n, []string{n, "localhost"}, time.Hour)
		if err != nil {
			return err
		}
		if err := os.WriteFile(filepath.Join(dir, n+".pem"), c, 0o600); err != nil {
			return err
		}
		if err := os.WriteFile(filepath.Join(dir, n+"-key.pem"), k, 0o600); err != nil {
			return err
		}
	}
	return nil
}

func cfgFor(cert, user, password string) natsx.Config {
	return natsx.Config{
		URL:      natsEnv.URL,
		User:     user,
		Password: password,
		CertFile: filepath.Join(certDir, cert+".pem"),
		KeyFile:  filepath.Join(certDir, cert+"-key.pem"),
		CAFile:   filepath.Join(certDir, "ca.pem"),
	}
}

type syncBuf struct {
	mu sync.Mutex
	b  bytes.Buffer
}

func (s *syncBuf) Write(p []byte) (int, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	return s.b.Write(p)
}

func (s *syncBuf) String() string {
	s.mu.Lock()
	defer s.mu.Unlock()
	return s.b.String()
}

func connect(t *testing.T, cfg natsx.Config, service string) (*nats.Conn, *syncBuf) {
	t.Helper()
	logs := &syncBuf{}
	nc, err := natsx.Connect(cfg, service, logging.New(logs, service, slog.LevelDebug))
	if err != nil {
		t.Fatalf("Connect %s: %v", service, err)
	}
	t.Cleanup(nc.Close)
	return nc, logs
}

// Учётная запись identity: свой поток и свои субъекты — можно.
func TestServicePublishesOwnEvents(t *testing.T) {
	nc, _ := connect(t, cfgFor("identity", "identity", password(t, "identity")), "identity")
	js, err := jetstream.New(nc)
	if err != nil {
		t.Fatal(err)
	}
	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()
	if _, err := outbox.EnsureStream(ctx, js, "identity"); err != nil {
		t.Fatalf("EnsureStream identity: %v", err)
	}
	// Второй раз — путь UPDATE.
	if _, err := outbox.EnsureStream(ctx, js, "identity"); err != nil {
		t.Fatalf("EnsureStream identity (update): %v", err)
	}
	if _, err := js.Publish(ctx, "senim.identity.user_created", []byte("x")); err != nil {
		t.Fatalf("publish senim.identity.*: %v", err)
	}
}

// Чужие субъекты, чужой поток и широкая подписка запрещены сервером.
func TestServiceCannotActForOthers(t *testing.T) {
	nc, logs := connect(t, cfgFor("identity", "identity", password(t, "identity")), "identity")
	js, err := jetstream.New(nc)
	if err != nil {
		t.Fatal(err)
	}
	ctx, cancel := context.WithTimeout(context.Background(), 3*time.Second)
	defer cancel()
	if _, err := outbox.EnsureStream(ctx, js, "deal"); err == nil {
		t.Fatal("identity создал поток deal")
	}
	if err := nc.Publish("senim.deal.offer_concluded", []byte("forged")); err != nil {
		t.Fatal(err)
	}
	if _, err := nc.SubscribeSync("senim.>"); err != nil {
		t.Fatal(err)
	}
	if _, err := nc.SubscribeSync("_INBOX_deal.>"); err != nil {
		t.Fatal(err)
	}
	_ = nc.Flush()
	want := []string{
		`Publish to \"$JS.API.STREAM.UPDATE.SENIM_DEAL\"`,
		`Publish to \"senim.deal.offer_concluded\"`,
		`Subscription to \"senim.>\"`,
		`Subscription to \"_INBOX_deal.>\"`,
	}
	deadline := time.Now().Add(5 * time.Second)
	for {
		out := logs.String()
		missing := ""
		for _, w := range want {
			if !strings.Contains(out, "Permissions Violation") || !strings.Contains(out, w) {
				missing = w
				break
			}
		}
		if missing == "" {
			break
		}
		if time.Now().After(deadline) {
			t.Fatalf("нет нарушения прав для %s в логе:\n%s", missing, out)
		}
		time.Sleep(50 * time.Millisecond)
	}
}

// Без учётной записи, с чужим паролем, без клиентского сертификата и без TLS — отказ.
func TestServerRejectsUnauthenticated(t *testing.T) {
	cases := map[string]natsx.Config{
		"без учётной записи": cfgFor("identity", "", ""),
		"чужой пароль":       cfgFor("identity", "identity", password(t, "deal")),
		"неизвестный":        cfgFor("web", "web", "placeholder"),
	}
	for name, cfg := range cases {
		nc, err := natsx.Connect(cfg, "identity", nil)
		if err == nil {
			nc.Close()
			t.Errorf("%s: подключение принято", name)
		}
	}
	ok := cfgFor("identity", "identity", password(t, "identity"))
	if nc, err := nats.Connect(natsEnv.URL, nats.UserInfo(ok.User, ok.Password), nats.RootCAs(ok.CAFile)); err == nil {
		nc.Close()
		t.Error("без клиентского сертификата: подключение принято")
	}
	plain := strings.Replace(natsEnv.URL, "tls://", "nats://", 1)
	if nc, err := nats.Connect(plain, nats.UserInfo(ok.User, ok.Password)); err == nil {
		nc.Close()
		t.Error("без TLS: подключение принято")
	}
}

func source(m map[string]string) config.Source {
	return func(k string) (string, bool) { v, ok := m[k]; return v, ok }
}

func TestLoadStrictOutsideDev(t *testing.T) {
	placeholder := base64.StdEncoding.EncodeToString(bytes.Repeat([]byte{'x'}, 32))
	for _, env := range []string{"staging", "prod"} {
		l := config.NewLoader(source(map[string]string{"APP_ENV": env, "NATS_URL": "nats://nats:4222"}))
		natsx.Load(l, "c", "k", "ca")
		err := l.Err()
		for _, key := range []string{"NATS_URL", "NATS_USER", "NATS_PASSWORD"} {
			if err == nil || !strings.Contains(err.Error(), key) {
				t.Errorf("%s: ошибка должна назвать %s: %v", env, key, err)
			}
		}
		l = config.NewLoader(source(map[string]string{"APP_ENV": env, "NATS_URL": "tls://nats:4222", "NATS_USER": "identity", "NATS_PASSWORD": "short"}))
		natsx.Load(l, "c", "k", "ca")
		if err := l.Err(); err == nil || !strings.Contains(err.Error(), "NATS_PASSWORD") {
			t.Errorf("%s: слабый пароль: %v", env, err)
		}
		l = config.NewLoader(source(map[string]string{"APP_ENV": env, "NATS_URL": "tls://nats:4222", "NATS_USER": "identity", "NATS_PASSWORD": placeholder}))
		c := natsx.Load(l, "c", "k", "ca")
		if err := l.Err(); err != nil {
			t.Errorf("%s: верная конфигурация: %v", env, err)
		}
		if c.Password != placeholder || c.User != "identity" || c.CertFile != "c" {
			t.Errorf("%s: %+v", env, c)
		}
	}
}

func TestLoadDev(t *testing.T) {
	l := config.NewLoader(source(map[string]string{"APP_ENV": "dev", "NATS_URL": "nats://127.0.0.1:4222"}))
	if c := natsx.Load(l, "c", "k", "ca"); c.User != "" || l.Err() != nil {
		t.Fatalf("dev без учётной записи: %+v %v", c, l.Err())
	}
	l = config.NewLoader(source(map[string]string{"APP_ENV": "dev", "NATS_URL": "tls://nats:4222", "NATS_USER": "identity"}))
	natsx.Load(l, "c", "k", "ca")
	if err := l.Err(); err == nil || !strings.Contains(err.Error(), "NATS_PASSWORD") {
		t.Fatalf("dev: NATS_USER без пароля: %v", err)
	}
}
