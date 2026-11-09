package internal

import (
	"connectrpc.com/connect/v2"
	"connectrpc.com/connect/v2/connectproto"

	commonv1 "github.com/CemeteryPlaya/senim-platform/gen/go/senim/common/v1"
)

// rpcError — ошибка обработчика с кодом gRPC и senim.common.v1.ErrorDetail. Сервис
// возвращает коды, не тексты: сообщение ошибки совпадает с кодом, тексты — в apps/web (ru).
func rpcError(code connect.Code, reason string, params map[string]string) error {
	e := connect.NewError(code, reason)
	detail, err := connectproto.NewErrorDetail(&commonv1.ErrorDetail{Code: reason, Params: params})
	if err != nil {
		return e // деталь не собралась: код gRPC и сообщение всё равно дойдут
	}
	return e.WithDetail(detail)
}

// internalError — ответ на сбой базы или провайдера: подробности остаются в логе.
func internalError() error { return connect.NewError(connect.CodeInternal, "internal") }
