package internal

import (
	"crypto/ed25519"
	"encoding/base64"
	"strings"
	"testing"
	"time"
)

func b64(n int, fill byte) string {
	return base64.StdEncoding.EncodeToString([]byte(strings.Repeat(string(fill), n)))
}

// serveVars — полный набор переменных serve для dev; тесты меняют отдельные значения.
func serveVars() map[string]string {
	return map[string]string{ //nolint:gosec // тестовые значения, не секреты
		"APP_ENV":                     "dev",
		"IDENTITY_APP_DSN":            "postgres://u@db:5432/identity?sslmode=disable",
		"NATS_URL":                    "tls://nats:4222",
		"NATS_USER":                   "identity",
		"NATS_PASSWORD":               "dev-identity-nats",
		"TLS_CERT_FILE":               "/certs/c.pem",
		"TLS_KEY_FILE":                "/certs/k.pem",
		"TLS_CA_FILE":                 "/certs/ca.pem",
		"IDENTITY_OTP_PROVIDER":       "mock",
		"IDENTITY_EMAIL_PROVIDER":     "mock",
		"IDENTITY_OTP_HMAC_KEY":       b64(32, 'h'),
		"IDENTITY_TOKEN_SIGNING_KEY":  b64(32, 's'),
		"IDENTITY_TOKEN_KID":          "dev-1",
		"OTEL_EXPORTER_OTLP_ENDPOINT": "",
		"PII_KEKS":                    "dev-1:" + b64(32, 'p'),
		"PII_KEK_CURRENT":             "dev-1",
		"PII_INDEX_KEY":               b64(32, 'i'),
	}
}

func load(t *testing.T, vars map[string]string) (ServeConfig, error) {
	t.Helper()
	return LoadServe(func(k string) (string, bool) { v, ok := vars[k]; return v, ok })
}

// loadMigrateFor — обёртка для теста: только ошибка LoadMigrate.
func loadMigrateFor(vars map[string]string) error {
	_, err := LoadMigrate(func(k string) (string, bool) { v, ok := vars[k]; return v, ok })
	return err
}

func TestServeConfigDev(t *testing.T) {
	vars := serveVars()
	vars["DEMO_MODE"] = "true"
	c, err := load(t, vars)
	if err != nil {
		t.Fatal(err)
	}
	if !c.DemoMode || c.OTPProvider != "mock" || c.EmailProvider != "mock" || c.TokenKID != "dev-1" {
		t.Errorf("unexpected config: %+v", c)
	}
	if len(c.OTPHMACKey) != 32 || len(c.TokenSigningKey) != ed25519.PrivateKeySize {
		t.Errorf("key sizes: hmac %d, signing %d", len(c.OTPHMACKey), len(c.TokenSigningKey))
	}
	if c.OTPDailyGlobalLimit != 500 || c.OTPDailyPrefixLimit != 50 {
		t.Errorf("limits: %d, %d", c.OTPDailyGlobalLimit, c.OTPDailyPrefixLimit)
	}
	if c.TokenPreviousKey != nil {
		t.Errorf("previous key must be nil: %+v", c.TokenPreviousKey)
	}
	if c.PII == nil || c.PII.Current() != "dev-1" || c.PIIIndex == nil {
		t.Errorf("pii keys: keyring %v, index %v", c.PII, c.PIIIndex)
	}
}

