// Package testnats поднимает nats:2 с JetStream для тестов.
//
// Только для тестов: рабочий код этот пакет не импортирует.
package testnats

import (
	"context"
	"fmt"

	"github.com/nats-io/nats.go"
	"github.com/nats-io/nats.go/jetstream"
	"github.com/testcontainers/testcontainers-go"
	tcnats "github.com/testcontainers/testcontainers-go/modules/nats"
)

// Env — запущенный NATS с JetStream (модуль запускает сервер с -js).
type Env struct {
	URL string
	ctr *tcnats.NATSContainer
}

// Start поднимает nats:2. Остановить — Terminate.
func Start(ctx context.Context) (*Env, error) {
	ctr, err := tcnats.Run(ctx, "nats:2")
	if err != nil {
		if ctr != nil {
			_ = testcontainers.TerminateContainer(ctr)
		}
		return nil, fmt.Errorf("testnats: старт nats: %w", err)
	}
	url, err := ctr.ConnectionString(ctx)
	if err != nil {
		_ = testcontainers.TerminateContainer(ctr)
		return nil, fmt.Errorf("testnats: адрес: %w", err)
	}
	return &Env{URL: url, ctr: ctr}, nil
}

// Terminate останавливает контейнер.
func (e *Env) Terminate() { _ = testcontainers.TerminateContainer(e.ctr) }

// Connect открывает соединение и JetStream-контекст.
func (e *Env) Connect() (*nats.Conn, jetstream.JetStream, error) {
	nc, err := nats.Connect(e.URL)
	if err != nil {
		return nil, nil, fmt.Errorf("testnats: подключение: %w", err)
	}
	js, err := jetstream.New(nc)
	if err != nil {
		nc.Close()
		return nil, nil, fmt.Errorf("testnats: jetstream: %w", err)
	}
	return nc, js, nil
}
