// Package server is the shared skeleton of every Senim gRPC service: connect-go over
// HTTP/2 with mutual TLS, gRPC health, HTTP probes, telemetry and graceful shutdown.
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
	readyCheckTimeout      = 2 * time.Second
	headerReadTimeout      = 10 * time.Second

	// InstanceHeader carries the replica hostname so tests can see load balancing.
	InstanceHeader = "x-senim-instance"
)

// Options configures Run.
type Options struct {
	Name            string        // service name, used in logs and traces
	GRPCAddr        string        // mTLS gRPC listener, e.g. ":8443"
	ProbeAddr       string        // plain HTTP /healthz and /readyz, e.g. ":8081"
	CertFile        string        // server certificate
	KeyFile         string        // server private key
	CAFile          string        // CA that signs client certificates
	ShutdownTimeout time.Duration // graceful stop limit, default 20s
	Logger          *slog.Logger  // default: JSON to stderr
}

// Run serves until ctx is cancelled or SIGTERM/SIGINT arrives, then stops gracefully.
// register adds the service handlers; ready reports whether dependencies (database, ...)
// are usable. Health is SERVING only while ready returns nil, and NOT_SERVING once
// shutdown starts. Run returns nil after a clean stop.
func Run(ctx context.Context, opt Options, register func(s *connect.Server) error, ready func(context.Context) error) error {
	if opt.Name == "" {
		return errors.New("server: Options.Name is required")
	}
	if opt.ShutdownTimeout <= 0 {
		opt.ShutdownTimeout = defaultShutdownTimeout
	}
	if opt.Logger == nil {
		opt.Logger = logging.New(os.Stderr, opt.Name, slog.LevelInfo)
	}
	if ready == nil {
		ready = func(context.Context) error { return nil }
	}
	log := opt.Logger

	tlsCfg, err := tlsx.ServerConfig(opt.CertFile, opt.KeyFile, opt.CAFile)
	if err != nil {
		return fmt.Errorf("server: %w", err)
	}
	traces, err := otelconnect.NewServerInterceptor()
	if err != nil {
		return fmt.Errorf("server: otel interceptor: %w", err)
	}
	host, _ := os.Hostname()

	// Outermost first: trace -> log -> panic recovery -> instance header.
	srv := connect.NewServer(traces, logInterceptor(log), recoverInterceptor(log), instanceInterceptor(host))
	if err := register(srv); err != nil {
		return fmt.Errorf("server: register: %w", err)
	}
	health := &checker{ready: ready}
	grpchealth.Register(srv, health)

	mux := http.NewServeMux()
	connecthttp.Mount(mux, srv)

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

	ctx, stop := signal.NotifyContext(ctx, syscall.SIGTERM, os.Interrupt)
	defer stop()

	serveErr := make(chan error, 2)
	go func() { serveErr <- serveResult("gRPC", grpcSrv.ServeTLS(grpcLn, "", "")) }()
	go func() { serveErr <- serveResult("probes", probeSrv.Serve(probeLn)) }()
	log.Info("server started", "grpc", grpcLn.Addr().String(), "probes", probeLn.Addr().String())

	var runErr error
	select {
	case <-ctx.Done():
	case runErr = <-serveErr:
	}

	health.stopping.Store(true)
	log.Info("server stopping", "timeout", opt.ShutdownTimeout.String())
	shutCtx, cancel := context.WithTimeout(context.WithoutCancel(ctx), opt.ShutdownTimeout)
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
	return &http.Server{Handler: mux, ReadHeaderTimeout: headerReadTimeout}
}
