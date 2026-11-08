package identity_test

import (
	"bytes"
	"context"
	"io"
	"net"
	"net/http"
	"os"
	"path/filepath"
	"sync"
	"testing"
	"time"

	"connectrpc.com/connect/v2"
	"connectrpc.com/connect/v2/connecthttp"
	"connectrpc.com/grpchealth/v2"
	"github.com/jackc/pgx/v5"

	"github.com/CemeteryPlaya/senim-platform/internal/testdb"
	"github.com/CemeteryPlaya/senim-platform/internal/testnats"
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

func TestServeBecomesReady(t *testing.T) {
	pg := testdb.StartT(t)
	nt, err := testnats.Start(context.Background())
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(nt.Terminate)

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
		return write(name+".pem", c), write(name+".key", k)
	}
	srvCert, srvKey := issue("identity")
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
	vars := map[string]string{
		"APP_ENV":             "dev",
		"IDENTITY_OWNER_DSN":  pg.OwnerDSN("identity"),
		"IDENTITY_APP_DSN":    pg.AppDSN("identity"),
		"NATS_URL":            nt.URL,
		"TLS_CERT_FILE":       srvCert,
		"TLS_KEY_FILE":        srvKey,
		"TLS_CA_FILE":         caFile,
		"IDENTITY_GRPC_ADDR":  grpcAddr,
		"IDENTITY_PROBE_ADDR": probeAddr,
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

	resp, err := http.Get("http://" + probeAddr + "/readyz") //nolint:noctx // test
	if err != nil {
		t.Fatal(err)
	}
	_, _ = io.Copy(io.Discard, resp.Body)
	_ = resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		t.Fatalf("/readyz = %d", resp.StatusCode)
	}

	// Релей работает на созданном потоке, outbox/inbox созданы миграцией.
	conn, err := pgx.Connect(ctx, vars["IDENTITY_APP_DSN"])
	if err != nil {
		t.Fatal(err)
	}
	defer func() { _ = conn.Close(ctx) }()
	for _, table := range []string{"outbox", "inbox"} {
		var n int
		if err := conn.QueryRow(ctx, "SELECT count(*) FROM "+table).Scan(&n); err != nil {
			t.Fatalf("таблица %s: %v", table, err)
		}
	}
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
