package identity_test

import (
	"bytes"
	"context"
	"io"
	"net"
	"net/http"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"testing"
	"time"

	"connectrpc.com/connect/v2"
	"connectrpc.com/connect/v2/connecthttp"
	"connectrpc.com/grpchealth/v2"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/nats-io/nats.go/jetstream"
	"google.golang.org/protobuf/types/known/wrapperspb"

	"github.com/CemeteryPlaya/senim-platform/internal/testdb"
	"github.com/CemeteryPlaya/senim-platform/internal/testnats"
	"github.com/CemeteryPlaya/senim-platform/pkg/dbx"
	"github.com/CemeteryPlaya/senim-platform/pkg/natsx"
	"github.com/CemeteryPlaya/senim-platform/pkg/outbox"
	"github.com/CemeteryPlaya/senim-platform/pkg/server"
	"github.com/CemeteryPlaya/senim-platform/pkg/tlsx"
	"github.com/CemeteryPlaya/senim-platform/services/identity/internal"
)

func freeAddr(t *testing.T) string {
	t.Helper()
	l, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		t.Fatal(err)
	}
	defer func() { _ = l.Close() }()
	return l.Addr().String()
}

// natsPassword — пароль учётной записи identity из dev.vars: NATS в тесте поднят с
// закоммиченным конфигом стенда (deploy/compose/nats/nats.conf).
func natsPassword(t *testing.T) string {
	t.Helper()
	data, err := os.ReadFile("../../deploy/compose/dev.vars")
	if err != nil {
		t.Fatal(err)
	}
	for line := range strings.Lines(string(data)) {
		if v, ok := strings.CutPrefix(strings.TrimSpace(line), "IDENTITY_NATS_PASSWORD="); ok {
			return v
		}
	}
	t.Fatal("dev.vars: нет IDENTITY_NATS_PASSWORD")
	return ""
}

