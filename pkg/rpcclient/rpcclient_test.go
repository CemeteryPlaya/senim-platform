package rpcclient_test

import (
	"context"
	"fmt"
	"net"
	"net/http"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"connectrpc.com/connect/v2"
	"connectrpc.com/connect/v2/connecthttp"
	"go.opentelemetry.io/otel"
	"go.opentelemetry.io/otel/propagation"
	"go.opentelemetry.io/otel/trace"

	testingv1 "github.com/CemeteryPlaya/senim-platform/gen/go/senim/testing/v1"
	"github.com/CemeteryPlaya/senim-platform/gen/go/senim/testing/v1/testingv1connect"
	"github.com/CemeteryPlaya/senim-platform/pkg/config"
	"github.com/CemeteryPlaya/senim-platform/pkg/rpcclient"
	"github.com/CemeteryPlaya/senim-platform/pkg/tlsx"
)

// echo отвечает тем, что увидел: остаток дедлайна, имя клиента из сертификата, traceparent.
type echo struct{}

func (echo) Echo(ctx context.Context, _ *testingv1.EchoRequest) (*testingv1.EchoResponse, error) {
	left := time.Duration(-1)
	if d, ok := ctx.Deadline(); ok {
		left = time.Until(d)
	}
	cn := ""
	if si, ok := connecthttp.ServerInfoForContext(ctx); ok && si.TLS() != nil && len(si.TLS().PeerCertificates) > 0 {
		cn = si.TLS().PeerCertificates[0].Subject.CommonName
	}
	tp := ""
	if info, ok := connect.CallInfoForServerContext(ctx); ok {
		tp = info.RequestHeader().Get("traceparent")
	}
	return &testingv1.EchoResponse{Message: fmt.Sprintf("%d|%s|%s", left.Milliseconds(), cn, tp)}, nil
}

type fixture struct {
	cfg rpcclient.Config
	dir string
}

func start(t *testing.T) fixture {
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
		c, k, err := tlsx.Issue(caCert, caKey, name, []string{name, "localhost"}, time.Hour)
		if err != nil {
			t.Fatal(err)
		}
		return write(name+".pem", c), write(name+"-key.pem", k)
	}
	srvCert, srvKey := issue("mesh")
	cliCert, cliKey := issue("deal")
	tlsCfg, err := tlsx.ServerConfig(srvCert, srvKey, caFile, []string{"deal"})
	if err != nil {
		t.Fatal(err)
	}
	srv := connect.NewServer()
	testingv1connect.RegisterEchoServiceHandler(srv, echo{})
	mux := http.NewServeMux()
	connecthttp.Mount(mux, srv)
	ln, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		t.Fatal(err)
	}
	hs := &http.Server{Handler: mux, TLSConfig: tlsCfg, ReadHeaderTimeout: time.Second}
	go func() { _ = hs.ServeTLS(ln, "", "") }()
	t.Cleanup(func() { _ = hs.Close() })
	port := strings.Split(ln.Addr().String(), ":")[1]
	return fixture{
		dir: dir,
		cfg: rpcclient.Config{MeshURL: "https://localhost:" + port, CertFile: cliCert, KeyFile: cliKey, CAFile: caFile},
	}
}

func call(ctx context.Context, t *testing.T, cfg rpcclient.Config) (left time.Duration, cn, tp string) {
	t.Helper()
	c, err := rpcclient.New(cfg)
	if err != nil {
		t.Fatalf("New: %v", err)
	}
	res, err := testingv1connect.NewEchoServiceClient(c).Echo(ctx, &testingv1.EchoRequest{Message: "x"})
	if err != nil {
		t.Fatalf("Echo: %v", err)
	}
	parts := strings.SplitN(res.GetMessage(), "|", 3)
	var ms int64
	if _, err := fmt.Sscan(parts[0], &ms); err != nil {
		t.Fatal(err)
	}
	return time.Duration(ms) * time.Millisecond, parts[1], parts[2]
}

func TestDefaultDeadline5s(t *testing.T) {
	f := start(t)
	left, _, _ := call(context.Background(), t, f.cfg)
	if left <= 3*time.Second || left > rpcclient.DefaultDeadline {
		t.Fatalf("сервер видит дедлайн %v, ждали около 5 с", left)
	}
}

func TestExistingDeadlineKept(t *testing.T) {
	f := start(t)
	ctx, cancel := context.WithTimeout(context.Background(), 2*time.Second)
	defer cancel()
	left, _, _ := call(ctx, t, f.cfg)
	if left <= 0 || left > 2*time.Second {
		t.Fatalf("сервер видит дедлайн %v, ждали не больше 2 с", left)
	}
}

func TestClientPresentsCert(t *testing.T) {
	f := start(t)
	_, cn, _ := call(context.Background(), t, f.cfg)
	if cn != "deal" {
		t.Fatalf("сервер видит клиента %q, ждали deal", cn)
	}
}

