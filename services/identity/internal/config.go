// Package internal — код сервиса identity: конфигурация, запуск и миграции.
package internal

import (
	"fmt"

	"github.com/CemeteryPlaya/senim-platform/pkg/config"
	"github.com/CemeteryPlaya/senim-platform/pkg/dbx"
	"github.com/CemeteryPlaya/senim-platform/pkg/natsx"
)

// Service — имя сервиса в логах, трассах и ролях базы.
const Service = "identity"

// Stream — поток JetStream, в который релей публикует события identity.
const Stream = "SENIM_IDENTITY"

// ServiceName — полное имя gRPC-сервиса для проверки здоровья.
const ServiceName = "senim.identity.v1.IdentityService"

// ServeConfig — настройки подкоманды serve.
type ServeConfig struct {
	Env    config.AppEnv
	AppDSN string
	// NATS — подключение к NATS: учётная запись identity, TLS с сертификатом сервиса (ADR-012).
	NATS      natsx.Config
	CertFile  string
	KeyFile   string
	CAFile    string
	OTLP      string
	GRPCAddr  string
	ProbeAddr string
	// PoolMaxConns — размер пула соединений с базой (POOL_MAX_CONNS, по умолчанию 4).
	PoolMaxConns int32
}

// MigrateConfig — настройки подкоманды migrate.
type MigrateConfig struct {
	Env      config.AppEnv
	OwnerDSN string
}

// LoadServe читает переменные serve; все нарушения возвращаются разом.
func LoadServe(src config.Source) (ServeConfig, error) {
	l := config.NewLoader(src)
	c := ServeConfig{
		Env:       l.Env(),
		AppDSN:    l.Required("IDENTITY_APP_DSN"),
		CertFile:  l.Required("TLS_CERT_FILE"),
		KeyFile:   l.Required("TLS_KEY_FILE"),
		CAFile:    l.Required("TLS_CA_FILE"),
		OTLP:      l.String("OTEL_EXPORTER_OTLP_ENDPOINT", ""),
		GRPCAddr:  l.String("IDENTITY_GRPC_ADDR", ":8443"),
		ProbeAddr: l.String("IDENTITY_PROBE_ADDR", ":8081"),
		// Верх 50: 8 сервисов × 2 реплики × пул должны уместиться в max_connections Postgres.
		PoolMaxConns: int32(l.Int("POOL_MAX_CONNS", dbx.DefaultMaxConns, 1, 50)), //nolint:gosec // диапазон проверен
	}
	c.NATS = natsx.Load(l, c.CertFile, c.KeyFile, c.CAFile)
	if err := l.Err(); err != nil {
		return ServeConfig{}, fmt.Errorf("конфигурация: %w", err)
	}
	return c, nil
}

// HealthcheckConfig — настройки подкоманды healthcheck: только адрес проб serve.
type HealthcheckConfig struct {
	ProbeAddr string
}

// LoadHealthcheck читает переменные healthcheck.
func LoadHealthcheck(src config.Source) (HealthcheckConfig, error) {
	l := config.NewLoader(src)
	c := HealthcheckConfig{ProbeAddr: l.String("IDENTITY_PROBE_ADDR", ":8081")}
	if err := l.Err(); err != nil {
		return HealthcheckConfig{}, fmt.Errorf("конфигурация: %w", err)
	}
	return c, nil
}

// LoadMigrate читает переменные migrate.
func LoadMigrate(src config.Source) (MigrateConfig, error) {
	l := config.NewLoader(src)
	c := MigrateConfig{Env: l.Env(), OwnerDSN: l.Required("IDENTITY_OWNER_DSN")}
	if err := l.Err(); err != nil {
		return MigrateConfig{}, fmt.Errorf("конфигурация: %w", err)
	}
	return c, nil
}
