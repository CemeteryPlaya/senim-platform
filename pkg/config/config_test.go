package config

import (
	"encoding/base64"
	"strings"
	"testing"
)

func mapSource(m map[string]string) Source {
	return func(key string) (string, bool) {
		v, ok := m[key]
		return v, ok
	}
}

func b64(n int, fill byte) string {
	return base64.StdEncoding.EncodeToString([]byte(strings.Repeat(string(fill), n)))
}

func TestProdRejectsShortSecret(t *testing.T) {
	short := b64(16, 'a')
	l := NewLoader(mapSource(map[string]string{"APP_ENV": "prod", "PII_HASH_KEY": short}))
	l.Env()
	l.Secret("PII_HASH_KEY", 32)
	err := l.Err()
	if err == nil {
		t.Fatal("expected error for short prod secret")
	}
	if !strings.Contains(err.Error(), "PII_HASH_KEY") {
		t.Errorf("error must name the variable: %v", err)
	}
	if strings.Contains(err.Error(), short) || strings.Contains(err.Error(), strings.Repeat("a", 16)) {
		t.Errorf("error must not contain the secret value: %v", err)
	}
}

func TestProdRejectsDuplicateKeys(t *testing.T) {
	same := b64(32, 'k')
	l := NewLoader(mapSource(map[string]string{"APP_ENV": "prod", "KEY_A": same, "KEY_B": same}))
	l.Env()
	l.Secret("KEY_A", 32)
	l.Secret("KEY_B", 32)
	l.Distinct("KEY_A", "KEY_B")
	err := l.Err()
	if err == nil {
		t.Fatal("expected error for duplicate secrets")
	}
	for _, name := range []string{"KEY_A", "KEY_B"} {
		if !strings.Contains(err.Error(), name) {
			t.Errorf("error must name %s: %v", name, err)
		}
	}
	if strings.Contains(err.Error(), same) {
		t.Errorf("error must not contain the secret value: %v", err)
	}
}

func TestProdRejectsMockProvider(t *testing.T) {
	l := NewLoader(mapSource(map[string]string{"APP_ENV": "prod", "PAYMENT_PROVIDER": "mock"}))
	l.Env()
	l.Provider("PAYMENT_PROVIDER", []string{"mock", "manual"}, []string{"mock"})
	err := l.Err()
	if err == nil || !strings.Contains(err.Error(), "PAYMENT_PROVIDER") {
		t.Fatalf("expected error naming PAYMENT_PROVIDER, got %v", err)
	}
}

func TestDevAllowsMockProvider(t *testing.T) {
	l := NewLoader(mapSource(map[string]string{"APP_ENV": "dev", "PAYMENT_PROVIDER": "mock"}))
	l.Env()
	if got := l.Provider("PAYMENT_PROVIDER", []string{"mock", "manual"}, []string{"mock"}); got != "mock" {
		t.Errorf("got %q", got)
	}
	if err := l.Err(); err != nil {
		t.Errorf("unexpected error: %v", err)
	}
}

func TestProviderRejectsUnknownValue(t *testing.T) {
	l := NewLoader(mapSource(map[string]string{"APP_ENV": "dev", "PAYMENT_PROVIDER": "bogus"}))
	l.Env()
	l.Provider("PAYMENT_PROVIDER", []string{"mock", "manual"}, []string{"mock"})
	if err := l.Err(); err == nil || !strings.Contains(err.Error(), "PAYMENT_PROVIDER") {
		t.Fatalf("expected error naming PAYMENT_PROVIDER, got %v", err)
	}
}

func TestProdRejectsDemoMode(t *testing.T) {
	l := NewLoader(mapSource(map[string]string{"APP_ENV": "prod", "DEMO_MODE": "true"}))
	if got := l.Env(); got != Prod {
		t.Errorf("env = %q", got)
	}
	err := l.Err()
	if err == nil || !strings.Contains(err.Error(), "DEMO_MODE") {
		t.Fatalf("expected error naming DEMO_MODE, got %v", err)
	}
}

func TestDevAllowsDemoMode(t *testing.T) {
	l := NewLoader(mapSource(map[string]string{"APP_ENV": "dev", "DEMO_MODE": "true"}))
	l.Env()
	if err := l.Err(); err != nil {
		t.Errorf("unexpected error: %v", err)
	}
}

