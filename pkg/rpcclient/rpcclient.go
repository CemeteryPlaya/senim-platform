// Package rpcclient — клиент gRPC к mesh-gateway (Envoy) для Go-сервисов: mTLS с
// сертификатом сервиса, HTTP/2, протокол gRPC, дедлайн по умолчанию 5 с и traceparent.
// Правила те же, что у TS-клиента apps/web/src/platform/rpc.ts.
//
// Использование:
//
//	cfg := rpcclient.Load(loader) // MESH_URL, TLS_CERT_FILE, TLS_KEY_FILE, TLS_CA_FILE
//	if err := loader.Err(); err != nil { ... }
//	mesh, err := rpcclient.New(cfg)
//	if err != nil { ... }
//	identity := identityv1connect.NewIdentityServiceClient(mesh)
//	res, err := identity.GetSigningKeys(ctx, &identityv1.GetSigningKeysRequest{})
//
// Один *connect.Client можно делить между клиентами разных сервисов.
package rpcclient

import (
	"context"
	"errors"
	"fmt"
	"net"
	"net/http"
	"net/url"
	"strings"
	"time"

	"connectrpc.com/connect/v2"
	"connectrpc.com/connect/v2/connecthttp"
	"go.opentelemetry.io/otel"
	"go.opentelemetry.io/otel/propagation"

	"github.com/CemeteryPlaya/senim-platform/pkg/config"
	"github.com/CemeteryPlaya/senim-platform/pkg/tlsx"
)

// DefaultDeadline — дедлайн вызова, у которого в контексте его нет (CLAUDE.md: ни одного
// вызова без дедлайна).
const DefaultDeadline = 5 * time.Second

// Config — настройки клиента mesh.
type Config struct {
	MeshURL  string // адрес mesh-gateway, https:// (http:// только в dev)
	CertFile string // сертификат сервиса
	KeyFile  string // ключ сертификата
	CAFile   string // корневой сертификат mesh
}

// Load читает MESH_URL и TLS_CERT_FILE, TLS_KEY_FILE, TLS_CA_FILE. Все обязательны; вне
// dev MESH_URL — только https://. Ошибки копятся в l и называют переменные, не значения.
func Load(l *config.Loader) Config {
	c := Config{
		MeshURL:  l.Required("MESH_URL"),
		CertFile: l.Required("TLS_CERT_FILE"),
		KeyFile:  l.Required("TLS_KEY_FILE"),
		CAFile:   l.Required("TLS_CA_FILE"),
	}
	if c.MeshURL != "" && l.Env() != config.Dev && !strings.HasPrefix(c.MeshURL, "https://") {
		l.Invalid("MESH_URL", "must start with https:// outside dev")
	}
	return c
}

// New собирает клиент mesh. Для https:// это mTLS (tlsx.ClientConfig) и HTTP/2; для
// http:// (dev) — HTTP/2 без шифрования (h2c), сертификаты не используются. Протокол — gRPC.
func New(cfg Config) (*connect.Client, error) {
	u, err := url.Parse(cfg.MeshURL)
	if err != nil || u.Host == "" {
		return nil, errors.New("rpcclient: MESH_URL is not a valid URL")
	}
	tr := &http.Transport{
		DialContext:           (&net.Dialer{Timeout: DefaultDeadline, KeepAlive: 30 * time.Second}).DialContext,
		TLSHandshakeTimeout:   DefaultDeadline,
		IdleConnTimeout:       90 * time.Second,
		ResponseHeaderTimeout: 0, // сроки задаёт дедлайн вызова
	}
	switch u.Scheme {
	case "https":
		tlsCfg, err := tlsx.ClientConfig(cfg.CertFile, cfg.KeyFile, cfg.CAFile)
		if err != nil {
			return nil, fmt.Errorf("rpcclient: %w", err)
		}
		tr.TLSClientConfig = tlsCfg
		tr.ForceAttemptHTTP2 = true
	case "http":
		p := new(http.Protocols)
		p.SetUnencryptedHTTP2(true)
		tr.Protocols = p
	default:
		return nil, errors.New("rpcclient: MESH_URL must be http:// or https://")
	}
	transport := connecthttp.NewTransport(&http.Client{Transport: tr}, strings.TrimRight(cfg.MeshURL, "/"), connecthttp.WithGRPC())
	return connect.NewClient(transport, traceInterceptor, deadlineInterceptor), nil
}

// deadlineInterceptor ставит DefaultDeadline вызову без дедлайна. Контекст живёт, пока
// жив поток: его отменяют на Close и на ошибке или конце Receive.
func deadlineInterceptor(next connect.ClientFunc) connect.ClientFunc {
	return func(ctx context.Context, spec connect.Spec) (connect.ClientStream, error) {
		if _, ok := ctx.Deadline(); ok {
			return next(ctx, spec)
		}
		ctx, cancel := context.WithTimeout(ctx, DefaultDeadline)
		stream, err := next(ctx, spec)
		if err != nil {
			cancel()
			return nil, err
		}
		return &cancelStream{ClientStream: stream, cancel: cancel}, nil
	}
}

type cancelStream struct {
	connect.ClientStream
	cancel context.CancelFunc
}

func (s *cancelStream) Receive(msg any) error {
	err := s.ClientStream.Receive(msg)
	if err != nil {
		s.cancel() // конец потока (io.EOF) или ошибка
	}
	return err
}

func (s *cancelStream) Close() error {
	err := s.ClientStream.Close()
	s.cancel()
	return err
}

// headerCarrier — заголовки запроса как носитель контекста трассировки.
type headerCarrier struct{ h *connect.Header }

func (c headerCarrier) Get(key string) string { return c.h.Get(key) }
func (c headerCarrier) Set(key, value string) { c.h.Set(key, value) }
func (c headerCarrier) Keys() []string {
	var keys []string
	for k := range c.h.All() {
		keys = append(keys, k)
	}
	return keys
}

var _ propagation.TextMapCarrier = headerCarrier{}

// traceInterceptor кладёт traceparent (и tracestate) из контекста через глобальный
// пропагатор OTel.
func traceInterceptor(next connect.ClientFunc) connect.ClientFunc {
	return func(ctx context.Context, spec connect.Spec) (connect.ClientStream, error) {
		if info, ok := connect.CallInfoForClientContext(ctx); ok {
			otel.GetTextMapPropagator().Inject(ctx, headerCarrier{h: info.RequestHeader()})
		}
		return next(ctx, spec)
	}
}
