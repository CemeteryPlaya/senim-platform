// Package pii шифрует персональные данные (ИИН/БИН, IBAN, секрет TOTP) и строит по ним
// слепой индекс для поиска и уникальности без расшифровки.
//
// Шифрование конвертное: у каждого значения свой случайный ключ данных (AES-256-GCM),
// а ключ данных зашифрован ключом шифрования ключей (KEK, тоже AES-256-GCM), который
// назван идентификатором kid. Формат шифртекста:
//
//	v2.<kid>.<base64url(обёрнутый ключ данных)>.<base64url(nonce‖шифртекст‖tag)>
//
// AAD привязывает значение к месту хранения — "identity.<таблица>.<поле>:<user_id>":
// шифртекст, перенесённый в чужую строку, не расшифровывается. Смена KEK перешифровывает
// только ключ данных (Rewrap); значения под прежним kid читаются, пока kid есть в конфиге.
//
// TODO(KMS): когда выбрано облако РК, обёртка ключа данных переходит в его KMS отдельной
// реализацией (KEK не покидает KMS); формат шифртекста и AAD при этом не меняются.
package pii

import (
	"errors"
	"unicode/utf8"
)

var (
	// ErrUnknownKID — шифртекст под kid, которого нет в конфиге (PII_KEKS).
	ErrUnknownKID = errors.New("pii: unknown kid")
	// ErrMalformed — строка не в формате v2.<kid>.<ключ>.<значение>.
	ErrMalformed = errors.New("pii: malformed ciphertext")
	// ErrAuth — проверка подлинности не прошла: неверный ключ, AAD или подмена байтов.
	ErrAuth = errors.New("pii: authentication failed")
	// ErrEmptyAAD — AAD пуст: значение не привязано к строке (user_id), такой вызов —
	// ошибка программы, а не данных.
	ErrEmptyAAD = errors.New("pii: empty aad")
)

// Last4 возвращает последние 4 символа (руны) строки — то, что показывается в интерфейсе;
// строка короче — целиком (как last4 в apps/web).
func Last4(s string) string {
	if utf8.RuneCountInString(s) <= 4 {
		return s
	}
	i := len(s)
	for n := 0; n < 4; n++ {
		_, size := utf8.DecodeLastRuneInString(s[:i])
		i -= size
	}
	return s[i:]
}