func TestMissingAppEnv(t *testing.T) {
	l := NewLoader(mapSource(nil))
	l.Env()
	err := l.Err()
	if err == nil || !strings.Contains(err.Error(), "APP_ENV") {
		t.Fatalf("expected error naming APP_ENV, got %v", err)
	}
}

func TestUnknownAppEnv(t *testing.T) {
	l := NewLoader(mapSource(map[string]string{"APP_ENV": "producton"}))
	l.Env()
	err := l.Err()
	if err == nil || !strings.Contains(err.Error(), "APP_ENV") {
		t.Fatalf("expected error naming APP_ENV, got %v", err)
	}
}

func TestEnvReportedOnce(t *testing.T) {
	l := NewLoader(mapSource(nil))
	l.Env()
	l.Env()
	if n := strings.Count(l.Err().Error(), "APP_ENV"); n != 1 {
		t.Errorf("APP_ENV reported %d times", n)
	}
}

func TestDevAllowsShortSecrets(t *testing.T) {
	l := NewLoader(mapSource(map[string]string{"APP_ENV": "dev", "PII_HASH_KEY": "dev-key"}))
	l.Env()
	got := l.Secret("PII_HASH_KEY", 32)
	if len(got) == 0 {
		t.Error("expected dev secret bytes")
	}
	if err := l.Err(); err != nil {
		t.Errorf("unexpected error: %v", err)
	}
}

func TestProdSecretDecodesBase64(t *testing.T) {
	l := NewLoader(mapSource(map[string]string{"APP_ENV": "prod", "K": b64(32, 'z')}))
	l.Env()
	got := l.Secret("K", 32)
	if string(got) != strings.Repeat("z", 32) {
		t.Errorf("decoded = %q", got)
	}
	if err := l.Err(); err != nil {
		t.Errorf("unexpected error: %v", err)
	}
}

func TestProdRejectsNonBase64Secret(t *testing.T) {
	bad := "not base64 !!! not base64 !!! not base64"
	l := NewLoader(mapSource(map[string]string{"APP_ENV": "prod", "K": bad}))
	l.Env()
	l.Secret("K", 8)
	err := l.Err()
	if err == nil || !strings.Contains(err.Error(), "K") || strings.Contains(err.Error(), bad) {
		t.Fatalf("unexpected error: %v", err)
	}
}

func TestMissingSecret(t *testing.T) {
	l := NewLoader(mapSource(map[string]string{"APP_ENV": "dev"}))
	l.Env()
	l.Secret("PII_HASH_KEY", 32)
	if err := l.Err(); err == nil || !strings.Contains(err.Error(), "PII_HASH_KEY") {
		t.Fatalf("expected error naming PII_HASH_KEY, got %v", err)
	}
}

func TestRequiredAndString(t *testing.T) {
	l := NewLoader(mapSource(map[string]string{"APP_ENV": "dev", "A": "x"}))
	l.Env()
	if l.Required("A") != "x" || l.String("B", "def") != "def" || l.String("A", "def") != "x" {
		t.Error("unexpected values")
	}
	if l.Err() != nil {
		t.Errorf("unexpected error: %v", l.Err())
	}
	l.Required("MISSING")
	if err := l.Err(); err == nil || !strings.Contains(err.Error(), "MISSING") {
		t.Errorf("expected error naming MISSING, got %v", err)
	}
}

func TestErrorsAccumulate(t *testing.T) {
	l := NewLoader(mapSource(map[string]string{
		"APP_ENV":          "prod",
		"PII_HASH_KEY":     b64(8, 'a'),
		"PAYMENT_PROVIDER": "mock",
	}))
	l.Env()
	l.Secret("PII_HASH_KEY", 32)
	l.Provider("PAYMENT_PROVIDER", []string{"mock", "manual"}, []string{"mock"})
	l.Required("DATABASE_URL")
	err := l.Err()
	if err == nil {
		t.Fatal("expected errors")
	}
	for _, name := range []string{"PII_HASH_KEY", "PAYMENT_PROVIDER", "DATABASE_URL"} {
		if !strings.Contains(err.Error(), name) {
			t.Errorf("error must list %s: %v", name, err)
		}
	}
}

