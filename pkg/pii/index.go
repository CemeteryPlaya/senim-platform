package pii

import (
	"bytes"
	"crypto/hmac"
	"crypto/sha256"
)

// Домены слепого индекса: одно и то же значение в разных доменах даёт разные индексы.
const (
	DomainIIN    = "iin"
	DomainBINIIN = "bin_iin"
)

// Index — слепой индекс: детерминированный HMAC для уникальности и поиска без расшифровки.
type Index struct {
	key []byte
}

// NewIndex создаёт индекс; ключ копируется.
func NewIndex(key []byte) *Index {
	return &Index{key: bytes.Clone(key)}
}

// Of — HMAC-SHA256(key, domain ‖ 0x00 ‖ normalized). Значение передаётся уже
// нормализованным (ИИН/БИН — 12 цифр); домен — константа Domain*.
func (i *Index) Of(domain, normalized string) []byte {
	m := hmac.New(sha256.New, i.key)
	m.Write([]byte(domain))
	m.Write([]byte{0})
	m.Write([]byte(normalized))
	return m.Sum(nil)
}
