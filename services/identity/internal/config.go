// Package internal — код сервиса identity: конфигурация, запуск и миграции.
package internal

import (
	"crypto/ed25519"
	"encoding/base64"
	"fmt"
	"strings"
	"time"

	"github.com/CemeteryPlaya/senim-platform/pkg/config"
	"github.com/CemeteryPlaya/senim-platform/pkg/dbx"
	"github.com/CemeteryPlaya/senim-platform/pkg/natsx"
	"github.com/CemeteryPlaya/senim-platform/pkg/pii"
)

// ServiceID — имя сервиса в логах, трассах и ролях базы.
const ServiceID = "identity"

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
	// EmailProvider — провайдер писем с кодом подтверждения e-mail (сейчас только mock; в
	// prod запрещён). При mock код возвращается в ответе RequestEmailCode (demo_code).
	EmailProvider string
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
	// Лимиты кода входа на номер (IDENTITY_OTP_PHONE_*): в час, в сутки и пауза между кодами.
	// В prod не слабее умолчаний (phoneHourly, phoneDaily, phoneCooldown).
	OTPPhoneHourlyLimit int
	OTPPhoneDailyLimit  int
	OTPPhoneCooldown    time.Duration
	// Лимиты кода почты на человека (IDENTITY_EMAIL_CODE_*): в час, в сутки и пауза между кодами.
	// В prod не слабее умолчаний (emailHourly, emailDaily, emailCooldown).
	EmailCodeHourlyLimit int
	EmailCodeDailyLimit  int
	EmailCodeCooldown    time.Duration
	// NATS — подключение к NATS: учётная запись identity, TLS с сертификатом сервиса (ADR-012).
	NATS      natsx.Config
	CertFile  string
	KeyFile   string
	CAFile    string
	OTLP      string
	GRPCAddr  string
	ProbeAddr string
	// Retention — сроки хранения временных данных и период очистки.
	Retention RetentionConfig
	// PoolMaxConns — размер пула соединений с базой (POOL_MAX_CONNS, по умолчанию 4).
	PoolMaxConns int32
	// PII — ключи конвертного шифрования ПДн (PII_KEKS, PII_KEK_CURRENT).
	PII *pii.Keyring
	// PIIIndex — слепой индекс ИИН/БИН (PII_INDEX_KEY).
	PIIIndex *pii.Index
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
		Env:           l.Env(),
		DemoMode:      l.DemoMode(),
		AppDSN:        l.PostgresDSN("IDENTITY_APP_DSN"),
		CertFile:      l.Required("TLS_CERT_FILE"),
		KeyFile:       l.Required("TLS_KEY_FILE"),
		CAFile:        l.Required("TLS_CA_FILE"),
		OTLP:          l.OTLPEndpoint("OTEL_EXPORTER_OTLP_ENDPOINT"),
		GRPCAddr:      l.String("IDENTITY_GRPC_ADDR", ":8443"),
		ProbeAddr:     l.String("IDENTITY_PROBE_ADDR", ":8081"),
		OTPProvider:   l.Provider("IDENTITY_OTP_PROVIDER", []string{"mock"}, []string{"mock"}),
		EmailProvider: l.Provider("IDENTITY_EMAIL_PROVIDER", []string{"mock"}, []string{"mock"}),
		OTPHMACKey:    l.Secret("IDENTITY_OTP_HMAC_KEY", 32),
		TokenKID:      l.Required("IDENTITY_TOKEN_KID"),
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
	c.OTPPhoneHourlyLimit = l.Int("IDENTITY_OTP_PHONE_HOURLY_LIMIT", phoneHourly, 1, 1_000_000)
	c.OTPPhoneDailyLimit = l.Int("IDENTITY_OTP_PHONE_DAILY_LIMIT", phoneDaily, 1, 1_000_000)
	c.OTPPhoneCooldown = l.Duration("IDENTITY_OTP_PHONE_COOLDOWN", phoneCooldown, time.Second, time.Hour)
	c.EmailCodeHourlyLimit = l.Int("IDENTITY_EMAIL_CODE_HOURLY_LIMIT", emailHourly, 1, 1_000_000)
	c.EmailCodeDailyLimit = l.Int("IDENTITY_EMAIL_CODE_DAILY_LIMIT", emailDaily, 1, 1_000_000)
	c.EmailCodeCooldown = l.Duration("IDENTITY_EMAIL_CODE_COOLDOWN", emailCooldown, time.Second, time.Hour)
	requireNotWeaker(l, c)
	c.Retention = loadRetention(l)
	l.Distinct("IDENTITY_OTP_HMAC_KEY", "IDENTITY_TOKEN_SIGNING_KEY")
	// Ключи ПДн отличаются друг от друга и от прочих секретов identity (вне dev).
	c.PII = pii.LoadKeyring(l, "IDENTITY_OTP_HMAC_KEY", "IDENTITY_TOKEN_SIGNING_KEY")
	c.PIIIndex = pii.LoadIndex(l, "IDENTITY_OTP_HMAC_KEY", "IDENTITY_TOKEN_SIGNING_KEY")
	c.TokenPreviousKey = previousKey(l, "IDENTITY_TOKEN_PREVIOUS_PUBLIC_KEY", c.TokenKID, c.TokenSigningKey)
	c.NATS = natsx.Load(l, c.CertFile, c.KeyFile, c.CAFile)
	if err := l.Err(); err != nil {
		return ServeConfig{}, fmt.Errorf("конфигурация: %w", err)
	}
	return c, nil
}