func TestTraceparentInjected(t *testing.T) {
	old := otel.GetTextMapPropagator()
	otel.SetTextMapPropagator(propagation.TraceContext{})
	t.Cleanup(func() { otel.SetTextMapPropagator(old) })
	tid, _ := trace.TraceIDFromHex("0af7651916cd43dd8448eb211c80319c")
	sid, _ := trace.SpanIDFromHex("b7ad6b7169203331")
	ctx := trace.ContextWithSpanContext(context.Background(), trace.NewSpanContext(trace.SpanContextConfig{
		TraceID: tid, SpanID: sid, TraceFlags: trace.FlagsSampled,
	}))
	f := start(t)
	_, _, tp := call(ctx, t, f.cfg)
	if !strings.HasPrefix(tp, "00-0af7651916cd43dd8448eb211c80319c-") {
		t.Fatalf("traceparent = %q", tp)
	}
}

func TestRejectsServerOfForeignCA(t *testing.T) {
	f := start(t)
	otherCA, _, err := tlsx.NewCA("other-ca", time.Hour)
	if err != nil {
		t.Fatal(err)
	}
	bad := f.cfg
	bad.CAFile = filepath.Join(f.dir, "other.pem")
	if err := os.WriteFile(bad.CAFile, otherCA, 0o600); err != nil {
		t.Fatal(err)
	}
	c, err := rpcclient.New(bad)
	if err != nil {
		t.Fatal(err)
	}
	ctx, cancel := context.WithTimeout(context.Background(), 3*time.Second)
	defer cancel()
	if _, err := testingv1connect.NewEchoServiceClient(c).Echo(ctx, &testingv1.EchoRequest{}); err == nil {
		t.Fatal("сервер чужого CA принят")
	}
}

func loader(vars map[string]string) *config.Loader {
	return config.NewLoader(func(k string) (string, bool) { v, ok := vars[k]; return v, ok })
}

func TestNonDevRequiresHTTPS(t *testing.T) {
	base := map[string]string{"MESH_URL": "http://mesh:9443", "TLS_CERT_FILE": "c", "TLS_KEY_FILE": "k", "TLS_CA_FILE": "a"}
	with := func(appEnv string, over map[string]string) map[string]string {
		m := map[string]string{"APP_ENV": appEnv}
		for k, v := range base {
			m[k] = v
		}
		for k, v := range over {
			m[k] = v
		}
		return m
	}
	for _, appEnv := range []string{"staging", "prod"} {
		l := loader(with(appEnv, nil))
		rpcclient.Load(l)
		err := l.Err()
		if err == nil || !strings.Contains(err.Error(), "MESH_URL") {
			t.Fatalf("%s: err = %v, ждали ошибку про MESH_URL", appEnv, err)
		}
		if strings.Contains(err.Error(), "mesh:9443") {
			t.Fatalf("ошибка содержит значение: %v", err)
		}
	}
	l := loader(with("dev", nil))
	if cfg := rpcclient.Load(l); l.Err() != nil || cfg.MeshURL != "http://mesh:9443" {
		t.Fatalf("dev по http должен проходить: %v", l.Err())
	}
	l = loader(with("prod", map[string]string{"MESH_URL": "https://mesh:9443"}))
	if rpcclient.Load(l); l.Err() != nil {
		t.Fatalf("prod по https должен проходить: %v", l.Err())
	}
}

func TestHTTPOnlyFromDevLoad(t *testing.T) {
	if _, err := rpcclient.New(rpcclient.Config{MeshURL: "http://mesh:9443"}); err == nil {
		t.Fatal("собранный вручную Config с http:// принят")
	}
	l := loader(map[string]string{"APP_ENV": "dev", "MESH_URL": "http://mesh:9443", "TLS_CERT_FILE": "c", "TLS_KEY_FILE": "k", "TLS_CA_FILE": "a"})
	cfg := rpcclient.Load(l)
	if _, err := rpcclient.New(cfg); err != nil {
		t.Fatalf("Config от Load в dev по http: %v", err)
	}
}

func TestLoadRequiresAll(t *testing.T) {
	l := loader(map[string]string{"APP_ENV": "dev"})
	rpcclient.Load(l)
	err := l.Err()
	if err == nil {
		t.Fatal("ждали ошибки")
	}
	for _, name := range []string{"MESH_URL", "TLS_CERT_FILE", "TLS_KEY_FILE", "TLS_CA_FILE"} {
		if !strings.Contains(err.Error(), name) {
			t.Errorf("ошибка не называет %s: %v", name, err)
		}
	}
}

func TestNewBadURL(t *testing.T) {
	for _, u := range []string{"", "ftp://x", "://"} {
		if _, err := rpcclient.New(rpcclient.Config{MeshURL: u}); err == nil {
			t.Errorf("%q принят", u)
		}
	}
}
