package internal

import (
	"strings"
	"unicode"
)

// parsePhone разбирает казахстанский мобильный номер из пользовательского ввода
// («+7 700 …», «8 700 …», «700 …») и возвращает E.164 («+77001234567»).
// Правила apps/web/src/modules/identity/phone.ts: допустимы цифры, пробелы, «(», «)», «-» и
// один «+» в начале; мобильные номера РК начинаются с 7 после кода страны, остальное
// (в том числе +7 9xx) — недопустимо.
func parsePhone(raw string) (string, bool) {
	s := strings.TrimSpace(raw)
	digits := make([]byte, 0, 11)
	for i, r := range s {
		switch {
		case r >= '0' && r <= '9':
			digits = append(digits, byte(r))
		case r == '+' && i == 0:
		case r == '(' || r == ')' || r == '-' || unicode.IsSpace(r):
		default:
			return "", false
		}
	}
	national := digits
	if len(digits) == 11 && (digits[0] == '7' || digits[0] == '8') {
		national = digits[1:]
	}
	if len(national) != 10 || national[0] != '7' {
		return "", false
	}
	return "+7" + string(national), true
}
