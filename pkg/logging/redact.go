package logging

import (
	"log/slog"
	"regexp"
	"strings"
	"unicode"
)

const redacted = "[redacted]"

// Подстроки, при которых значение ключа не попадает в лог (без учёта регистра):
// clientPhone, binIinEnc, messageText — тоже. Список перенесён из apps/web/src/platform/logger.ts
// один к одному; email и instagram добавлены по ревью.
var secretKeyParts = []string{
	"iin", "bin", "phone", "code", "otp", "token", "password", "secret", "authorization",
	"cookie", "signature", "text", "body", "fullname", "address", "legalname", "comment",
	"report", "description", "position", "iban",
	"email", "instagram",
}

// Короткие имена ("ip", "lat", "lng") как подстрока скрыли бы "zip", "platform", "template",
// поэтому они совпадают только как целое слово ключа: client_ip, clientIP, lat.
var secretKeyWords = map[string]struct{}{
	"ip": {}, "lat": {}, "lng": {}, "latitude": {}, "longitude": {},
}

func keyIsSecret(key string) bool {
	lower := strings.ToLower(key)
	for _, part := range secretKeyParts {
		if strings.Contains(lower, part) {
			return true
		}
	}
	for _, w := range splitWords(key) {
		if _, ok := secretKeyWords[w]; ok {
			return true
		}
	}
	return false
}

// splitWords режет ключ по не-буквам/цифрам и по границе camelCase, слова в нижнем регистре.
func splitWords(key string) []string {
	var words []string
	var cur []rune
	flush := func() {
		if len(cur) > 0 {
			words = append(words, strings.ToLower(string(cur)))
			cur = cur[:0]
		}
	}
	var prev rune
	for _, r := range key {
		switch {
		case !unicode.IsLetter(r) && !unicode.IsDigit(r):
			flush()
		case unicode.IsUpper(r) && unicode.IsLower(prev):
			flush()
			cur = append(cur, r)
		default:
			cur = append(cur, r)
		}
		prev = r
	}
	flush()
	return words
}

// В Go (RE2) нет lookbehind/lookahead, поэтому «не после X» проверяется вручную (lookbehind),
// а «не перед Y» входит в само выражение последним символом-разделителем (trailing).
type textPattern struct {
	re     *regexp.Regexp // группа 1 — то, что маскируется; после неё — разделитель или конец строки
	before func(prev byte) bool
}

func isAlnum(b byte) bool {
	return b >= '0' && b <= '9' || b >= 'a' && b <= 'z' || b >= 'A' && b <= 'Z'
}

func isDigit(b byte) bool { return b >= '0' && b <= '9' }

// Порядок важен: IBAN — первым, в нём бывает 12 цифр подряд.
var textPatterns = []textPattern{
	// IBAN: KZ + 18 знаков, можно группами по 4.
	{regexp.MustCompile(`(?i)(KZ\d{2}(?:\s?[A-Z0-9]{4}){4})(?:[^A-Za-z0-9]|$)`), func(p byte) bool { return !isAlnum(p) }},
	// 12 цифр подряд (ИИН/БИН).
	{regexp.MustCompile(`(\d{12})(?:\D|$)`), func(p byte) bool { return !isDigit(p) }},
	// Телефоны: +7 700 123 45 67, 8(700)123-45-67, 87001234567.
	{regexp.MustCompile(`((?:\+\s?\d{1,3}|[78])[\s\-()]*\d{3}[\s\-()]*\d{3}[\s-]*\d{2}[\s-]*\d{2})(?:\D|$)`), func(p byte) bool { return !isDigit(p) && p != '+' }},
}

func (p textPattern) mask(s string) string {
	var b strings.Builder
	pos, last := 0, 0
	for pos <= len(s) {
		loc := p.re.FindStringSubmatchIndex(s[pos:])
		if loc == nil {
			break
		}
		start, end := pos+loc[2], pos+loc[3]
		if start > 0 && !p.before(s[start-1]) {
			pos = start + 1
			continue
		}
		b.WriteString(s[last:start])
		b.WriteString(redacted)
		last, pos = end, end
	}
	if last == 0 {
		return s
	}
	b.WriteString(s[last:])
	return b.String()
}

// Redact маскирует в тексте IBAN, 12 цифр подряд (ИИН/БИН) и телефоны.
func Redact(v string) string {
	for _, p := range textPatterns {
		v = p.mask(v)
	}
	return v
}

// replaceAttr скрывает значения по имени ключа (в том числе внутри групп) и шаблоны в строках.
func replaceAttr(groups []string, a slog.Attr) slog.Attr {
	if len(groups) == 0 {
		switch a.Key {
		case slog.TimeKey, slog.LevelKey, slog.SourceKey:
			return a
		case slog.MessageKey:
			return slog.String(a.Key, Redact(a.Value.String()))
		}
	}
	if keyIsSecret(a.Key) {
		return slog.String(a.Key, redacted)
	}
	for _, g := range groups {
		if keyIsSecret(g) {
			return slog.String(a.Key, redacted)
		}
	}
	v := a.Value.Resolve()
	switch v.Kind() {
	case slog.KindString:
		return slog.String(a.Key, Redact(v.String()))
	case slog.KindAny:
		if err, ok := v.Any().(error); ok {
			return slog.String(a.Key, Redact(err.Error()))
		}
	default:
	}
	return slog.Attr{Key: a.Key, Value: v}
}
