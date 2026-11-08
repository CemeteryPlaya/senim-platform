// Package server is the shared skeleton of every Senim gRPC service: connect-go over
// HTTP/2 with mutual TLS, gRPC health, HTTP probes, telemetry and graceful shutdown.
//
// # Unavailable is a promise that nothing happened
//
// The mesh (deploy/compose/envoy/mesh.yaml) retries every method of a service package
// on gRPC UNAVAILABLE, not only methods marked idempotent. That is safe only under this
// rule, which every handler must follow:
//
//   - A handler returns connect.CodeUnavailable only when it has made no side effect:
//     nothing committed, no event in the outbox, no call to another service or provider
//     that may have acted.
//     "Try again" must be literally true.
//   - After a side effect, a failure is CodeInternal, CodeAborted or another code —
//     never Unavailable — even when the cause is a broken dependency.
//   - Errors from dependencies are not passed through as is: a downstream Unavailable
//     returned after this handler's own commit would make the mesh repeat the commit.
//
// Mutating methods additionally take idempotency_key (CLAUDE.md), so a retry that slips
// through still returns the stored result instead of a second effect.
package server

import (
	"context"
	"crypto/tls"
	"errors"
	"fmt"
	"log/slog"
	"net"
	"net/http"
	"os"
	"os/signal"
	"syscall"
	"time"

	"connectrpc.com/connect/v2"
	"connectrpc.com/connect/v2/connecthttp"
	"connectrpc.com/grpchealth/v2"
	"connectrpc.com/otelconnect"

	"github.com/CemeteryPlaya/senim-platform/pkg/logging"
	"github.com/CemeteryPlaya/senim-platform/pkg/tlsx"
)

const (
	defaultShutdownTimeout = 20 * time.Second
	defaultDrainDelay      = 5 * time.Second
	grpcIdleTimeout        = 5 * time.Minute
	probeIdleTimeout       = 60 * time.Second
	readyCheckTimeout      = 2 * time.Second
	headerReadTimeout      = 10 * time.Second

	// InstanceHeader carries the replica hostname so tests can see load balancing.
	InstanceHeader = "x-senim-instance"

	// MaxMessageBytes is the platform limit for one request or response message of every
	// handler (4 MiB, the gRPC default, set explicitly so a library change cannot lift it).
	// A larger request is refused with ResourceExhausted before the handler runs. The mesh
	// and edge Envoy limits (deploy/compose/envoy) match it. Files never travel through RPC:
	// they go to object storage by signed URL.
	MaxMessageBytes = 4 << 20
)

// Options configures Run.
type Options struct {
	Name      string // service name, used in logs and traces
	GRPCAddr  string // mTLS gRPC listener, e.g. ":8443"
	ProbeAddr string // plain HTTP /healthz and /readyz, e.g. ":8081"
	CertFile  string // server certificate
	KeyFile   string // server private key
	CAFile    string // CA that signs client certificates
	// AllowedPeers — DNS SAN клиентских сертификатов, которым разрешено соединение
	// (обязательно). Обычно MeshPeer и сам сервис (его реплики и подкоманды); любой другой
	// сертификат того же CA отвергается при рукопожатии. Вызывающий за mesh — Caller(ctx).
	AllowedPeers    []string
	ShutdownTimeout time.Duration // graceful stop limit, default 20s
	DrainDelay      time.Duration // time NOT_SERVING is visible with listeners still open before Shutdown, default 5s
	Logger          *slog.Logger  // default: JSON to stderr
	// Services — полные имена gRPC-сервисов процесса для health (например
	// "senim.identity.v1.IdentityService"). Check с пустым именем — состояние процесса;
	// с именем из списка — то же состояние; с любым другим — NotFound.
	Services []string
}

