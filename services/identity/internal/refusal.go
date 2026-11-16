package internal

import (
	"context"
	"errors"
	"strconv"

	"connectrpc.com/connect/v2"
	"connectrpc.com/connect/v2/connectproto"
	"google.golang.org/protobuf/proto"

	commonv1 "github.com/CemeteryPlaya/senim-platform/gen/go/senim/common/v1"
	"github.com/CemeteryPlaya/senim-platform/pkg/idem"
)

// Отказ проверки кода по ключу идемпотентности (VerifyOtp, VerifyEmailCode): ответ «неверный код» мог потеряться в сети,
// и web повторяет вызов с тем же ключом. Повтор получает сохранённый отказ, а не тратит вторую попытку. Код gRPC
// хранится в params сохранённой детали под служебным ключом и при чтении снимается.

const refusalCodeParam = "__connect_code"

// savableRefusal — окончательный ответ на этот запрос (неверный код, исчерпаны попытки, лимит): его повтор должен дать
// то же. Временные сбои (Internal, Unavailable) не сохраняются: их повтор выполняется заново.
func savableRefusal(err error) (*commonv1.ErrorDetail, bool) {
	var ce *connect.Error
	if !errors.As(err, &ce) {
		return nil, false
	}
	switch ce.Code() {
	case connect.CodeInvalidArgument, connect.CodeResourceExhausted, connect.CodeFailedPrecondition, connect.CodePermissionDenied, connect.CodeNotFound:
	default:
		return nil, false
	}
	for _, d := range ce.Details() {
		msg, derr := connectproto.UnmarshalErrorDetail(d)
		if derr != nil {
			continue
		}
		if ed, ok := msg.(*commonv1.ErrorDetail); ok {
			saved := proto.Clone(ed).(*commonv1.ErrorDetail)
			if saved.Params == nil {
				saved.Params = map[string]string{}
			}
			saved.Params[refusalCodeParam] = strconv.Itoa(int(ce.Code()))
			return saved, true
		}
	}
	return nil, false
}

// refusalFrom восстанавливает ошибку из сохранённой детали.
func refusalFrom(saved *commonv1.ErrorDetail) error {
	code, err := strconv.ParseUint(saved.GetParams()[refusalCodeParam], 10, 32)
	if err != nil {
		return internalError()
	}
	params := map[string]string{}
	for k, v := range saved.GetParams() {
		if k != refusalCodeParam {
			params[k] = v
		}
	}
	if len(params) == 0 {
		params = nil
	}
	return rpcError(connect.Code(code), saved.GetCode(), params)
}

// replayedRefusal — сохранённый отказ для этого запроса и ключа, если он есть.
func (s *Service) replayedRefusal(ctx context.Context, method, key string, req proto.Message) error {
	saved := &commonv1.ErrorDetail{}
	found, err := idem.LookupRefusal(ctx, s.pool, method, key, req, saved)
	if err != nil {
		if !errors.Is(err, idem.ErrKeyReused) {
			s.log.WarnContext(ctx, "idem: чтение сохранённого отказа", "method", method, "err", err)
		}
		return nil
	}
	if !found {
		return nil
	}
	return refusalFrom(saved)
}

// rememberRefusal сохраняет окончательный отказ по ключу; сбой записи — только в журнал (отказ отдаётся как есть).
func (s *Service) rememberRefusal(ctx context.Context, method, key string, req proto.Message, refusal error) {
	saved, ok := savableRefusal(refusal)
	if !ok {
		return
	}
	if err := idem.SaveRefusal(ctx, s.pool, method, key, req, saved); err != nil {
		s.log.WarnContext(ctx, "idem: запись отказа", "method", method, "err", err)
	}
}
