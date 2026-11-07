package server_test

import (
	"bytes"
	"context"
	"crypto/tls"
	"errors"
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

	testingv1 "github.com/CemeteryPlaya/senim-platform/gen/go/senim/testing/v1"
	"github.com/CemeteryPlaya/senim-platform/gen/go/senim/testing/v1/testingv1connect"
	"github.com/CemeteryPlaya/senim-platform/pkg/logging"
	"github.com/CemeteryPlaya/senim-platform/pkg/server"
	"github.com/CemeteryPlaya/senim-platform/pkg/tlsx"
)

const panicText = "secret-panic-text-42"

type echoImpl struct {
	started chan struct{}
	sleep   time.Duration
}

func (e *echoImpl) Echo(_ context.Context, req *testingv1.EchoRequest) (*testingv1.EchoResponse, error) {
	switch req.GetMessage() {
	case "panic":
		panic(panicText)
	case "slow":
		close(e.started)
		time.Sleep(e.sleep)
	}
	return &testingv1.EchoResponse{Message: req.GetMessage()}, nil
}

type env struct {
	grpcAddr, probeAddr string
	transport           *http.Transport
	cancel              context.CancelFunc
	done                chan error
	logs                *syncBuffer
	echo                *echoImpl
}

type syncBuffer struct {
	mu sync.Mutex
	b  bytes.Buffer
}

func (s *syncBuffer) Write(p []byte) (int, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	return s.b.Write(p)
}

func (s *syncBuffer) String() string {
	s.mu.Lock()
	defer s.mu.Unlock()
	return s.b.String()
}

func freeAddr(t *testing.T) string {
	t.Helper()
	l, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		t.Fatal(err)
	}
	defer func() { _ = l.Close() }()
	return l.Addr().String()
}

func start(t *testing.T, ready func(context.Context) error) *env {
	t.Helper()
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
		c, k, err := tlsx.Issue(caCert, caKey, name, []string{"localhost"}, time.Hour)
		if err != nil {
			t.Fatal(err)
		}
		return write(name+".pem", c), write(name+".key", k)
	}
	srvCert, srvKey := issue("server")
	cliCert, cliKey := issue("client")
	clientTLS, err := tlsx.ClientConfig(cliCert, cliKey, caFile)
	if err != nil {
		t.Fatal(err)
	}

	e := &env{
		grpcAddr:  freeAddr(t),
		probeAddr: freeAddr(t),
		transport: &http.Transport{TLSClientConfig: clientTLS, ForceAttemptHTTP2: true},
		done:      make(chan error, 1),
		logs:      &syncBuffer{},
		echo:      &echoImpl{started: make(chan struct{}), sleep: 2 * time.Second},
	}
	ctx, cancel := context.WithCancel(context.Background())
	e.cancel = cancel
	t.Cleanup(func() {
		cancel()
		e.transport.CloseIdleConnections()
		select {
		case err := <-e.done:
			e.done <- err
		case <-time.After(25 * time.Second):
			t.Error("Run did not return")
		}
	})

	opt := server.Options{
		Name:            "test",
		GRPCAddr:        e.grpcAddr,
		ProbeAddr:       e.probeAddr,
		CertFile:        srvCert,
		KeyFile:         srvKey,
		CAFile:          caFile,
		ShutdownTimeout: 20 * time.Second,
		Logger:          logging.New(e.logs, "test", -4),
	}
	go func() {
		e.done <- server.Run(ctx, opt, func(s *connect.Server) error {
			testingv1connect.RegisterEchoServiceHandler(s, e.echo)
			return nil
		}, ready)
	}()
	e.waitListening(t)
	return e
}

func (e *env) waitListening(t *testing.T) {
	t.Helper()
	deadline := time.Now().Add(10 * time.Second)
	for time.Now().Before(deadline) {
		c1, err1 := net.DialTimeout("tcp", e.grpcAddr, 100*time.Millisecond)
		c2, err2 := net.DialTimeout("tcp", e.probeAddr, 100*time.Millisecond)
		if err1 == nil {
			_ = c1.Close()
		}
		if err2 == nil {
			_ = c2.Close()
		}
		if err1 == nil && err2 == nil {
			return
		}
		time.Sleep(20 * time.Millisecond)
	}
	t.Fatal("server did not start listening")
}

