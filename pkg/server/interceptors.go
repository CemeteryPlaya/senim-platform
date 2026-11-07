package server

import (
	"context"
	"fmt"
	"log/slog"
	"runtime/debug"
	"sync/atomic"
	"time"

	"connectrpc.com/connect/v2"
	"connectrpc.com/grpchealth/v2"
)

// checker answers gRPC health from the live readiness probe.
type checker struct {
	ready    func(context.Context) error
	stopping atomic.Bool
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

// Check implements grpchealth.Checker; every service name shares the process status.
func (c *checker) Check(ctx context.Context, _ *grpchealth.CheckRequest) (*grpchealth.CheckResponse, error) {
	return &grpchealth.CheckResponse{Status: c.status(ctx)}, nil
}

// logInterceptor logs procedure, resulting code and duration of every RPC.
func logInterceptor(log *slog.Logger) connect.ServerInterceptor {
	return func(next connect.ServerFunc) connect.ServerFunc {
		return func(ctx context.Context, spec connect.Spec, stream connect.ServerStream) error {
			began := time.Now()
			err := next(ctx, spec, stream)
			// "result", not "code": the logging package masks "code" as a one-time SMS code.
			codeName, level := "ok", slog.LevelInfo
			if err != nil {
				code := connect.CodeOf(err)
				codeName, level = code.String(), slog.LevelWarn
				if code == connect.CodeInternal || code == connect.CodeUnknown || code == connect.CodeDataLoss {
					level = slog.LevelError
				}
			}
			attrs := []slog.Attr{
				slog.String("procedure", spec.Procedure),
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