// Ключи ПДн вне dev: ровно 32 байта, текущий kid в списке, все ключи разные между собой
// и с секретами identity; ошибка называет переменную, но не значение.
func TestProdPIIKeys(t *testing.T) {
	cases := map[string]struct {
		edit  func(v map[string]string)
		names []string
	}{
		"kek equals otp key": {func(v map[string]string) { v["PII_KEKS"] = "k1:" + v["IDENTITY_OTP_HMAC_KEY"] }, []string{"PII_KEKS", "IDENTITY_OTP_HMAC_KEY"}},
		"kek equals signing": {func(v map[string]string) { v["PII_KEKS"] = "k1:" + v["IDENTITY_TOKEN_SIGNING_KEY"] }, []string{"PII_KEKS", "IDENTITY_TOKEN_SIGNING_KEY"}},
		"index equals otp":   {func(v map[string]string) { v["PII_INDEX_KEY"] = v["IDENTITY_OTP_HMAC_KEY"] }, []string{"PII_INDEX_KEY", "IDENTITY_OTP_HMAC_KEY"}},
		"keks repeat":        {func(v map[string]string) { v["PII_KEKS"] = "k0:" + b64(32, 'p') + ",k1:" + b64(32, 'p') }, []string{"PII_KEKS"}},
		"short kek":          {func(v map[string]string) { v["PII_KEKS"] = "k1:" + b64(16, 'p') }, []string{"PII_KEKS"}},
		"short index":        {func(v map[string]string) { v["PII_INDEX_KEY"] = b64(16, 'i') }, []string{"PII_INDEX_KEY"}},
		"current not listed": {func(v map[string]string) { v["PII_KEK_CURRENT"] = "k9" }, []string{"PII_KEK_CURRENT"}},
		"missing": {func(v map[string]string) {
			delete(v, "PII_KEKS")
			delete(v, "PII_KEK_CURRENT")
			delete(v, "PII_INDEX_KEY")
		}, []string{"PII_KEKS", "PII_KEK_CURRENT", "PII_INDEX_KEY"}},
	}
	for name, c := range cases {
		t.Run(name, func(t *testing.T) {
			v := prodVars()
			c.edit(v)
			mustFailNaming(t, v, c.names...)
		})
	}
	// Корректные ключи prod не дают ошибок по PII_*.
	_, err := load(t, prodVars())
	if err != nil && strings.Contains(err.Error(), "PII_") {
		t.Fatalf("valid prod pii keys rejected: %v", err)
	}
}

func prodVars() map[string]string {
	v := serveVars()
	v["APP_ENV"] = "prod"
	v["IDENTITY_APP_DSN"] = "postgres://u@db:5432/identity?sslmode=verify-full"
	// Допустим пока только mock, а в prod он запрещён: проверки ниже смотрят на имена
	// переменных в ошибке, а не на успех всей загрузки.
	v["NATS_PASSWORD"] = b64(32, 'n')
	v["IDENTITY_OTP_HMAC_KEY"] = b64(32, 'h')
	v["IDENTITY_TOKEN_SIGNING_KEY"] = b64(32, 's')
	v["PII_KEKS"] = "k0:" + b64(32, 'o') + ",k1:" + b64(32, 'p')
	v["PII_KEK_CURRENT"] = "k1"
	v["PII_INDEX_KEY"] = b64(32, 'i')
	return v
}

func mustFailNaming(t *testing.T, vars map[string]string, names ...string) {
	t.Helper()
	_, err := load(t, vars)
	if err == nil {
		t.Fatalf("expected error naming %v", names)
	}
	for _, n := range names {
		if !strings.Contains(err.Error(), n) {
			t.Errorf("error must name %s: %v", n, err)
		}
	}
	secrets := []string{vars["IDENTITY_OTP_HMAC_KEY"], vars["IDENTITY_TOKEN_SIGNING_KEY"], vars["PII_INDEX_KEY"]}
	for _, item := range strings.Split(vars["PII_KEKS"], ",") {
		if _, key, ok := strings.Cut(item, ":"); ok {
			secrets = append(secrets, key)
		}
	}
	for _, secret := range secrets {
		if secret != "" && strings.Contains(err.Error(), secret) {
			t.Errorf("error leaks a secret value: %v", err)
		}
	}
}

func TestProdRequiresVerifyFullDSN(t *testing.T) {
	v := prodVars()
	v["IDENTITY_APP_DSN"] = "postgres://u@db:5432/identity?sslmode=disable"
	mustFailNaming(t, v, "IDENTITY_APP_DSN")

	m := loadMigrateFor(map[string]string{
		"APP_ENV": "prod", "IDENTITY_OWNER_DSN": "postgres://u@db/identity?sslmode=require",
	})
	if m == nil || !strings.Contains(m.Error(), "IDENTITY_OWNER_DSN") {
		t.Fatalf("migrate must reject weak DSN naming IDENTITY_OWNER_DSN: %v", m)
	}
}

