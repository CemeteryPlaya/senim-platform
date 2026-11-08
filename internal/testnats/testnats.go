// Package testnats поднимает nats:2 с JetStream для тестов.
//
// Только для тестов: рабочий код этот пакет не импортирует.
package testnats

import (
	"context"
	"fmt"
	"os"
	"path/filepath"
	"runtime"

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

// StartSecure поднимает nats:2 с настоящим конфигом стенда deploy/compose/nats/nats.conf
// (TLS с клиентским сертификатом, учётные записи и права ADR-012). certDir — каталог с
// ca.pem, nats.pem и nats-key.pem: тест выпускает их своим CA (серверный сертификат — на
// имена nats и localhost). URL — tls://host:port.
func StartSecure(ctx context.Context, certDir string) (*Env, error) {
	conf, err := confFile()
	if err != nil {
		return nil, err
	}
	files := []testcontainers.ContainerFile{{HostFilePath: conf, ContainerFilePath: "/etc/nats/nats.conf", FileMode: 0o644}}
	for _, name := range []string{"ca", "nats", "nats-key"} {
		files = append(files, testcontainers.ContainerFile{
			HostFilePath:      filepath.Join(certDir, name+".pem"),
			ContainerFilePath: "/certs/" + name + ".pem",
			FileMode:          0o644,
		})
	}
	ctr, err := tcnats.Run(ctx, "nats:2",
		testcontainers.WithFiles(files...),
		testcontainers.WithCmd("-c", "/etc/nats/nats.conf"),
	)
	if err != nil {
		if ctr != nil {
			_ = testcontainers.TerminateContainer(ctr)
		}
		return nil, fmt.Errorf("testnats: старт nats с TLS: %w", err)
	}
	endpoint, err := ctr.PortEndpoint(ctx, "4222/tcp", "tls")
	if err != nil {
		_ = testcontainers.TerminateContainer(ctr)
		return nil, fmt.Errorf("testnats: адрес: %w", err)
	}
	return &Env{URL: endpoint, ctr: ctr}, nil
}

func confFile() (string, error) {
	_, self, _, ok := runtime.Caller(0)
	if !ok {
		return "", fmt.Errorf("testnats: не найден путь пакета")
	}
	p := filepath.Join(filepath.Dir(self), "..", "..", "deploy", "compose", "nats", "nats.conf")
	if _, err := os.Stat(p); err != nil {
		return "", fmt.Errorf("testnats: нет сгенерированного nats.conf: %w", err)
	}
	return p, nil
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
