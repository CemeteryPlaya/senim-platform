package server

import (
	"context"
	"fmt"
	"log/slog"
	"net/http"
	"runtime/debug"
	"strings"
	"sync/atomic"
	"time"

	"connectrpc.com/connect/v2"
	"connectrpc.com/grpchealth/v2"
)

// checker answers gRPC health from the live readiness probe.
type checker struct {
	ready    func(context.Context) error
	services map[string]bool
	stopping atomic.Bool
}

func newChecker(ready func(context.Context) error, services []string) *checker {
	c := &checker{ready: ready, services: map[string]bool{}}
	for _, s := range services {
		c.services[s] = true
	}
	return c
}

func (c *checker) status(ctx context.Context) grpchealth.Status {
	if c.stopping.Load() {
		return grpchealth.StatusNotServing
	}
	ctx, cancel := context.WithTimeout(ctx, readyCheckTimeout)
	defer cancel()
	if err := c.ready(ctx); err != nil {
		return grpchealth.StatusNotServing
	}
	return grpchealth.StatusServing
}

// Check implements grpchealth.Checker: "" and every name in Options.Services share the
// process status; an unknown name is NotFound (as in grpc-go), so a typo in a balancer's
// health check never reads as SERVING.
func (c *checker) Check(ctx context.Context, req *grpchealth.CheckRequest) (*grpchealth.CheckResponse, error) {
	if req.Service != "" && !c.services[req.Service] {
		return nil, connect.NewError(connect.CodeNotFound, "unknown service")
	}
	return &grpchealth.CheckResponse{Status: c.status(ctx)}, nil
}

// isHealthProcedure reports gRPC health RPCs, which probes call constantly.
func isHealthProcedure(procedure string) bool {
	return strings.HasPrefix(procedure, "/grpc.health.v1.Health/")
}

// logInterceptor logs procedure, resulting code and duration of every RPC.
func logInterceptor(log *slog.Logger) connect.ServerInterceptor {
	return func(next connect.ServerFunc) connect.ServerFunc {
		return func(ctx context.Context, spec connect.Spec, stream connect.ServerStream) error {
			began := time.Now()
			err := next(ctx, spec, stream)
			// "result", not "code": the logging package masks "code" as a one-time SMS code.
			codeName, level := "ok", slog.LevelInfo
			if isHealthProcedure(spec.Procedure) && (err == nil || connect.CodeOf(err) != connect.CodeInternal) {
				return err
			}
			if err != nil {
				code := connect.CodeOf(err)
				codeName, level = code.String(), slog.LevelWarn
				if code == connect.CodeInternal || code == connect.CodeUnknown || code == connect.CodeDataLoss {
					level = slog.LevelError
				}
			}
			caller, _ := Caller(ctx)
			attrs := []slog.Attr{
				slog.String("procedure", spec.Procedure),
				slog.String("caller", caller),
				slog.String("result", codeName),
				slog.Float64("duration_ms", float64(time.Since(began).Microseconds())/1000),
			}
			if err != nil {
				attrs = append(attrs, slog.String("error", err.Error()))
			}
			log.LogAttrs(ctx, level, "rpc", attrs...)
			return err
		}
	}
}

// recoverInterceptor turns a handler panic into CodeInternal without leaking the panic
// text to the caller; the panic and its stack go to the log.
func recoverInterceptor(log *slog.Logger) connect.ServerInterceptor {
	return func(next connect.ServerFunc) connect.ServerFunc {
		return func(ctx context.Context, spec connect.Spec, stream connect.ServerStream) (err error) {
			defer func() {
				if r := recover(); r != nil {
					if r == http.ErrAbortHandler { //nolint:errorlint,err113 // sentinel panic value, compared by identity
						panic(r) // net/http uses it to abort a response on purpose
					}
					log.ErrorContext(ctx, "panic in handler",
						"procedure", spec.Procedure, "panic", fmt.Sprint(r), "stack", string(debug.Stack()))
					err = connect.NewError(connect.CodeInternal, "internal error")
				}
			}()
			return next(ctx, spec, stream)
		}
	}
}

// instanceInterceptor adds the replica hostname to every response.
func instanceInterceptor(host string) connect.ServerInterceptor {
	return func(next connect.ServerFunc) connect.ServerFunc {
		return func(ctx context.Context, spec connect.Spec, stream connect.ServerStream) error {
			if info, ok := connect.CallInfoForServerContext(ctx); ok {
				info.ResponseHeader().Set(InstanceHeader, host)
			}
			return next(ctx, spec, stream)
		}
	}
}
