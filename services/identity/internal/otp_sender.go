package internal

import (
	"context"
	"log/slog"
)

// OtpSender отправляет одноразовый код получателю. Провайдер выбирается конфигом
// (IDENTITY_OTP_PROVIDER); сейчас есть только мок.
//
// Возвращаемые ошибки обработчик пишет в лог под ключом err: реализация не кладёт в них
// номер телефона и код (в том числе из ответа провайдера и URL запроса).
type OtpSender interface {
	Send(ctx context.Context, phone, code string) error
}

// mockSender ничего не отправляет; в лог пишет только факт отправки — без номера и кода.
type mockSender struct{ log *slog.Logger }

func (m mockSender) Send(ctx context.Context, _, _ string) error {
	m.log.InfoContext(ctx, "otp: мок-отправка кода")
	return nil
}