// Run serves until ctx is cancelled or SIGTERM/SIGINT arrives, then stops gracefully.
// register adds the service handlers; ready reports whether dependencies (database, ...)
// are usable. Health is SERVING only while ready returns nil, and NOT_SERVING once
// shutdown starts. Run returns nil after a clean stop.
//
// ready is called on every probe and health check, possibly concurrently: it must be
// safe for concurrent use, cheap, and respect ctx cancellation.
//
// ready covers only what the synchronous path needs — normally the database ping. It
// must not depend on NATS or the outbox relay: the outbox exists so that writes do not
// need the broker, and a NATS restart must not take every replica of every service out
// of the balancer (in Kubernetes a failed readiness removes all pods). Broker state goes
// to the log on change (pkg/natsx) and relay lag to metrics (outbox.ObserveBacklog) for
// an alert. A service that truly cannot work without NATS (a pure consumer) opts in
// explicitly and says why.
//
// On stop Run first reports NOT_SERVING for DrainDelay while still accepting connections
// (so the balancer can take the replica out), then drains in-flight RPCs. A second
// SIGTERM/Ctrl-C skips the delay.
func Run(ctx context.Context, opt Options, register func(s *connect.Server) error, ready func(context.Context) error) error {
	if opt.Name == "" {
		return errors.New("server: Options.Name is required")
	}
	if len(opt.AllowedPeers) == 0 {
		return errors.New("server: Options.AllowedPeers is required")
	}
	if opt.ShutdownTimeout <= 0 {
		opt.ShutdownTimeout = defaultShutdownTimeout
	}
	if opt.Logger == nil {
		opt.Logger = logging.New(os.Stderr, opt.Name, slog.LevelInfo)
	}
	if opt.DrainDelay == 0 {
		opt.DrainDelay = defaultDrainDelay
	}
	if ready == nil {
		ready = func(context.Context) error { return nil }
	}
	log := opt.Logger

	tlsCfg, err := tlsx.ServerConfig(opt.CertFile, opt.KeyFile, opt.CAFile, opt.AllowedPeers)
	if err != nil {
		return fmt.Errorf("server: %w", err)
	}
	traces, err := otelconnect.NewServerInterceptor(otelconnect.WithFilter(func(_ context.Context, spec connect.Spec) bool {
		return !isHealthProcedure(spec.Procedure)
	}))
	if err != nil {
		return fmt.Errorf("server: otel interceptor: %w", err)
	}
	host, _ := os.Hostname()

	// Outermost first: trace -> caller identity -> log -> panic recovery -> instance header.
	srv := connect.NewServer(traces, callerInterceptor(log, opt.AllowedPeers), logInterceptor(log),
		recoverInterceptor(log), instanceInterceptor(host))
	if err := register(srv); err != nil {
		return fmt.Errorf("server: register: %w", err)
	}
	health := newChecker(ready, opt.Services)
	grpchealth.Register(srv, health)

	mux := http.NewServeMux()
	connecthttp.Mount(mux, srv, HandlerOptions()...)

	grpcLn, err := net.Listen("tcp", opt.GRPCAddr)
	if err != nil {
		return fmt.Errorf("server: listen gRPC: %w", err)
	}
	probeLn, err := net.Listen("tcp", opt.ProbeAddr)
	if err != nil {
		_ = grpcLn.Close()
		return fmt.Errorf("server: listen probes: %w", err)
	}

	grpcSrv := newGRPCServer(mux, tlsCfg)
	probeSrv := newProbeServer(health)

	sigCtx, stop := signal.NotifyContext(ctx, syscall.SIGTERM, os.Interrupt)
	defer stop()

	serveErr := make(chan error, 2)
	go func() { serveErr <- serveResult("gRPC", grpcSrv.ServeTLS(grpcLn, "", "")) }()
	go func() { serveErr <- serveResult("probes", probeSrv.Serve(probeLn)) }()
	log.Info("server started", "grpc", grpcLn.Addr().String(), "probes", probeLn.Addr().String())

	var runErr error
	select {
	case <-sigCtx.Done():
	case runErr = <-serveErr:
	}

	stop() // restore default signal handling: a second SIGTERM/Ctrl-C kills the process
	health.stopping.Store(true)
	if runErr == nil {
		select { // NOT_SERVING stays visible while listeners are still open
		case <-time.After(opt.DrainDelay):
		case runErr = <-serveErr:
		}
	}
	log.Info("server stopping", "timeout", opt.ShutdownTimeout.String())
	shutCtx, cancel := context.WithTimeout(context.WithoutCancel(sigCtx), opt.ShutdownTimeout)
	defer cancel()
	// Drain RPCs first; probes stay up (readyz = 503) until the end.
	for _, s := range []*http.Server{grpcSrv, probeSrv} {
		if err := s.Shutdown(shutCtx); err != nil {
			_ = s.Close()
			runErr = errors.Join(runErr, fmt.Errorf("server: shutdown: %w", err))
		}
	}
	log.Info("server stopped")
	return runErr
}

// HandlerOptions are the connect handler options Run applies to every handler: the
// platform message size limit in both directions. A service that mounts handlers outside
// Run (tests, tools) passes the same options.
func HandlerOptions() []connecthttp.Option {
	return []connecthttp.Option{
		connecthttp.WithReadMaxBytes(MaxMessageBytes),
		connecthttp.WithSendMaxBytes(MaxMessageBytes),
	}
}

func serveResult(name string, err error) error {
	if err == nil || errors.Is(err, http.ErrServerClosed) {
		return nil
	}
	return fmt.Errorf("server: serve %s: %w", name, err)
}

func newGRPCServer(h http.Handler, tlsCfg *tls.Config) *http.Server {
	protocols := new(http.Protocols)
	protocols.SetHTTP2(true) // gRPC needs HTTP/2; HTTP/1 stays off
	return &http.Server{
		Handler:           h,
		TLSConfig:         tlsCfg,
		Protocols:         protocols,
		ReadHeaderTimeout: headerReadTimeout,
		IdleTimeout:       grpcIdleTimeout,
	}
}

func newProbeServer(c *checker) *http.Server {
	mux := http.NewServeMux()
	mux.HandleFunc("/healthz", func(w http.ResponseWriter, _ *http.Request) {
		w.WriteHeader(http.StatusOK)
		_, _ = w.Write([]byte("ok"))
	})
	mux.HandleFunc("/readyz", func(w http.ResponseWriter, r *http.Request) {
		if c.status(r.Context()) != grpchealth.StatusServing {
			w.WriteHeader(http.StatusServiceUnavailable)
			_, _ = w.Write([]byte("not ready"))
			return
		}
		w.WriteHeader(http.StatusOK)
		_, _ = w.Write([]byte("ok"))
	})
	return &http.Server{Handler: mux, ReadHeaderTimeout: headerReadTimeout, IdleTimeout: probeIdleTimeout}
}
