package config

import (
	"encoding/base64"
)

// Secret возвращает секрет: base64 (std), а в dev допустимы и сырые байты.
// В prod/staging значение обязано быть base64, а после декодирования
// содержать не меньше minBytes байт. Значение секрета в ошибки не попадает.
func (l *Loader) Secret(key string, minBytes int) []byte {
	raw := l.Required(key)
	if raw == "" {
		return nil
	}
	decoded, err := base64.StdEncoding.DecodeString(raw)
	if !l.strict() {
		if err != nil {
			return []byte(raw)
		}
		return decoded
	}
	if err != nil {
		l.fail("%s: must be standard base64 when APP_ENV is not dev", key)
		return nil
	}
	if len(decoded) < minBytes {
		l.fail("%s: too short (%d bytes, need at least %d)", key, len(decoded), minBytes)
		return nil
	}
	return decoded
}

// Distinct требует, чтобы секреты по этим ключам были попарно различны.
// Проверяется в prod/staging; в dev повторы допустимы. Незаданные ключи
// пропускаются (о них сообщает Secret/Required).
func (l *Loader) Distinct(keys ...string) {
	if !l.strict() {
		return
	}
	values := make([]string, len(keys))
	for i, k := range keys {
		values[i], _ = l.src(k)
	}
	reported := make(map[int]bool)
	for i := range keys {
		if values[i] == "" {
			continue
		}
		for j := i + 1; j < len(keys); j++ {
			if values[j] == values[i] && !(reported[i] && reported[j]) {
				l.fail("%s and %s: must be distinct but have the same value", keys[i], keys[j])
				reported[i], reported[j] = true, true
			}
		}
	}
}
