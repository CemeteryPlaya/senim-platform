package pii

import (
	"crypto/aes"
	"crypto/cipher"
	"crypto/rand"
	"encoding/base64"
	"errors"
	"fmt"
	"regexp"
	"strings"
)

const (
	version   = "v2"
	keySize   = 32 // AES-256: и ключ данных, и KEK
	nonceSize = 12
	tagSize   = 16
	// wrappedSize — обёрнутый ключ данных: nonce‖шифртекст ключа‖tag.
	wrappedSize = nonceSize + keySize + tagSize
)

var (
	kidPattern = regexp.MustCompile(`^[a-z0-9-]{1,32}$`)
	// Strict: лишние биты в последнем символе — ошибка, у шифртекста одно написание.
	b64url = base64.RawURLEncoding.Strict()
)

// ValidKID сообщает, подходит ли строка в идентификаторы ключа: [a-z0-9-]{1,32}.
func ValidKID(kid string) bool { return kidPattern.MatchString(kid) }

// Keyring — набор KEK по kid и текущий kid, которым шифруются новые значения.
// Безопасен для одновременного использования.
type Keyring struct {
	current string
	keks    map[string]cipher.AEAD
}

// NewKeyring собирает набор KEK. Ключи — ровно 32 байта, kid — [a-z0-9-]{1,32}, текущий kid
// обязан быть в наборе. Ошибки называют kid и никогда не содержат ключ.
func NewKeyring(currentKID string, keks map[string][]byte) (*Keyring, error) {
	if len(keks) == 0 {
		return nil, errors.New("pii: no keys")
	}
	k := &Keyring{current: currentKID, keks: make(map[string]cipher.AEAD, len(keks))}
	for kid, key := range keks {
		if !ValidKID(kid) {
			return nil, fmt.Errorf("pii: kid %q: expected [a-z0-9-]{1,32}", kid)
		}
		if len(key) != keySize {
			return nil, fmt.Errorf("pii: kid %q: key must be exactly %d bytes", kid, keySize)
		}
		aead, err := newAEAD(key)
		if err != nil {
			return nil, fmt.Errorf("pii: kid %q: %w", kid, err)
		}
		k.keks[kid] = aead
	}
	if _, ok := k.keks[currentKID]; !ok {
		return nil, fmt.Errorf("pii: current kid %q is not in the key list", currentKID)
	}
	return k, nil
}

// Current — kid, которым шифруются новые значения.
func (k *Keyring) Current() string { return k.current }

// Seal шифрует plain новым случайным ключом данных и оборачивает его текущим KEK.
// aad — место хранения: "identity.<таблица>.<поле>:<user_id>".
func (k *Keyring) Seal(plain []byte, aad string) (string, error) {
	dek := make([]byte, keySize)
	if _, err := rand.Read(dek); err != nil {
		return "", fmt.Errorf("pii: data key: %w", err)
	}
	defer clear(dek)
	value, err := sealWith(dek, plain, []byte(aad))
	if err != nil {
		return "", err
	}
	return k.wrap(dek, value, aad)
}

// Open расшифровывает шифртекст: ErrMalformed — не тот формат, ErrUnknownKID — kid нет
// в наборе, ErrAuth — неверный AAD, ключ или подменённые байты.
func (k *Keyring) Open(blob, aad string) ([]byte, error) {
	_, dek, value, err := k.unwrap(blob, aad)
	if err != nil {
		return nil, err
	}
	defer clear(dek)
	return openWith(dek, value, []byte(aad))
}

// Rewrap перешифровывает только ключ данных под текущим kid; шифртекст значения не
// меняется. false — шифртекст уже под текущим kid и возвращается как есть. Значение
// проверяется целиком: испорченный шифртекст не переносится под новый ключ молча.
func (k *Keyring) Rewrap(blob, aad string) (string, bool, error) {
	kid, dek, value, err := k.unwrap(blob, aad)
	if err != nil {
		return "", false, err
	}
	defer clear(dek)
	plain, err := openWith(dek, value, []byte(aad))
	if err != nil {
		return "", false, err
	}
	clear(plain)
	if kid == k.current {
		return blob, false, nil
	}
	out, err := k.wrap(dek, value, aad)
	if err != nil {
		return "", false, err
	}
	return out, true, nil
}