func TestProdRequiresHTTPSOTLP(t *testing.T) {
	v := prodVars()
	v["OTEL_EXPORTER_OTLP_ENDPOINT"] = "http://otel:4317"
	mustFailNaming(t, v, "OTEL_EXPORTER_OTLP_ENDPOINT")
	v["OTEL_EXPORTER_OTLP_ENDPOINT"] = "https://otel:4317"
	if _, err := load(t, v); err != nil && strings.Contains(err.Error(), "OTEL_EXPORTER_OTLP_ENDPOINT") {
		t.Fatalf("https endpoint rejected: %v", err)
	}
}

func TestProdRejectsMockOTP(t *testing.T) {
	v := prodVars()
	v["IDENTITY_OTP_PROVIDER"] = "mock"
	mustFailNaming(t, v, "IDENTITY_OTP_PROVIDER")
}

// Мок почты в prod: сервис не стартует и называет переменную.
func TestProdRejectsMockEmail(t *testing.T) {
	v := prodVars()
	v["IDENTITY_EMAIL_PROVIDER"] = "mock"
	mustFailNaming(t, v, "IDENTITY_EMAIL_PROVIDER")
	v = serveVars()
	v["IDENTITY_EMAIL_PROVIDER"] = "smtp"
	mustFailNaming(t, v, "IDENTITY_EMAIL_PROVIDER")
}

func TestProdRejectsDemoMode(t *testing.T) {
	v := prodVars()
	v["DEMO_MODE"] = "true"
	mustFailNaming(t, v, "DEMO_MODE")
}

func TestOTPKeyAndSigningKeyDistinct(t *testing.T) {
	v := prodVars()
	v["IDENTITY_OTP_HMAC_KEY"] = v["IDENTITY_TOKEN_SIGNING_KEY"]
	mustFailNaming(t, v, "IDENTITY_OTP_HMAC_KEY", "IDENTITY_TOKEN_SIGNING_KEY")
}

func TestSigningKeyMustBe32Bytes(t *testing.T) {
	for _, env := range []string{"dev", "prod"} {
		v := prodVars()
		v["APP_ENV"] = env
		v["IDENTITY_TOKEN_SIGNING_KEY"] = b64(48, 's')
		mustFailNaming(t, v, "IDENTITY_TOKEN_SIGNING_KEY")
	}
	v := serveVars()
	v["IDENTITY_TOKEN_SIGNING_KEY"] = "short-dev-key"
	mustFailNaming(t, v, "IDENTITY_TOKEN_SIGNING_KEY")
}

func TestPreviousKey(t *testing.T) {
	pub, _, err := ed25519.GenerateKey(nil)
	if err != nil {
		t.Fatal(err)
	}
	v := serveVars()
	v["IDENTITY_TOKEN_PREVIOUS_PUBLIC_KEY"] = "old-1:" + base64.StdEncoding.EncodeToString(pub)
	c, err := load(t, v)
	if err != nil {
		t.Fatal(err)
	}
	if c.TokenPreviousKey == nil || c.TokenPreviousKey.KID != "old-1" || !c.TokenPreviousKey.Public.Equal(pub) {
		t.Fatalf("previous key: %+v", c.TokenPreviousKey)
	}
	for _, bad := range []string{"nokid", ":" + base64.StdEncoding.EncodeToString(pub), "k:!!!", "k:" + b64(16, 'x')} {
		v["IDENTITY_TOKEN_PREVIOUS_PUBLIC_KEY"] = bad
		mustFailNaming(t, v, "IDENTITY_TOKEN_PREVIOUS_PUBLIC_KEY")
	}
}

func TestOTPLimitsRange(t *testing.T) {
	v := serveVars()
	v["IDENTITY_OTP_DAILY_GLOBAL_LIMIT"] = "0"
	v["IDENTITY_OTP_DAILY_PREFIX_LIMIT"] = "abc"
	mustFailNaming(t, v, "IDENTITY_OTP_DAILY_GLOBAL_LIMIT", "IDENTITY_OTP_DAILY_PREFIX_LIMIT")
}

