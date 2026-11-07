// Package internal — код сервиса identity: конфигурация, запуск и миграции.
package internal

import (
	"fmt"

	"github.com/CemeteryPlaya/senim-platform/pkg/config"
)

// Service — имя сервиса в логах, трассах и ролях базы.
const Service = "identity"

// Stream — поток JetStream, в который релей публикует события identity.
const Stream = "SENIM_IDENTITY"

// ServiceName — полное имя gRPC-сервиса для проверки здоровья.
const ServiceName = "senim.identity.v1.IdentityService"

// ServeConfig — настройки подкоманды serve.
type ServeConfig struct {
	Env       config.AppEnv
	AppDSN    string
	NATSURL   string
	CertFile  string
	KeyFile   string
	CAFile    string
	OTLP      string
	GRPCAddr  string
	ProbeAddr string
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
		NATSURL:   l.Required("NATS_URL"),
		CertFile:  l.Required("TLS_CERT_FILE"),
		KeyFile:   l.Required("TLS_KEY_FILE"),
		CAFile:    l.Required("TLS_CA_FILE"),
		OTLP:      l.String("OTEL_EXPORTER_OTLP_ENDPOINT", ""),
		GRPCAddr:  l.String("IDENTITY_GRPC_ADDR", ":8443"),
		ProbeAddr: l.String("IDENTITY_PROBE_ADDR", ":8081"),
	}
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
