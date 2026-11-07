package logging

import (
	"bytes"
	"encoding/json"
	"log/slog"
	"regexp"
	"strings"
	"unicode"
)

const redacted = "[redacted]"

// Подстроки, при которых значение ключа не попадает в лог (без учёта регистра):
// clientPhone, binIinEnc, messageText — тоже. Список перенесён из apps/web/src/platform/logger.ts
// один к одному; email и instagram добавлены по ревью.
var sensitiveKeyParts = []string{
	"iin", "bin", "phone", "code", "otp", "token", "password", "secret", "authorization",
	"cookie", "signature", "text", "body", "fullname", "address", "legalname", "comment",
	"report", "description", "position", "iban",
	"email", "instagram",
}

// Короткие имена ("ip", "lat", "lng", "addr") как подстрока скрыли бы "zip", "platform", "template",
// поэтому они совпадают только как целое слово ключа: client_ip, clientIP, IPAddr, remote_addr, lat.
var sensitiveKeyWords = map[string]struct{}{
	"ip": {}, "lat": {}, "lng": {}, "latitude": {}, "longitude": {},
	"addr": {}, "clientip": {}, "remoteip": {}, "latlng": {},
}

func keyIsSensitive(key string) bool {
	lower := strings.ToLower(key)
	for _, part := range sensitiveKeyParts {
		if strings.Contains(lower, part) {
			return true
		}
	}
	for _, w := range splitWords(key) {
		if _, ok := sensitiveKeyWords[w]; ok {
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
	rs := []rune(key)
	for i, r := range rs {
		if !unicode.IsLetter(r) && !unicode.IsDigit(r) {
			flush()
			continue
		}
		if unicode.IsUpper(r) && i > 0 {
			prev := rs[i-1]
			nextLower := i+1 < len(rs) && unicode.IsLower(rs[i+1])
			// clientIP -> client|IP; IPAddr -> IP|Addr.
			if unicode.IsLower(prev) || (unicode.IsUpper(prev) && nextLower) {
				flush()
			}
		}
		cur = append(cur, r)
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

const maxDepth = 5

// Идентификаторы (deal_id, trace_id, span_id, UUID) не маскируются по шаблонам значений:
// в них 12 цифр подряд встречаются случайно. Маска по имени ключа действует и для них.
func isIDKey(key string) bool {
	return key == "id" || strings.HasSuffix(key, "_id") || strings.HasSuffix(key, "Id")
}

// walk рекурсивно скрывает ПДн в произвольном значении; глубже maxDepth значение не пишется.
func walk(v any, depth int) any {
	if depth > maxDepth {
		return redacted
	}
	switch x := v.(type) {
	case nil, bool, json.Number, int, int8, int16, int32, int64, uint, uint8, uint16, uint32, uint64, float32, float64:
		return x
	case string:
		return Redact(x)
	case error:
		return Redact(x.Error())
	case map[string]any:
		out := make(map[string]any, len(x))
		for k, val := range x {
			out[k] = walkField(k, val, depth+1)
		}
		return out
	case []any:
		out := make([]any, len(x))
		for i, val := range x {
			out[i] = walk(val, depth+1)
		}
		return out
	default:
		// Структуры, указатели, типизированные map/slice: через JSON, чтобы увидеть имена полей.
		raw, err := json.Marshal(x)
		if err != nil {
			return redacted
		}
		dec := json.NewDecoder(bytes.NewReader(raw))
		dec.UseNumber()
		var generic any
		if err := dec.Decode(&generic); err != nil {
			return redacted
		}
		return walk(generic, depth)
	}
}

func walkField(key string, v any, depth int) any {
	if keyIsSensitive(key) {
		return redacted
	}
	if s, ok := v.(string); ok && isIDKey(key) {
		return s
	}
	return walk(v, depth)
}

// replaceAttr скрывает значения по имени ключа (в том числе внутри групп) и шаблоны в значениях.
func replaceAttr(groups []string, a slog.Attr) slog.Attr {
	v := a.Value.Resolve()
	if len(groups) == 0 {
		switch a.Key {
		case slog.TimeKey:
			if v.Kind() == slog.KindTime {
				return a
			}
		case slog.LevelKey:
			if _, ok := v.Any().(slog.Level); ok {
				return a
			}
		case slog.SourceKey:
			if _, ok := v.Any().(*slog.Source); ok {
				return a
			}
		case slog.MessageKey:
			if v.Kind() == slog.KindString {
				return slog.String(a.Key, Redact(v.String()))
			}
		}
	}
	if keyIsSensitive(a.Key) {
		return slog.String(a.Key, redacted)
	}
	for _, g := range groups {
		if keyIsSensitive(g) {
			return slog.String(a.Key, redacted)
		}
	}
	switch v.Kind() {
	case slog.KindString:
		if isIDKey(a.Key) {
			return slog.Attr{Key: a.Key, Value: v}
		}
		return slog.String(a.Key, Redact(v.String()))
	case slog.KindAny:
		return slog.Any(a.Key, walk(v.Any(), 0))
	default:
		return slog.Attr{Key: a.Key, Value: v}
	}
}