func TestRequiredNewVariables(t *testing.T) {
	v := serveVars()
	delete(v, "IDENTITY_OTP_HMAC_KEY")
	delete(v, "IDENTITY_TOKEN_SIGNING_KEY")
	delete(v, "IDENTITY_TOKEN_KID")
	delete(v, "IDENTITY_OTP_PROVIDER")
	delete(v, "IDENTITY_EMAIL_PROVIDER")
	mustFailNaming(t, v, "IDENTITY_OTP_HMAC_KEY", "IDENTITY_TOKEN_SIGNING_KEY", "IDENTITY_TOKEN_KID", "IDENTITY_OTP_PROVIDER", "IDENTITY_EMAIL_PROVIDER")
}

func TestPreviousKeyMustDifferFromCurrent(t *testing.T) {
	v := serveVars()
	cur := ed25519.NewKeyFromSeed([]byte(strings.Repeat("s", 32))).Public().(ed25519.PublicKey)
	other, _, err := ed25519.GenerateKey(nil)
	if err != nil {
		t.Fatal(err)
	}
	// Тот же kid, что у текущего ключа.
	v["IDENTITY_TOKEN_PREVIOUS_PUBLIC_KEY"] = "dev-1:" + base64.StdEncoding.EncodeToString(other)
	mustFailNaming(t, v, "IDENTITY_TOKEN_PREVIOUS_PUBLIC_KEY")
	// Тот же публичный ключ под другим kid.
	v["IDENTITY_TOKEN_PREVIOUS_PUBLIC_KEY"] = "old-1:" + base64.StdEncoding.EncodeToString(cur)
	mustFailNaming(t, v, "IDENTITY_TOKEN_PREVIOUS_PUBLIC_KEY")
}

// Лимиты кодов по умолчанию равны прежним константам: без переменных поведение не меняется.
func TestCodeLimitsDefaults(t *testing.T) {
	c, err := load(t, serveVars())
	if err != nil {
		t.Fatal(err)
	}
	if c.OTPPhoneHourlyLimit != 5 || c.OTPPhoneDailyLimit != 10 || c.OTPPhoneCooldown != time.Minute {
		t.Errorf("код входа: %d / %d / %s, want 5 / 10 / 1m", c.OTPPhoneHourlyLimit, c.OTPPhoneDailyLimit, c.OTPPhoneCooldown)
	}
	if c.OTPIPHourlyLimit != 20 || c.OTPVerifyPhoneDailyLimit != 20 || c.OTPVerifyIPHourlyLimit != 50 || c.EmailVerifyDailyLimit != 20 {
		t.Errorf("IP и проверки: %d / %d / %d / %d, want 20 / 20 / 50 / 20", c.OTPIPHourlyLimit, c.OTPVerifyPhoneDailyLimit, c.OTPVerifyIPHourlyLimit, c.EmailVerifyDailyLimit)
	}
	if c.EmailCodeHourlyLimit != 5 || c.EmailCodeDailyLimit != 10 || c.EmailCodeCooldown != time.Minute {
		t.Errorf("код почты: %d / %d / %s, want 5 / 10 / 1m", c.EmailCodeHourlyLimit, c.EmailCodeDailyLimit, c.EmailCodeCooldown)
	}
	if c.OTPPhoneHourlyLimit != phoneHourly || c.OTPPhoneDailyLimit != phoneDaily || c.OTPPhoneCooldown != phoneCooldown ||
		c.EmailCodeHourlyLimit != emailHourly || c.EmailCodeDailyLimit != emailDaily || c.EmailCodeCooldown != emailCooldown {
		t.Errorf("умолчания разошлись с константами: %+v", c)
	}
}

