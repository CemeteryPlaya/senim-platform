// Package testdb поднимает postgres:17 для тестов с настоящими ролями из
// deploy/compose/postgres/init/00-roles.sql: базы сервисов, <svc>_owner и <svc>_app.
//
// Только для тестов: рабочий код этот пакет не импортирует.
package testdb

import (
	"context"
	"fmt"
	"os"
	"path/filepath"
	"runtime"
	"testing"

	"github.com/testcontainers/testcontainers-go"
	tcpg "github.com/testcontainers/testcontainers-go/modules/postgres"
)

const superPassword = "test-super"

// Env — запущенный Postgres.
type Env struct {
	Host string
	Port string
	ctr  *tcpg.PostgresContainer
}

// Start поднимает postgres:17 и применяет сгенерированный 00-roles.sql так же,
// как docker compose (через docker-entrypoint-initdb.d). Остановить — Terminate.
func Start(ctx context.Context) (*Env, error) {
	rolesSQL, err := rolesFile()
	if err != nil {
		return nil, err
	}
	ctr, err := tcpg.Run(ctx, "postgres:17",
		tcpg.WithPassword(superPassword),
		testcontainers.WithFiles(testcontainers.ContainerFile{
			HostFilePath:      rolesSQL,
			ContainerFilePath: "/docker-entrypoint-initdb.d/00-roles.sql",
			FileMode:          0o644,
		}),
		tcpg.BasicWaitStrategies(),
	)
	if err != nil {
		if ctr != nil {
			_ = testcontainers.TerminateContainer(ctr)
		}
		return nil, fmt.Errorf("testdb: старт postgres: %w", err)
	}
	e := &Env{ctr: ctr}
	if e.Host, err = ctr.Host(ctx); err != nil {
		e.Terminate()
		return nil, fmt.Errorf("testdb: host: %w", err)
	}
	port, err := ctr.MappedPort(ctx, "5432/tcp")
	if err != nil {
		e.Terminate()
		return nil, fmt.Errorf("testdb: port: %w", err)
	}
	e.Port = port.Port()
	return e, nil
}

// StartT — Start с остановкой контейнера в t.Cleanup.
func StartT(t testing.TB) *Env {
	t.Helper()
	e, err := Start(context.Background())
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(e.Terminate)
	return e
}

// Terminate останавливает контейнер.
func (e *Env) Terminate() { _ = testcontainers.TerminateContainer(e.ctr) }

// DSN — строка подключения для роли user к базе db.
func (e *Env) DSN(user, pass, db string) string {
	return fmt.Sprintf("postgres://%s:%s@%s:%s/%s?sslmode=disable", user, pass, e.Host, e.Port, db)
}

// OwnerDSN — владелец базы сервиса (миграции); пароль из dev-ролей.
func (e *Env) OwnerDSN(service string) string {
	return e.DSN(service+"_owner", "dev-"+service+"-owner", service)
}

// AppDSN — рабочая роль сервиса; пароль из dev-ролей.
func (e *Env) AppDSN(service string) string {
	return e.DSN(service+"_app", "dev-"+service+"-app", service)
}

func rolesFile() (string, error) {
	_, self, _, ok := runtime.Caller(0)
	if !ok {
		return "", fmt.Errorf("testdb: не найден путь пакета")
	}
	p := filepath.Join(filepath.Dir(self), "..", "..", "deploy", "compose", "postgres", "init", "00-roles.sql")
	if _, err := os.Stat(p); err != nil {
		return "", fmt.Errorf("testdb: нет сгенерированного 00-roles.sql: %w", err)
	}
	return p, nil
}
