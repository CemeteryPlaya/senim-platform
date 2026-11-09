package internal

import (
	"context"
	"slices"

	"connectrpc.com/connect/v2"

	"github.com/CemeteryPlaya/senim-platform/pkg/server"
)

// requireCaller — первая строка каждого обработчика (ADR-011): вызывает один из allowed.
// Вызывающего нет или он чужой — PermissionDenied, код caller_forbidden.
func requireCaller(ctx context.Context, allowed ...string) error {
	if name, ok := server.Caller(ctx); ok && slices.Contains(allowed, name) {
		return nil
	}
	return rpcError(connect.CodePermissionDenied, "caller_forbidden", nil)
}