func TestCodeLimitsFromVariables(t *testing.T) {
	v := serveVars()
	v["IDENTITY_OTP_PHONE_HOURLY_LIMIT"] = "200"
	v["IDENTITY_OTP_PHONE_DAILY_LIMIT"] = "1000"
	v["IDENTITY_OTP_PHONE_COOLDOWN"] = "1s"
	v["IDENTITY_EMAIL_CODE_HOURLY_LIMIT"] = "300"
	v["IDENTITY_EMAIL_CODE_DAILY_LIMIT"] = "2000"
	v["IDENTITY_EMAIL_CODE_COOLDOWN"] = "2s"
	c, err := load(t, v)
	if err != nil {
		t.Fatal(err)
	}
	if c.OTPPhoneHourlyLimit != 200 || c.OTPPhoneDailyLimit != 1000 || c.OTPPhoneCooldown != time.Second ||
		c.EmailCodeHourlyLimit != 300 || c.EmailCodeDailyLimit != 2000 || c.EmailCodeCooldown != 2*time.Second {
		t.Fatalf("значения не прочитаны: %+v", c)
	}
	for _, key := range []string{"IDENTITY_OTP_PHONE_HOURLY_LIMIT", "IDENTITY_EMAIL_CODE_DAILY_LIMIT"} {
		bad := serveVars()
		bad[key] = "0"
		mustFailNaming(t, bad, key)
	}
	bad := serveVars()
	bad["IDENTITY_OTP_PHONE_COOLDOWN"] = "0s"
	mustFailNaming(t, bad, "IDENTITY_OTP_PHONE_COOLDOWN")
}

// В prod ослабить лимиты кодов нельзя: сервис не стартует и называет переменную.
func TestProdRejectsWeakerCodeLimits(t *testing.T) {
	weak := map[string]string{
		"IDENTITY_OTP_PHONE_HOURLY_LIMIT":       "6",
		"IDENTITY_OTP_PHONE_DAILY_LIMIT":        "11",
		"IDENTITY_OTP_PHONE_COOLDOWN":           "59s",
		"IDENTITY_EMAIL_CODE_HOURLY_LIMIT":      "6",
		"IDENTITY_EMAIL_CODE_DAILY_LIMIT":       "11",
		"IDENTITY_EMAIL_CODE_COOLDOWN":          "59s",
		"IDENTITY_OTP_IP_HOURLY_LIMIT":          "21",
		"IDENTITY_OTP_VERIFY_PHONE_DAILY_LIMIT": "21",
		"IDENTITY_OTP_VERIFY_IP_HOURLY_LIMIT":   "51",
		"IDENTITY_EMAIL_VERIFY_DAILY_LIMIT":     "21",
		"IDENTITY_OTP_DAILY_GLOBAL_LIMIT":       "501",
		"IDENTITY_OTP_DAILY_PREFIX_LIMIT":       "51",
	}
	for key, val := range weak {
		t.Run(key, func(t *testing.T) {
			v := prodVars()
			v[key] = val
			mustFailNaming(t, v, key)
			// Вне prod то же значение допустимо.
			dev := serveVars()
			dev[key] = val
			if _, err := load(t, dev); err != nil {
				t.Fatalf("dev отверг %s: %v", key, err)
			}
		})
	}
}

// Ужесточение и значения, равные умолчанию, в prod допустимы.
func TestProdAcceptsStricterCodeLimits(t *testing.T) {
	strict := map[string]string{
		"IDENTITY_OTP_PHONE_HOURLY_LIMIT":       "3",
		"IDENTITY_OTP_PHONE_DAILY_LIMIT":        "10",
		"IDENTITY_OTP_PHONE_COOLDOWN":           "90s",
		"IDENTITY_EMAIL_CODE_HOURLY_LIMIT":      "5",
		"IDENTITY_EMAIL_CODE_DAILY_LIMIT":       "4",
		"IDENTITY_EMAIL_CODE_COOLDOWN":          "1m",
		"IDENTITY_OTP_IP_HOURLY_LIMIT":          "20",
		"IDENTITY_OTP_VERIFY_PHONE_DAILY_LIMIT": "10",
		"IDENTITY_OTP_VERIFY_IP_HOURLY_LIMIT":   "50",
		"IDENTITY_EMAIL_VERIFY_DAILY_LIMIT":     "5",
		"IDENTITY_OTP_DAILY_GLOBAL_LIMIT":       "500",
		"IDENTITY_OTP_DAILY_PREFIX_LIMIT":       "10",
	}
	v := prodVars()
	for key, val := range strict {
		v[key] = val
	}
	_, err := load(t, v)
	// Остальные ошибки prod в тесте возможны (мок-провайдеры); значимо лишь, что лимиты не названы.
	if err != nil {
		for key := range strict {
			if strings.Contains(err.Error(), key) {
				t.Fatalf("prod отверг %s: %v", key, err)
			}
		}
	}
}
