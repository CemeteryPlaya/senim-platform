package config

import (
	"bytes"
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
//
// Сравниваются байты ключа, а не строки: у каждого значения два прочтения — сырые
// байты и результат base64-декодирования (если строка им разбирается). Два значения
// совпадают, если совпало любое прочтение, — так ловится один ключ, записанный в
// одной переменной в base64, а в другой сырым.
func (l *Loader) Distinct(keys ...string) {
	if !l.strict() {
		return
	}
	readings := make([][][]byte, len(keys))
	for i, k := range keys {
		v, _ := l.src(k)
		if v == "" {
			continue
		}
		readings[i] = [][]byte{[]byte(v)}
		if decoded, err := base64.StdEncoding.DecodeString(v); err == nil && len(decoded) > 0 {
			readings[i] = append(readings[i], decoded)
		}
	}
	reported := make(map[int]bool)
	for i := range keys {
		for j := i + 1; j < len(keys); j++ {
			if sameKey(readings[i], readings[j]) && (!reported[i] || !reported[j]) {
				l.fail("%s and %s: must be distinct but have the same value", keys[i], keys[j])
				reported[i], reported[j] = true, true
			}
		}
	}
}

func sameKey(a, b [][]byte) bool {
	for _, x := range a {
		for _, y := range b {
			if bytes.Equal(x, y) {
				return true
			}
		}
	}
	return false
}
