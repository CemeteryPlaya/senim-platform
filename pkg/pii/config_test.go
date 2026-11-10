package pii

import (
	"encoding/base64"
	"strings"
	"testing"

	"github.com/CemeteryPlaya/senim-platform/pkg/config"
)

func b64(n int, fill byte) string {
	return base64.StdEncoding.EncodeToString([]byte(strings.Repeat(string(fill), n)))
}

// piiVars — рабочий набор prod: два ключа, текущий второй, индекс и чужой секрет отдельно.
func piiVars() map[string]string {
	return map[string]string{ //nolint:gosec // тестовые значения, не секреты
		"APP_ENV":         "prod",
		"PII_KEKS":        "k1:" + b64(32, '1') + ",k2:" + b64(32, '2'),
		"PII_KEK_CURRENT": "k2",
		"PII_INDEX_KEY":   b64(32, 'i'),
		"OTHER_SECRET":    b64(32, 'o'),
	}
}

func loadPII(vars map[string]string) (*Keyring, *Index, error) {
	l := config.NewLoader(func(k string) (string, bool) { v, ok := vars[k]; return v, ok })
	k := LoadKeyring(l, "OTHER_SECRET")
	i := LoadIndex(l, "OTHER_SECRET")
	return k, i, l.Err()
}

func mustFailNaming(t *testing.T, vars map[string]string, names ...string) {
	t.Helper()
	_, _, err := loadPII(vars)
	if err == nil {
		t.Fatalf("expected error naming %v", names)
	}
	for _, n := range names {
		if !strings.Contains(err.Error(), n) {
			t.Errorf("error must name %s: %v", n, err)
		}
	}
	for _, name := range []string{"PII_KEKS", "PII_INDEX_KEY", "OTHER_SECRET"} {
		for _, part := range strings.Split(vars[name], ",") {
			_, secret, _ := strings.Cut(part, ":")
			if secret == "" {
				secret = part
			}
			if len(secret) >= 8 && strings.Contains(err.Error(), secret) {
				t.Errorf("error leaks a secret value of %s: %v", name, err)
			}
		}
	}
}

func TestLoadKeyringProd(t *testing.T) {
	k, idx, err := loadPII(piiVars())
	if err != nil {
		t.Fatal(err)
	}
	if k == nil || idx == nil || k.Current() != "k2" {
		t.Fatalf("keyring %v, index %v", k, idx)
	}
	blob, err := k.Seal([]byte("x"), "a")
	if err != nil || !strings.HasPrefix(blob, "v2.k2.") {
		t.Fatalf("seal under current kid: %q, %v", blob, err)
	}
}

func TestLoadKeyringProdRejectsWeakOrSame(t *testing.T) {
	cases := map[string]struct {
		edit  func(v map[string]string)
		names []string
	}{
		"short kek":          {func(v map[string]string) { v["PII_KEKS"] = "k1:" + b64(16, '1') + ",k2:" + b64(32, '2') }, []string{"PII_KEKS", "k1"}},
		"long kek":           {func(v map[string]string) { v["PII_KEKS"] = "k1:" + b64(48, '1') + ",k2:" + b64(32, '2') }, []string{"PII_KEKS", "k1"}},
		"same keks":          {func(v map[string]string) { v["PII_KEKS"] = "k1:" + b64(32, '1') + ",k2:" + b64(32, '1') }, []string{"PII_KEKS", "k1", "k2"}},
		"kek equals index":   {func(v map[string]string) { v["PII_INDEX_KEY"] = b64(32, '2') }, []string{"PII_KEKS", "k2", "PII_INDEX_KEY"}},
		"kek equals other":   {func(v map[string]string) { v["OTHER_SECRET"] = b64(32, '1') }, []string{"PII_KEKS", "k1", "OTHER_SECRET"}},
		"index equals other": {func(v map[string]string) { v["OTHER_SECRET"] = b64(32, 'i') }, []string{"PII_INDEX_KEY", "OTHER_SECRET"}},
		"current not listed": {func(v map[string]string) { v["PII_KEK_CURRENT"] = "k3" }, []string{"PII_KEK_CURRENT"}},
		"short index":        {func(v map[string]string) { v["PII_INDEX_KEY"] = b64(16, 'i') }, []string{"PII_INDEX_KEY"}},
		"index not base64":   {func(v map[string]string) { v["PII_INDEX_KEY"] = "not base64 at all!!!!!!!!!!!!!!!!!!!" }, []string{"PII_INDEX_KEY"}},
		"kek not base64":     {func(v map[string]string) { v["PII_KEKS"] = "k1:!!!,k2:" + b64(32, '2') }, []string{"PII_KEKS", "k1"}},
		"no colon":           {func(v map[string]string) { v["PII_KEKS"] = b64(32, '2') }, []string{"PII_KEKS"}},
		"bad kid":            {func(v map[string]string) { v["PII_KEKS"] = "K_2:" + b64(32, '2'); v["PII_KEK_CURRENT"] = "K_2" }, []string{"PII_KEKS"}},
		"duplicate kid":      {func(v map[string]string) { v["PII_KEKS"] = "k2:" + b64(32, '1') + ",k2:" + b64(32, '2') }, []string{"PII_KEKS", "k2"}},
		"empty item":         {func(v map[string]string) { v["PII_KEKS"] = "k2:" + b64(32, '2') + "," }, []string{"PII_KEKS"}},
		"missing all": {func(v map[string]string) {
			delete(v, "PII_KEKS")
			delete(v, "PII_KEK_CURRENT")
			delete(v, "PII_INDEX_KEY")
		}, []string{"PII_KEKS", "PII_KEK_CURRENT", "PII_INDEX_KEY"}},
	}
	for name, c := range cases {
		t.Run(name, func(t *testing.T) {
			v := piiVars()
			c.edit(v)
			mustFailNaming(t, v, c.names...)
		})
	}
}

func TestLoadKeyringDev(t *testing.T) {
	v := piiVars()
	v["APP_ENV"] = "dev"
	// В dev повторы допустимы (как у config.Distinct), индекс может быть сырой строкой.
	v["PII_KEKS"] = "k1:" + b64(32, '1') + ", k2:" + b64(32, '1')
	v["PII_INDEX_KEY"] = "dev-index-key"
	k, idx, err := loadPII(v)
	if err != nil || k == nil || idx == nil {
		t.Fatalf("dev: %v", err)
	}
	// Длина ключа шифрования — ровно 32 байта и в dev: иначе это не AES-256.
	v["PII_KEKS"] = "k2:" + b64(16, '1')
	mustFailNaming(t, v, "PII_KEKS", "k2")
}