func TestDistinctDevAllowsDuplicates(t *testing.T) {
	l := NewLoader(mapSource(map[string]string{"APP_ENV": "dev", "A": "same", "B": "same"}))
	l.Env()
	l.Distinct("A", "B")
	if err := l.Err(); err != nil {
		t.Errorf("unexpected error: %v", err)
	}
}

func TestDemoModeParsedAsBool(t *testing.T) {
	for _, v := range []string{"true", "TRUE", "True", "1", "t", "T"} {
		l := NewLoader(mapSource(map[string]string{"APP_ENV": "prod", "DEMO_MODE": v}))
		l.Env()
		if err := l.Err(); err == nil || !strings.Contains(err.Error(), "DEMO_MODE") {
			t.Errorf("DEMO_MODE=%q in prod: want error naming DEMO_MODE, got %v", v, err)
		}
	}
	for _, v := range []string{"false", "FALSE", "0", ""} {
		l := NewLoader(mapSource(map[string]string{"APP_ENV": "prod", "DEMO_MODE": v}))
		l.Env()
		if err := l.Err(); err != nil {
			t.Errorf("DEMO_MODE=%q in prod: unexpected error %v", v, err)
		}
	}
}

func TestDemoModeUnparseableIsError(t *testing.T) {
	for _, env := range []string{"prod", "staging", "dev"} {
		for _, v := range []string{"yes", "on", "enabled", " true"} {
			l := NewLoader(mapSource(map[string]string{"APP_ENV": env, "DEMO_MODE": v}))
			l.Env()
			err := l.Err()
			if err == nil || !strings.Contains(err.Error(), "DEMO_MODE") {
				t.Errorf("APP_ENV=%s DEMO_MODE=%q: want error naming DEMO_MODE, got %v", env, v, err)
				continue
			}
			if strings.Contains(err.Error(), v) && v != " true" {
				t.Errorf("error must not echo the value: %v", err)
			}
		}
	}
	// staging допускает демо-режим, если значение разбирается.
	l := NewLoader(mapSource(map[string]string{"APP_ENV": "staging", "DEMO_MODE": "TRUE"}))
	l.Env()
	if err := l.Err(); err != nil {
		t.Errorf("staging DEMO_MODE=TRUE: unexpected error %v", err)
	}
}

func TestDemoModeAccessor(t *testing.T) {
	l := NewLoader(mapSource(map[string]string{"APP_ENV": "dev", "DEMO_MODE": "1"}))
	if !l.DemoMode() {
		t.Error("DEMO_MODE=1 in dev: want true")
	}
	l = NewLoader(mapSource(map[string]string{"APP_ENV": "dev"}))
	if l.DemoMode() {
		t.Error("DEMO_MODE unset: want false")
	}
	if err := l.Err(); err != nil {
		t.Errorf("unexpected error: %v", err)
	}
}

// Один и тот же ключ в base64 и сырым видом — повтор, даже если строки разные.
func TestDistinctComparesDecodedBytes(t *testing.T) {
	raw := strings.Repeat("k", 32)
	for _, env := range []string{"prod", "staging"} {
		l := NewLoader(mapSource(map[string]string{"APP_ENV": env, "KEY_A": base64.StdEncoding.EncodeToString([]byte(raw)), "KEY_B": raw}))
		l.Env()
		l.Distinct("KEY_A", "KEY_B")
		err := l.Err()
		if err == nil || !strings.Contains(err.Error(), "KEY_A") || !strings.Contains(err.Error(), "KEY_B") {
			t.Fatalf("%s: base64 and raw form of one key must be caught, got %v", env, err)
		}
		if strings.Contains(err.Error(), raw) {
			t.Fatalf("error must not contain the secret value: %v", err)
		}
	}
	l := NewLoader(mapSource(map[string]string{"APP_ENV": "prod", "KEY_A": b64(32, 'a'), "KEY_B": b64(32, 'b')}))
	l.Env()
	l.Distinct("KEY_A", "KEY_B")
	if err := l.Err(); err != nil {
		t.Fatalf("distinct keys: unexpected error %v", err)
	}
}
