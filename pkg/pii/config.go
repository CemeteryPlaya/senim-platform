package pii

import (
	"encoding/base64"
	"fmt"
	"strings"

	"github.com/CemeteryPlaya/senim-platform/pkg/config"
)

// Переменные конфигурации ключей ПДн.
const (
	// EnvKEKs — список KEK: "kid:base64,kid:base64" (base64 std от ровно 32 байт).
	EnvKEKs = "PII_KEKS"
	// EnvKEKCurrent — kid, которым шифруются новые значения; обязан быть в EnvKEKs.
	EnvKEKCurrent = "PII_KEK_CURRENT"
	// EnvIndexKey — ключ слепого индекса (base64, вне dev не меньше 32 байт).
	EnvIndexKey = "PII_INDEX_KEY"
)

// indexKeyMin — минимальная длина ключа индекса вне dev.
const indexKeyMin = 32

// LoadKeyring читает PII_KEKS и PII_KEK_CURRENT. KEK — ровно 32 байта в любом окружении
// (иначе это не AES-256). Вне dev каждый KEK отличается от остальных KEK, от PII_INDEX_KEY
// и от секретов в переменных distinctFrom (например, IDENTITY_OTP_HMAC_KEY). Нарушения
// копятся в загрузчике и называют переменную и kid, но не значение; при нарушении — nil.
func LoadKeyring(l *config.Loader, distinctFrom ...string) *Keyring {
	raw := l.Required(EnvKEKs)
	current := l.Required(EnvKEKCurrent)
	if raw == "" {
		return nil
	}
	keks, named, ok := parseKEKs(l, raw)
	if !ok {
		return nil
	}
	l.DistinctWith(named, append([]string{EnvIndexKey}, distinctFrom...)...)
	if current == "" {
		return nil
	}
	if _, listed := keks[current]; !listed {
		l.Invalid(EnvKEKCurrent, fmt.Sprintf("kid %q is not listed in %s", current, EnvKEKs))
		return nil
	}
	k, err := NewKeyring(current, keks)
	if err != nil {
		l.Invalid(EnvKEKs, err.Error())
		return nil
	}
	return k
}

// parseKEKs разбирает "kid:base64,kid:base64"; пробелы вокруг элементов допустимы.
func parseKEKs(l *config.Loader, raw string) (map[string][]byte, []config.NamedKey, bool) {
	keks := make(map[string][]byte)
	var named []config.NamedKey
	ok := true
	for i, item := range strings.Split(raw, ",") {
		kid, enc, found := strings.Cut(strings.TrimSpace(item), ":")
		switch {
		case !found:
			l.Invalid(EnvKEKs, fmt.Sprintf("item %d: expected kid:base64", i+1))
			ok = false
			continue
		case !ValidKID(kid):
			l.Invalid(EnvKEKs, fmt.Sprintf("item %d: kid must match [a-z0-9-]{1,32}", i+1))
			ok = false
			continue
		case keks[kid] != nil:
			l.Invalid(EnvKEKs, fmt.Sprintf("kid %q is listed twice", kid))
			ok = false
			continue
		}
		key, err := base64.StdEncoding.DecodeString(enc)
		if err != nil {
			l.Invalid(EnvKEKs, fmt.Sprintf("kid %q: key must be standard base64", kid))
			ok = false
			continue
		}
		if len(key) != keySize {
			l.Invalid(EnvKEKs, fmt.Sprintf("kid %q: key must be exactly %d bytes (got %d)", kid, keySize, len(key)))
			ok = false
			continue
		}
		keks[kid] = key
		named = append(named, config.NamedKey{Name: fmt.Sprintf("%s (kid %q)", EnvKEKs, kid), Value: key})
	}
	return keks, named, ok
}

// LoadIndex читает PII_INDEX_KEY: вне dev — base64 не короче 32 байт (config.Secret) и
// отличается от секретов в переменных distinctFrom. При нарушении — nil.
func LoadIndex(l *config.Loader, distinctFrom ...string) *Index {
	key := l.Secret(EnvIndexKey, indexKeyMin)
	// Попарно только с индексом: пары между distinctFrom проверяет их владелец.
	for _, other := range distinctFrom {
		l.Distinct(EnvIndexKey, other)
	}
	if key == nil {
		return nil
	}
	return NewIndex(key)
}
