package config

import (
	"strings"
	"testing"
)

func TestProdRequiresVerifyFullDSN(t *testing.T) {
	// pgconn читает PG*: пустое значение отключает влияние окружения разработчика.
	t.Setenv("PGSSLMODE", "")
	t.Setenv("PGSSLROOTCERT", "")
	const pass = "s3cretpass"
	cases := []struct {
		name string
		env  string
		dsn  string
		ok   bool
	}{
		{"prod url verify-full", "prod", "postgres://u:" + pass + "@db:5432/x?sslmode=verify-full", true},
		{"prod postgresql scheme", "prod", "postgresql://u:" + pass + "@db/x?application_name=a&sslmode=verify-full", true},
		{"prod url disable", "prod", "postgres://u:" + pass + "@db:5432/x?sslmode=disable", false},
		{"prod url require", "prod", "postgres://u:" + pass + "@db:5432/x?sslmode=require", false},
		{"prod url verify-ca", "prod", "postgres://u:" + pass + "@db:5432/x?sslmode=verify-ca", false},
		{"prod url no sslmode", "prod", "postgres://u:" + pass + "@db:5432/x", false},
		{"prod keyword verify-full", "prod", "host=db user=u password=" + pass + " dbname=x sslmode=verify-full", true},
		{"prod keyword quoted", "prod", "host=db user=u password='" + pass + " x' sslmode='verify-full'", true},
		{"prod keyword disable", "prod", "host=db user=u password=" + pass + " sslmode=disable", false},
		{"prod keyword no sslmode", "prod", "host=db user=u password=" + pass, false},
		{"prod keyword mention in password", "prod", "host=db password='sslmode=verify-full' sslmode=disable", false},
		{"staging url disable", "staging", "postgres://u:" + pass + "@db/x?sslmode=disable", false},
		{"staging verify-full", "staging", "postgres://u:" + pass + "@db/x?sslmode=verify-full", true},
		{"dev disable", "dev", "postgres://u:" + pass + "@db/x?sslmode=disable", true},
		{"prod garbage", "prod", "nonsense " + pass, false},
		{"prod backslash hides sslmode in password", "prod", `host=db user=u password=ab\ sslmode=verify-full`, false},
		{"prod spaces around equals", "prod", "host=db user=u password=" + pass + " sslmode = verify-full", true},
		{"prod keyword verify-ca", "prod", "host=db user=u password=" + pass + " sslmode=verify-ca", false},
		{"prod keyword require", "prod", "host=db user=u password=" + pass + " sslmode=require", false},
		{"prod keyword prefer", "prod", "host=db user=u password=" + pass + " sslmode=prefer", false},
		{"prod keyword duplicate last wins ok", "prod", "host=db password=" + pass + " sslmode=disable sslmode=verify-full", true},
		{"prod keyword duplicate last wins bad", "prod", "host=db password=" + pass + " sslmode=verify-full sslmode=disable", false},
		{"prod uppercase mode", "prod", "host=db password=" + pass + " sslmode=VERIFY-FULL", false},
		{"prod url raw verify-full in password", "prod", "postgres://u:sslmode=verify-full@db/x", false},
		{"prod url encoded verify-full in password", "prod", "postgres://u:sslmode%3Dverify-full@db/x", false},
		{"prod url verify-full with password text", "prod", "postgres://u:sslmode%3Dverify-full@db/x?sslmode=verify-full", true},
		{"prod verify-full url with host list", "prod", "postgres://u:" + pass + "@a,b/x?sslmode=verify-full", true},
	}
	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			l := NewLoader(mapSource(map[string]string{"APP_ENV": c.env, "DSN": c.dsn}))
			l.Env()
			got := l.PostgresDSN("DSN")
			err := l.Err()
			if c.ok {
				if err != nil || got != c.dsn {
					t.Fatalf("got %q, err %v", got, err)
				}
				return
			}
			if err == nil || !strings.Contains(err.Error(), "DSN") {
				t.Fatalf("want error naming DSN, got %v", err)
			}
			if strings.Contains(err.Error(), pass) {
				t.Fatalf("error leaks the password: %v", err)
			}
		})
	}
}

func TestPostgresDSNRequired(t *testing.T) {
	l := NewLoader(mapSource(map[string]string{"APP_ENV": "dev"}))
	l.Env()
	l.PostgresDSN("DSN")
	if err := l.Err(); err == nil || !strings.Contains(err.Error(), "DSN") {
		t.Fatalf("want error naming DSN, got %v", err)
	}
}

func TestProdRequiresHTTPSOTLP(t *testing.T) {
	cases := []struct {
		env, val string
		ok       bool
	}{
		{"prod", "https://otel:4317", true},
		{"prod", "HTTPS://otel:4317", true},
		{"prod", "http://otel:4317", false},
		{"prod", "otel:4317", false},
		{"prod", "", true}, // телеметрия выключена
		{"staging", "http://otel:4317", false},
		{"dev", "http://otel:4317", true},
	}
	for _, c := range cases {
		l := NewLoader(mapSource(map[string]string{"APP_ENV": c.env, "OTLP": c.val}))
		l.Env()
		got := l.OTLPEndpoint("OTLP")
		err := l.Err()
		if c.ok && (err != nil || got != c.val) {
			t.Errorf("%s %q: got %q, err %v", c.env, c.val, got, err)
		}
		if !c.ok && (err == nil || !strings.Contains(err.Error(), "OTLP")) {
			t.Errorf("%s %q: want error naming OTLP, got %v", c.env, c.val, err)
		}
	}
}

func TestPostgresDSNHonoursPGSSLMODE(t *testing.T) {
	t.Setenv("PGSSLMODE", "verify-full")
	l := NewLoader(mapSource(map[string]string{"APP_ENV": "prod", "DSN": "host=db user=u"}))
	l.Env()
	l.PostgresDSN("DSN")
	if err := l.Err(); err != nil {
		t.Fatalf("PGSSLMODE=verify-full is what the driver will use: %v", err)
	}
}
