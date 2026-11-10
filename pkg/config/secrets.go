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
	if l.strict() {
		l.distinct(l.keyEntries(keys), true)
	}
}

// NamedKey — ключ, который вызывающий пакет уже разобрал из составной переменной
// (например, один ключ из списка kid:base64): Name называет его в ошибке, Value — байты.
type NamedKey struct {
	Name  string
	Value []byte
}

// DistinctWith сравнивает уже разобранные ключи values между собой и с прочтениями
// переменных keys (как Distinct). Пары «переменная — переменная» не сравниваются: это
// работа Distinct, и одно нарушение не попадает в ошибку дважды.
func (l *Loader) DistinctWith(values []NamedKey, keys ...string) {
	if !l.strict() {
		return
	}
	entries := make([]secretEntry, 0, len(values)+len(keys))
	for _, v := range values {
		if len(v.Value) > 0 {
			entries = append(entries, secretEntry{name: v.Name, readings: [][]byte{v.Value}, parsed: true})
		}
	}
	l.distinct(append(entries, l.keyEntries(keys)...), false)
}

type secretEntry struct {
	name     string
	readings [][]byte
	parsed   bool // ключ из values DistinctWith, а не переменная
}

// keyEntries — прочтения заданных переменных; незаданные пропускаются.
func (l *Loader) keyEntries(keys []string) []secretEntry {
	entries := make([]secretEntry, 0, len(keys))
	for _, k := range keys {
		v, _ := l.src(k)
		if v == "" {
			continue
		}
		e := secretEntry{name: k, readings: [][]byte{[]byte(v)}}
		if decoded, err := base64.StdEncoding.DecodeString(v); err == nil && len(decoded) > 0 {
			e.readings = append(e.readings, decoded)
		}
		entries = append(entries, e)
	}
	return entries
}

// distinct сообщает о совпавших парах; withVars=false пропускает пары из двух переменных.
func (l *Loader) distinct(entries []secretEntry, withVars bool) {
	reported := make(map[int]bool)
	for i := range entries {
		for j := i + 1; j < len(entries); j++ {
			if !withVars && !entries[i].parsed && !entries[j].parsed {
				continue
			}
			if sameKey(entries[i].readings, entries[j].readings) && (!reported[i] || !reported[j]) {
				l.fail("%s and %s: must be distinct but have the same value", entries[i].name, entries[j].name)
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