// KIDOf возвращает kid шифртекста, не расшифровывая его и не требуя, чтобы kid был
// в наборе (так находятся значения под ключом, убранным из конфига).
func (k *Keyring) KIDOf(blob string) (string, error) {
	kid, _, _, err := parse(blob)
	return kid, err
}

// wrap оборачивает ключ данных текущим KEK и собирает строку шифртекста.
func (k *Keyring) wrap(dek, value []byte, aad string) (string, error) {
	nonce := make([]byte, nonceSize)
	if _, err := rand.Read(nonce); err != nil {
		return "", fmt.Errorf("pii: nonce: %w", err)
	}
	wrapped := k.keks[k.current].Seal(nonce, nonce, dek, wrapAAD(k.current, aad))
	return strings.Join([]string{version, k.current, b64url.EncodeToString(wrapped), b64url.EncodeToString(value)}, "."), nil
}

// unwrap разбирает шифртекст и расшифровывает ключ данных KEK по его kid.
func (k *Keyring) unwrap(blob, aad string) (kid string, dek, value []byte, err error) {
	kid, wrapped, value, err := parse(blob)
	if err != nil {
		return "", nil, nil, err
	}
	kek, ok := k.keks[kid]
	if !ok {
		return "", nil, nil, fmt.Errorf("%w: %q", ErrUnknownKID, kid)
	}
	dek, err = kek.Open(nil, wrapped[:nonceSize], wrapped[nonceSize:], wrapAAD(kid, aad))
	if err != nil {
		return "", nil, nil, ErrAuth
	}
	return kid, dek, value, nil
}

// wrapAAD привязывает обёрнутый ключ данных и к kid, и к месту хранения значения:
// ключ данных из чужой строки или под чужим kid не разворачивается. kid не содержит 0x00.
func wrapAAD(kid, aad string) []byte {
	return []byte("senim.pii.v2.dek\x00" + kid + "\x00" + aad)
}

// parse проверяет формат v2.<kid>.<ключ>.<значение>; любое отклонение — ErrMalformed.
func parse(blob string) (kid string, wrapped, value []byte, err error) {
	// Декодер base64 пропускает CR и LF; с ними у шифртекста было бы несколько написаний.
	if strings.ContainsAny(blob, "\r\n") {
		return "", nil, nil, ErrMalformed
	}
	parts := strings.Split(blob, ".")
	if len(parts) != 4 || parts[0] != version || !ValidKID(parts[1]) {
		return "", nil, nil, ErrMalformed
	}
	wrapped, err = b64url.DecodeString(parts[2])
	if err != nil || len(wrapped) != wrappedSize {
		return "", nil, nil, ErrMalformed
	}
	value, err = b64url.DecodeString(parts[3])
	if err != nil || len(value) < nonceSize+tagSize {
		return "", nil, nil, ErrMalformed
	}
	return parts[1], wrapped, value, nil
}

func newAEAD(key []byte) (cipher.AEAD, error) {
	block, err := aes.NewCipher(key)
	if err != nil {
		return nil, err
	}
	return cipher.NewGCM(block)
}

// sealWith шифрует plain ключом key: nonce‖шифртекст‖tag.
func sealWith(key, plain, aad []byte) ([]byte, error) {
	aead, err := newAEAD(key)
	if err != nil {
		return nil, fmt.Errorf("pii: %w", err)
	}
	nonce := make([]byte, nonceSize, nonceSize+len(plain)+tagSize)
	if _, err := rand.Read(nonce); err != nil {
		return nil, fmt.Errorf("pii: nonce: %w", err)
	}
	return aead.Seal(nonce, nonce, plain, aad), nil
}

func openWith(key, sealed, aad []byte) ([]byte, error) {
	aead, err := newAEAD(key)
	if err != nil {
		return nil, ErrAuth
	}
	plain, err := aead.Open(nil, sealed[:nonceSize], sealed[nonceSize:], aad)
	if err != nil {
		return nil, ErrAuth
	}
	return plain, nil
}