func (e *env) rpc(tr *http.Transport) *connect.Client {
	return connect.NewClient(connecthttp.NewTransport(&http.Client{Transport: tr}, "https://"+e.grpcAddr, connecthttp.WithGRPC()))
}

func (e *env) echoClient() testingv1connect.EchoServiceClient {
	return testingv1connect.NewEchoServiceClient(e.rpc(e.transport))
}

func (e *env) probe(t *testing.T, path string) int {
	t.Helper()
	resp, err := http.Get("http://" + e.probeAddr + path) //nolint:noctx // test
	if err != nil {
		t.Fatal(err)
	}
	defer func() { _ = resp.Body.Close() }()
	_, _ = io.Copy(io.Discard, resp.Body)
	return resp.StatusCode
}

func ctx5(t *testing.T) context.Context {
	t.Helper()
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	t.Cleanup(cancel)
	return ctx
}

func TestHealthServingAfterReady(t *testing.T) {
	e := start(t, func(context.Context) error { return nil })
	res, err := grpchealth.NewClient(e.rpc(e.transport)).Check(ctx5(t), &grpchealth.CheckRequest{})
	if err != nil {
		t.Fatalf("health check: %v", err)
	}
	if res.Status != grpchealth.StatusServing {
		t.Fatalf("status = %v, want SERVING", res.Status)
	}
	if got := e.probe(t, "/healthz"); got != http.StatusOK {
		t.Fatalf("/healthz = %d", got)
	}
	if got := e.probe(t, "/readyz"); got != http.StatusOK {
		t.Fatalf("/readyz = %d", got)
	}
}

func TestNotServingUntilReady(t *testing.T) {
	e := start(t, func(context.Context) error { return errors.New("db is down") })
	res, err := grpchealth.NewClient(e.rpc(e.transport)).Check(ctx5(t), &grpchealth.CheckRequest{})
	if err != nil {
		t.Fatalf("health check: %v", err)
	}
	if res.Status != grpchealth.StatusNotServing {
		t.Fatalf("status = %v, want NOT_SERVING", res.Status)
	}
	if got := e.probe(t, "/readyz"); got != http.StatusServiceUnavailable {
		t.Fatalf("/readyz = %d, want 503", got)
	}
	if got := e.probe(t, "/healthz"); got != http.StatusOK {
		t.Fatalf("/healthz = %d, want 200 (process is alive)", got)
	}
}

func TestGRPCPortRejectsPlainAndNoClientCert(t *testing.T) {
	e := start(t, func(context.Context) error { return nil })
	plain := &http.Client{Timeout: 3 * time.Second}
	if resp, err := plain.Get("http://" + e.grpcAddr + "/"); err == nil { //nolint:noctx // test
		_ = resp.Body.Close()
		if resp.StatusCode < http.StatusBadRequest {
			t.Fatalf("plain HTTP on the gRPC port got %d, want rejection", resp.StatusCode)
		}
	}
	noCert := &http.Client{Timeout: 3 * time.Second, Transport: &http.Transport{
		TLSClientConfig: &tls.Config{InsecureSkipVerify: true, MinVersion: tls.VersionTLS13}, //nolint:gosec // test
	}}
	if resp, err := noCert.Get("https://" + e.grpcAddr + "/"); err == nil { //nolint:noctx // test
		_ = resp.Body.Close()
		t.Fatal("connection without client certificate must fail")
	}
}

