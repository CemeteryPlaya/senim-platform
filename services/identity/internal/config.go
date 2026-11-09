// Package internal — код сервиса identity: конфигурация, запуск и миграции.
package internal

import (
	"crypto/ed25519"
	"encoding/base64"
	"fmt"
	"strings"

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

// SigningKey — публичный ключ прежней подписи токенов: по нему принимаются токены,
// выпущенные до ротации ключа (kid → публичный ключ Ed25519).
type SigningKey struct {
	KID    string
	Public ed25519.PublicKey
}

// ServeConfig — настройки подкоманды serve.
type ServeConfig struct {
	Env      config.AppEnv
	DemoMode bool
	AppDSN   string
	// OTPProvider — провайдер одноразовых кодов (сейчас только mock; в prod запрещён).
	OTPProvider string
	// OTPHMACKey — ключ HMAC, которым хешируются коды в базе.
	OTPHMACKey []byte
	// TokenSigningKey — ключ подписи внутренних токенов Ed25519, собранный из seed в 32 байта.
	TokenSigningKey ed25519.PrivateKey
	// TokenKID — идентификатор текущего ключа подписи в JWKS.
	TokenKID string
	// TokenPreviousKey — прежний публичный ключ на время ротации; необязателен.
	TokenPreviousKey *SigningKey
	// OTPDailyGlobalLimit — сколько кодов в сутки сервис отправляет всего; OTPDailyPrefixLimit — на один префикс номера.
	OTPDailyGlobalLimit int
	OTPDailyPrefixLimit int
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
		Env:         l.Env(),
		DemoMode:    l.DemoMode(),
		AppDSN:      l.PostgresDSN("IDENTITY_APP_DSN"),
		CertFile:    l.Required("TLS_CERT_FILE"),
		KeyFile:     l.Required("TLS_KEY_FILE"),
		CAFile:      l.Required("TLS_CA_FILE"),
		OTLP:        l.OTLPEndpoint("OTEL_EXPORTER_OTLP_ENDPOINT"),
		GRPCAddr:    l.String("IDENTITY_GRPC_ADDR", ":8443"),
		ProbeAddr:   l.String("IDENTITY_PROBE_ADDR", ":8081"),
		OTPProvider: l.Provider("IDENTITY_OTP_PROVIDER", []string{"mock"}, []string{"mock"}),
		OTPHMACKey:  l.Secret("IDENTITY_OTP_HMAC_KEY", 32),
		TokenKID:    l.Required("IDENTITY_TOKEN_KID"),
		// Верх 50: 8 сервисов × 2 реплики × пул должны уместиться в max_connections Postgres.
		PoolMaxConns:        int32(l.Int("POOL_MAX_CONNS", dbx.DefaultMaxConns, 1, 50)), //nolint:gosec // диапазон проверен
		OTPDailyGlobalLimit: l.Int("IDENTITY_OTP_DAILY_GLOBAL_LIMIT", 500, 1, 1_000_000),
		OTPDailyPrefixLimit: l.Int("IDENTITY_OTP_DAILY_PREFIX_LIMIT", 50, 1, 1_000_000),
	}
	// Seed ровно в 32 байта в любом окружении: ed25519.NewKeyFromSeed иначе паникует.
	if seed := l.Secret("IDENTITY_TOKEN_SIGNING_KEY", ed25519.SeedSize); seed != nil {
		if len(seed) == ed25519.SeedSize {
			c.TokenSigningKey = ed25519.NewKeyFromSeed(seed)
		} else {
			l.Invalid("IDENTITY_TOKEN_SIGNING_KEY", fmt.Sprintf("must be exactly %d bytes (base64)", ed25519.SeedSize))
		}
	}
	l.Distinct("IDENTITY_OTP_HMAC_KEY", "IDENTITY_TOKEN_SIGNING_KEY")
	c.TokenPreviousKey = previousKey(l, "IDENTITY_TOKEN_PREVIOUS_PUBLIC_KEY")
	c.NATS = natsx.Load(l, c.CertFile, c.KeyFile, c.CAFile)
	if err := l.Err(); err != nil {
		return ServeConfig{}, fmt.Errorf("конфигурация: %w", err)
	}
	return c, nil
}

// previousKey читает необязательный прежний публичный ключ вида «kid:base64(32 байта)».
// Нарушение формата — ошибка с именем переменной, без значения.
func previousKey(l *config.Loader, key string) *SigningKey {
	raw := l.String(key, "")
	if raw == "" {
		return nil
	}
	kid, enc, ok := strings.Cut(raw, ":")
	pub, err := base64.StdEncoding.DecodeString(enc)
	if !ok || kid == "" || err != nil || len(pub) != ed25519.PublicKeySize {
		l.Invalid(key, fmt.Sprintf("expected kid:base64 of a %d-byte Ed25519 public key", ed25519.PublicKeySize))
		return nil
	}
	return &SigningKey{KID: kid, Public: ed25519.PublicKey(pub)}
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
	c := MigrateConfig{Env: l.Env(), OwnerDSN: l.PostgresDSN("IDENTITY_OWNER_DSN")}
	if err := l.Err(); err != nil {
		return MigrateConfig{}, fmt.Errorf("конфигурация: %w", err)
	}
	return c, nil
}
