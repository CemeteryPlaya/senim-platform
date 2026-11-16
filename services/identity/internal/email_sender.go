package internal

import (
	"context"
	"log/slog"
)

// EmailSender отправляет код подтверждения на адрес e-mail. Провайдер выбирается конфигом
// (IDENTITY_EMAIL_PROVIDER); сейчас есть только мок, в prod он запрещён.
//
// Возвращаемые ошибки обработчик пишет в лог под ключом err: реализация не кладёт в них
// адрес и код (в том числе из ответа провайдера и URL запроса).
type EmailSender interface {
	Send(ctx context.Context, email, code string) error
}

// mockEmailSender ничего не отправляет; в лог пишет только факт отправки — без адреса и кода.
// Код человек видит в ответе RequestEmailCode (shown_code).
type mockEmailSender struct{ log *slog.Logger }

func (m mockEmailSender) Send(ctx context.Context, _, _ string) error {
	m.log.InfoContext(ctx, "email: мок-отправка кода")
	return nil
}