func TestGracefulShutdown(t *testing.T) {
	e := start(t, func(context.Context) error { return nil })
	client := e.echoClient()

	type result struct {
		msg string
		err error
	}
	slow := make(chan result, 1)
	go func() {
		res, err := client.Echo(ctx5(t), &testingv1.EchoRequest{Message: "slow"})
		if err != nil {
			slow <- result{err: err}
			return
		}
		slow <- result{msg: res.GetMessage()}
	}()
	select {
	case <-e.echo.started:
	case <-time.After(5 * time.Second):
		t.Fatal("slow handler did not start")
	}

	began := time.Now()
	e.cancel()

	// Дождаться закрытия listener: новый вызов обязан дать ошибку соединения.
	deadline := time.Now().Add(3 * time.Second)
	for time.Now().Before(deadline) {
		c, err := net.DialTimeout("tcp", e.grpcAddr, 100*time.Millisecond)
		if err != nil {
			break
		}
		_ = c.Close()
		time.Sleep(20 * time.Millisecond)
	}
	fresh := e.transport.Clone()
	defer fresh.CloseIdleConnections()
	if _, err := testingv1connect.NewEchoServiceClient(e.rpc(fresh)).Echo(ctx5(t), &testingv1.EchoRequest{Message: "after"}); err == nil {
		t.Fatal("call after cancel must fail")
	}

	r := <-slow
	if r.err != nil || r.msg != "slow" {
		t.Fatalf("in-flight call: msg=%q err=%v, want success", r.msg, r.err)
	}
	select {
	case err := <-e.done:
		e.done <- err
		if err != nil {
			t.Fatalf("Run: %v", err)
		}
	case <-time.After(20 * time.Second):
		t.Fatal("Run did not return in 20s")
	}
	if d := time.Since(began); d >= 20*time.Second {
		t.Fatalf("shutdown took %v", d)
	}
}

func TestPanicBecomesInternal(t *testing.T) {
	e := start(t, func(context.Context) error { return nil })
	client := e.echoClient()
	_, err := client.Echo(ctx5(t), &testingv1.EchoRequest{Message: "panic"})
	if err == nil {
		t.Fatal("expected error")
	}
	if got := connect.CodeOf(err); got != connect.CodeInternal {
		t.Fatalf("code = %v, want internal", got)
	}
	if strings.Contains(err.Error(), panicText) {
		t.Fatalf("panic text leaked to client: %v", err)
	}
	// Сервер остался жив, паника со стеком попала в лог.
	if _, err := client.Echo(ctx5(t), &testingv1.EchoRequest{Message: "ok"}); err != nil {
		t.Fatalf("server must survive panic: %v", err)
	}
	logs := e.logs.String()
	if !strings.Contains(logs, panicText) || !strings.Contains(logs, "stack") {
		t.Fatalf("panic with stack not logged: %s", logs)
	}
}

func TestInstanceHeader(t *testing.T) {
	e := start(t, func(context.Context) error { return nil })
	host, _ := os.Hostname()

	ctx, info := connect.NewClientContext(ctx5(t))
	if _, err := e.echoClient().Echo(ctx, &testingv1.EchoRequest{Message: "hi"}); err != nil {
		t.Fatal(err)
	}
	got := info.ResponseHeader().Get("x-senim-instance")
	if got == "" || got != host {
		t.Fatalf("x-senim-instance = %q, want hostname %q", got, host)
	}
}

func TestRequestIsLogged(t *testing.T) {
	e := start(t, func(context.Context) error { return nil })
	if _, err := e.echoClient().Echo(ctx5(t), &testingv1.EchoRequest{Message: "hi"}); err != nil {
		t.Fatal(err)
	}
	logs := e.logs.String()
	for _, want := range []string{"/senim.testing.v1.EchoService/Echo", `"result":"ok"`, "duration_ms"} {
		if !strings.Contains(logs, want) {
			t.Fatalf("log lacks %q: %s", want, logs)
		}
	}
}

func TestInitTelemetryEmptyEndpointIsNoop(t *testing.T) {
	shutdown, err := server.InitTelemetry(context.Background(), "test", "")
	if err != nil {
		t.Fatal(err)
	}
	if err := shutdown(context.Background()); err != nil {
		t.Fatal(err)
	}
}