// requireNotWeaker — в prod лимиты кодов на номер и на человека не слабее умолчаний
// (больше кодов в час или в сутки, пауза короче): сервис не стартует и называет переменную.
// Ужесточать можно. Вне prod (dev, staging) значения свободны в пределах диапазона.
func requireNotWeaker(l *config.Loader, c ServeConfig) {
	if c.Env != config.Prod {
		return
	}
	const reasonMax = "weaker than the default when APP_ENV=prod (must not exceed %d)"
	for _, v := range []struct {
		key        string
		got, limit int
	}{
		{"IDENTITY_OTP_PHONE_HOURLY_LIMIT", c.OTPPhoneHourlyLimit, phoneHourly},
		{"IDENTITY_OTP_PHONE_DAILY_LIMIT", c.OTPPhoneDailyLimit, phoneDaily},
		{"IDENTITY_EMAIL_CODE_HOURLY_LIMIT", c.EmailCodeHourlyLimit, emailHourly},
		{"IDENTITY_EMAIL_CODE_DAILY_LIMIT", c.EmailCodeDailyLimit, emailDaily},
	} {
		if v.got > v.limit {
			l.Invalid(v.key, fmt.Sprintf(reasonMax, v.limit))
		}
	}
	for _, v := range []struct {
		key      string
		got, min time.Duration
	}{
		{"IDENTITY_OTP_PHONE_COOLDOWN", c.OTPPhoneCooldown, phoneCooldown},
		{"IDENTITY_EMAIL_CODE_COOLDOWN", c.EmailCodeCooldown, emailCooldown},
	} {
		if v.got < v.min {
			l.Invalid(v.key, fmt.Sprintf("weaker than the default when APP_ENV=prod (must be at least %s)", v.min))
		}
	}
}

// loadRetention читает сроки хранения. Верх везде год; нижние границы защищают живые
// данные: коду нужно пять минут, а суточные лимиты живут сутки, поэтому окна лимитов
// хранятся не меньше 24 ч.
func loadRetention(l *config.Loader) RetentionConfig {
	const (
		hour = time.Hour
		year = 365 * 24 * time.Hour
	)
	return RetentionConfig{
		RetainOTP:         l.Duration("IDENTITY_RETAIN_OTP", 24*hour, hour, year),
		RetainSessions:    l.Duration("IDENTITY_RETAIN_SESSIONS", 720*hour, hour, year),
		RetainRateLimits:  l.Duration("IDENTITY_RETAIN_RATE_LIMITS", 48*hour, 24*hour, year),
		RetainIdempotency: l.Duration("IDENTITY_RETAIN_IDEMPOTENCY", 48*hour, hour, year),
		RetainOutbox:      l.Duration("IDENTITY_RETAIN_OUTBOX", 168*hour, hour, year),
		Every:             l.Duration("IDENTITY_RETENTION_EVERY", hour, time.Minute, 24*hour),
	}
}

// previousKey читает необязательный прежний публичный ключ вида «kid:base64(32 байта)».
// Нарушение формата — ошибка с именем переменной, без значения.
func previousKey(l *config.Loader, key, currentKID string, current ed25519.PrivateKey) *SigningKey {
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
	// Прежний ключ с тем же kid или тем же ключом — ошибка ротации: JWKS получил бы
	// два ключа под одним kid, а токены нельзя было бы отличить от текущих.
	if kid == currentKID {
		l.Invalid(key, "kid must differ from IDENTITY_TOKEN_KID")
		return nil
	}
	if len(current) == ed25519.PrivateKeySize && current.Public().(ed25519.PublicKey).Equal(ed25519.PublicKey(pub)) {
		l.Invalid(key, "must differ from the public key of IDENTITY_TOKEN_SIGNING_KEY")
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

// MfaResetConfig — настройки подкоманды mfa-reset: рабочая роль базы.
type MfaResetConfig struct {
	Env    config.AppEnv
	AppDSN string
}

// LoadMfaReset читает переменные mfa-reset.
func LoadMfaReset(src config.Source) (MfaResetConfig, error) {
	l := config.NewLoader(src)
	c := MfaResetConfig{Env: l.Env(), AppDSN: l.PostgresDSN("IDENTITY_APP_DSN")}
	if err := l.Err(); err != nil {
		return MfaResetConfig{}, fmt.Errorf("конфигурация: %w", err)
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