func TestServeBecomesReady(t *testing.T) {
	pg := testdb.StartT(t)

	dir := t.TempDir()
	caCert, caKey, err := tlsx.NewCA("test-ca", time.Hour)
	if err != nil {
		t.Fatal(err)
	}
	write := func(name string, data []byte) string {
		p := filepath.Join(dir, name)
		if err := os.WriteFile(p, data, 0o600); err != nil {
			t.Fatal(err)
		}
		return p
	}
	caFile := write("ca.pem", caCert)
	issue := func(name string) (string, string) {
		c, k, err := tlsx.Issue(caCert, caKey, name, []string{name, "localhost"}, time.Hour)
		if err != nil {
			t.Fatal(err)
		}
		return write(name+".pem", c), write(name+"-key.pem", k)
	}
	srvCert, srvKey := issue("identity")
	// NATS с конфигом стенда: TLS с клиентским сертификатом и учётные записи (ADR-012).
	issue("nats")
	nt, err := testnats.StartSecure(context.Background(), dir)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(nt.Terminate)
	// identity ходит в NATS через прокси: тест обрывает и возвращает связь, сервер NATS и
	// поток при этом живы (как перезапуск NATS или сетевой сбой).
	proxy := startProxy(t, strings.TrimPrefix(nt.URL, "tls://"))
	clientAs := func(name string) *http.Transport {
		cert, key := issue(name)
		cfg, err := tlsx.ClientConfig(cert, key, caFile)
		if err != nil {
			t.Fatal(err)
		}
		tr := &http.Transport{TLSClientConfig: cfg, ForceAttemptHTTP2: true}
		t.Cleanup(tr.CloseIdleConnections)
		return tr
	}

	grpcAddr, probeAddr := freeAddr(t), freeAddr(t)
	vars := map[string]string{ //nolint:gosec // тестовые значения, не секреты
		"APP_ENV":                    "dev",
		"IDENTITY_OWNER_DSN":         pg.OwnerDSN("identity"),
		"IDENTITY_APP_DSN":           pg.AppDSN("identity"),
		"NATS_URL":                   "tls://" + proxy.addr,
		"NATS_USER":                  "identity",
		"NATS_PASSWORD":              natsPassword(t),
		"TLS_CERT_FILE":              srvCert,
		"TLS_KEY_FILE":               srvKey,
		"TLS_CA_FILE":                caFile,
		"IDENTITY_GRPC_ADDR":         grpcAddr,
		"IDENTITY_PROBE_ADDR":        probeAddr,
		"IDENTITY_OTP_PROVIDER":      "mock",
		"IDENTITY_OTP_HMAC_KEY":      "c2VuaW0tdjItZGV2LWlkZW50aXR5LW90cC1obWFjISE=",
		"IDENTITY_TOKEN_SIGNING_KEY": "c2VuaW0tdjItZGV2LWlkZW50aXR5LXRva2VuLWtleSE=",
		"IDENTITY_TOKEN_KID":         "test-1",
	}
	src := func(k string) (string, bool) { v, ok := vars[k]; return v, ok }

	var logs bytes.Buffer
	if code := internal.Main(context.Background(), []string{"migrate"}, src, &logs); code != 0 {
		t.Fatalf("migrate: код %d\n%s", code, logs.String())
	}

	ctx, cancel := context.WithCancel(context.Background())
	done := make(chan int, 1)
	var serveLogs syncBuf
	go func() { done <- internal.Main(ctx, []string{"serve"}, src, &serveLogs) }()
	t.Cleanup(func() {
		cancel()
		select {
		case <-done:
		case <-time.After(30 * time.Second):
			t.Error("serve не остановился")
		}
	})

	healthAs := func(tr *http.Transport) *grpchealth.Client {
		return grpchealth.NewClient(connect.NewClient(connecthttp.NewTransport(&http.Client{Transport: tr}, "https://"+grpcAddr, connecthttp.WithGRPC())))
	}
	// identity принимает только mesh и самого себя (ADR-011).
	hc := healthAs(clientAs("mesh"))

	deadline := time.Now().Add(10 * time.Second)
	for _, name := range []string{"", internal.ServiceName} {
		for {
			rctx, rcancel := context.WithTimeout(ctx, 2*time.Second)
			res, err := hc.Check(rctx, &grpchealth.CheckRequest{Service: name})
			rcancel()
			if err == nil && res.Status == grpchealth.StatusServing {
				break
			}
			if time.Now().After(deadline) {
				t.Fatalf("health %q не SERVING за 10 с: %v\n%s", name, err, serveLogs.String())
			}
			time.Sleep(100 * time.Millisecond)
		}
	}

	// web (и любой другой сертификат того же CA) напрямую не допускается: только через mesh.
	for _, name := range []string{"web", "deal"} {
		rctx, rcancel := context.WithTimeout(ctx, 2*time.Second)
		_, err := healthAs(clientAs(name)).Check(rctx, &grpchealth.CheckRequest{})
		rcancel()
		if err == nil {
			t.Fatalf("сертификат %s принят identity напрямую", name)
		}
	}
	// Своя реплика допускается; вызывающий виден в ответе.
	{
		rctx, rcancel := context.WithTimeout(ctx, 2*time.Second)
		rctx, info := connect.NewClientContext(rctx)
		res, err := healthAs(clientAs("identity")).Check(rctx, &grpchealth.CheckRequest{})
		rcancel()
		if err != nil || res.Status != grpchealth.StatusServing || info.ResponseHeader().Get(server.CallerHeader) != "identity" {
			t.Fatalf("identity → identity: %v %v caller=%q", res, err, info.ResponseHeader().Get(server.CallerHeader))
		}
	}

	// Чужое имя сервиса — NotFound, а не SERVING.
	rctx, rcancel := context.WithTimeout(ctx, 2*time.Second)
	_, err = hc.Check(rctx, &grpchealth.CheckRequest{Service: "senim.deal.v1.DealService"})
	rcancel()
	if connect.CodeOf(err) != connect.CodeNotFound {
		t.Fatalf("health чужого сервиса: %v, want not_found", err)
	}

	if code := probe(t, probeAddr); code != http.StatusOK {
		t.Fatalf("/readyz = %d", code)
	}

	// outbox/inbox созданы миграцией и доступны рабочей роли.
	pool, err := dbx.Connect(ctx, vars["IDENTITY_APP_DSN"], "identity-test", 2)
	if err != nil {
		t.Fatal(err)
	}
	defer pool.Close()
	for _, table := range []string{"outbox", "inbox"} {
		var n int
		if err := pool.QueryRow(ctx, "SELECT count(*) FROM "+table).Scan(&n); err != nil {
			t.Fatalf("таблица %s: %v", table, err)
		}
	}

	// Сбой NATS не снимает готовность: запись идёт в outbox, релей догонит (ADR-012, I3).
	proxy.down()
	var eventID string
	if err := dbx.InTx(ctx, pool, func(tx pgx.Tx) error {
		var err error
		eventID, err = outbox.Add(ctx, tx, "identity", "senim.identity.test_event", "google.protobuf.StringValue", wrapperspb.String("x"))
		return err
	}); err != nil {
		t.Fatalf("outbox.Add: %v", err)
	}
	for range 5 {
		if code := probe(t, probeAddr); code != http.StatusOK {
			t.Fatalf("/readyz при недоступном NATS = %d, want 200\n%s", code, serveLogs.String())
		}
		rctx, rcancel := context.WithTimeout(ctx, 2*time.Second)
		res, err := hc.Check(rctx, &grpchealth.CheckRequest{Service: internal.ServiceName})
		rcancel()
		if err != nil || res.Status != grpchealth.StatusServing {
			t.Fatalf("health при недоступном NATS: %v %v", res, err)
		}
		time.Sleep(400 * time.Millisecond)
	}
	if published(t, pool, eventID) {
		t.Fatal("событие опубликовано, хотя NATS недоступен: прокси не оборвал связь")
	}

	// Связь вернулась — релей публикует отложенную запись в поток identity.
	proxy.up()
	deadline = time.Now().Add(20 * time.Second)
	for !published(t, pool, eventID) {
		if time.Now().After(deadline) {
			t.Fatalf("релей не опубликовал событие за 20 с после возврата NATS\n%s", serveLogs.String())
		}
		time.Sleep(200 * time.Millisecond)
	}
	if msgs := streamMsgs(t, nt.URL, dir); msgs < 1 {
		t.Fatalf("в потоке %s сообщений %d, want ≥ 1", outbox.StreamName("identity"), msgs)
	}
	for _, want := range []string{"nats: соединение потеряно", "nats: соединение восстановлено"} {
		if !strings.Contains(serveLogs.String(), want) {
			t.Errorf("нет записи %q в логе serve:\n%s", want, serveLogs.String())
		}
	}
}

