package internal

import (
	"crypto/hmac"
	"crypto/sha1" //nolint:gosec // RFC 6238/4226: HMAC-SHA1 — алгоритм TOTP, который понимают все приложения-аутентификаторы
	"crypto/subtle"
	"encoding/binary"
	"fmt"
	"strings"
	"time"
)

const (
	// totpPeriod — длина шага TOTP в секундах (RFC 6238, по умолчанию у приложений).
	totpPeriod = 30
	// totpDigits — число цифр кода.
	totpDigits = 6
	// totpSkew — сколько шагов в каждую сторону принимается (расхождение часов телефона).
	totpSkew = 1
	// totpSecretBytes — длина секрета: 160 бит (RFC 4226 рекомендует не меньше 128),
	// в base32 это ровно 32 символа.
	totpSecretBytes = 20
)

// totpCode — код TOTP для шага step (RFC 6238 поверх HOTP RFC 4226, HMAC-SHA1):
// шесть цифр с ведущими нулями.
func totpCode(secret []byte, step int64) string {
	var msg [8]byte
	binary.BigEndian.PutUint64(msg[:], uint64(step)) //nolint:gosec // шаг — время/30, неотрицателен
	m := hmac.New(sha1.New, secret)
	m.Write(msg[:])
	sum := m.Sum(nil)
	off := sum[len(sum)-1] & 0x0f
	bin := binary.BigEndian.Uint32(sum[off:off+4]) & 0x7fffffff
	return fmt.Sprintf("%0*d", totpDigits, bin%1_000_000)
}

// validTotpFormat — ровно шесть ASCII-цифр.
func validTotpFormat(code string) bool {
	if len(code) != totpDigits {
		return false
	}
	for i := range len(code) {
		if code[i] < '0' || code[i] > '9' {
			return false
		}
	}
	return true
}

// totpMatch ищет шаг окна ±totpSkew вокруг now, код которого равен code; среди шагов
// больше minStep. Сравнение — за постоянное время по каждому шагу окна.
func totpMatch(secret []byte, code string, now time.Time, minStep int64) (step int64, ok bool) {
	code = strings.TrimSpace(code)
	if !validTotpFormat(code) {
		return 0, false
	}
	cur := now.Unix() / totpPeriod
	for s := cur - totpSkew; s <= cur+totpSkew; s++ {
		if s <= minStep {
			continue
		}
		if subtle.ConstantTimeCompare([]byte(totpCode(secret, s)), []byte(code)) == 1 && !ok {
			step, ok = s, true
		}
	}
	return step, ok
}

// totpVerify проверяет код: окно ±1 шаг по 30 с, шесть цифр. Шаг, не больший lastUsed
// (последнего принятого), не принимается — один код не проходит дважды. Возвращает шаг
// принятого кода.
func totpVerify(secret []byte, code string, now time.Time, lastUsed int64) (step int64, ok bool) {
	return totpMatch(secret, code, now, lastUsed)
}