func probe(t *testing.T, addr string) int {
	t.Helper()
	resp, err := http.Get("http://" + addr + "/readyz") //nolint:noctx // test
	if err != nil {
		t.Fatal(err)
	}
	_, _ = io.Copy(io.Discard, resp.Body)
	_ = resp.Body.Close()
	return resp.StatusCode
}

func published(t *testing.T, pool *pgxpool.Pool, id string) bool {
	t.Helper()
	var ok bool
	if err := pool.QueryRow(context.Background(), `SELECT published_at IS NOT NULL FROM outbox WHERE id = $1`, id).Scan(&ok); err != nil {
		t.Fatal(err)
	}
	return ok
}

// streamMsgs — число сообщений в потоке identity (STREAM.INFO разрешён учётной записи identity).
func streamMsgs(t *testing.T, url, dir string) uint64 {
	t.Helper()
	nc, err := natsx.Connect(natsx.Config{
		URL: url, User: "identity", Password: natsPassword(t),
		CertFile: filepath.Join(dir, "identity.pem"), KeyFile: filepath.Join(dir, "identity-key.pem"), CAFile: filepath.Join(dir, "ca.pem"),
	}, "identity", nil)
	if err != nil {
		t.Fatal(err)
	}
	defer nc.Close()
	js, err := jetstream.New(nc)
	if err != nil {
		t.Fatal(err)
	}
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	st, err := js.Stream(ctx, outbox.StreamName("identity"))
	if err != nil {
		t.Fatal(err)
	}
	info, err := st.Info(ctx)
	if err != nil {
		t.Fatal(err)
	}
	return info.State.Msgs
}

// tcpProxy — TCP-прокси до NATS: down закрывает порт и рвёт соединения, up открывает тот же порт.
type tcpProxy struct {
	t      *testing.T
	addr   string
	target string
	mu     sync.Mutex
	ln     net.Listener
	conns  []net.Conn
}

func startProxy(t *testing.T, target string) *tcpProxy {
	t.Helper()
	p := &tcpProxy{t: t, target: target}
	ln, err := net.Listen("tcp", "localhost:0")
	if err != nil {
		t.Fatal(err)
	}
	p.addr = ln.Addr().String()
	p.serve(ln)
	t.Cleanup(p.down)
	return p
}

func (p *tcpProxy) serve(ln net.Listener) {
	p.mu.Lock()
	p.ln = ln
	p.mu.Unlock()
	go func() {
		for {
			c, err := ln.Accept()
			if err != nil {
				return
			}
			u, err := net.Dial("tcp", p.target)
			if err != nil {
				_ = c.Close()
				continue
			}
			p.mu.Lock()
			p.conns = append(p.conns, c, u)
			p.mu.Unlock()
			go func() { _, _ = io.Copy(u, c); _ = u.Close() }()
			go func() { _, _ = io.Copy(c, u); _ = c.Close() }()
		}
	}()
}

func (p *tcpProxy) down() {
	p.mu.Lock()
	defer p.mu.Unlock()
	if p.ln != nil {
		_ = p.ln.Close()
		p.ln = nil
	}
	for _, c := range p.conns {
		_ = c.Close()
	}
	p.conns = nil
}

func (p *tcpProxy) up() {
	ln, err := net.Listen("tcp", p.addr)
	if err != nil {
		p.t.Fatalf("прокси: снова слушать %s: %v", p.addr, err)
	}
	p.serve(ln)
}

func TestMissingConfigFailsClearly(t *testing.T) {
	src := func(k string) (string, bool) {
		if k == "APP_ENV" {
			return "dev", true
		}
		return "", false
	}
	for _, cmd := range []string{"serve", "migrate"} {
		var logs bytes.Buffer
		if code := internal.Main(context.Background(), []string{cmd}, src, &logs); code == 0 {
			t.Fatalf("%s без переменных завершился кодом 0", cmd)
		}
		if !bytes.Contains(logs.Bytes(), []byte("DSN")) {
			t.Fatalf("%s: сообщение не называет переменную: %s", cmd, logs.String())
		}
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

func TestHealthcheckCommand(t *testing.T) {
	status := http.StatusOK
	var mu sync.Mutex
	probe := &http.Server{ReadHeaderTimeout: time.Second, Handler: http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		mu.Lock()
		defer mu.Unlock()
		if r.URL.Path != "/readyz" {
			w.WriteHeader(http.StatusNotFound)
			return
		}
		w.WriteHeader(status)
	})}
	ln, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		t.Fatal(err)
	}
	go func() { _ = probe.Serve(ln) }()
	t.Cleanup(func() { _ = probe.Close() })

	src := func(k string) (string, bool) {
		switch k {
		case "APP_ENV":
			return "dev", true
		case "IDENTITY_PROBE_ADDR":
			return ln.Addr().String(), true
		}
		return "", false
	}
	var logs bytes.Buffer
	if code := internal.Main(context.Background(), []string{"healthcheck"}, src, &logs); code != 0 {
		t.Fatalf("готовый сервис: код %d\n%s", code, logs.String())
	}
	mu.Lock()
	status = http.StatusServiceUnavailable
	mu.Unlock()
	if code := internal.Main(context.Background(), []string{"healthcheck"}, src, &logs); code == 0 {
		t.Fatal("неготовый сервис: код 0")
	}
}
