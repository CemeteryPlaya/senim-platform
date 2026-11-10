package internal

import (
	"regexp"
	"strconv"
	"strings"
	"unicode/utf16"
)

// Проверки форматов — перенос один к одному из apps/web: ИИН/БИН — src/platform/kz-id.ts
// и src/modules/identity/kz-id.ts, ФИО — full-name.ts, Instagram и e-mail — instagram.ts
// (схема контактов contacts-profile.ts).

var (
	kzWeights1 = [11]int{1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11}
	kzWeights2 = [11]int{3, 4, 5, 6, 7, 8, 9, 10, 11, 1, 2}
)

// kzCheckDigit — контрольная цифра ИИН/БИН по алгоритму РК для 11 первых цифр; -1 — для
// такой основы номер не выдаётся (обе суммы дают 10) или основа — не 11 ASCII-цифр.
func kzCheckDigit(first11 string) int {
	if len(first11) != 11 || !asciiDigits(first11) {
		return -1
	}
	sum := func(w [11]int) int {
		s := 0
		for i := range 11 {
			s += int(first11[i]-'0') * w[i]
		}
		return s % 11
	}
	if first := sum(kzWeights1); first != 10 {
		return first
	}
	if second := sum(kzWeights2); second != 10 {
		return second
	}
	return -1
}

func asciiDigits(s string) bool {
	for i := range len(s) {
		if s[i] < '0' || s[i] > '9' {
			return false
		}
	}
	return true
}

// kzChecksumOK — 12 ASCII-цифр и верная контрольная цифра.
func kzChecksumOK(v string) bool {
	if len(v) != 12 || !asciiDigits(v) {
		return false
	}
	return kzCheckDigit(v[:11]) == int(v[11]-'0')
}

func twoDigits(s string) int {
	n, _ := strconv.Atoi(s)
	return n
}

func kzMonthOK(mm string) bool {
	m := twoDigits(mm)
	return m >= 1 && m <= 12
}

// validIIN — ИИН: ГГММДД, цифра века и пола 1–6, порядковый номер, контрольная цифра
// (isValidIin).
func validIIN(v string) bool {
	if !kzChecksumOK(v) {
		return false
	}
	day := twoDigits(v[4:6])
	centuryGender := int(v[6] - '0')
	return kzMonthOK(v[2:4]) && day >= 1 && day <= 31 && centuryGender >= 1 && centuryGender <= 6
}

// validBIN — БИН: ГГММ регистрации, тип организации 4–6, признак 0–3, номер, контрольная
// цифра (isValidBin).
func validBIN(v string) bool {
	if !kzChecksumOK(v) {
		return false
	}
	orgType := int(v[4] - '0')
	subdivision := int(v[5] - '0')
	return kzMonthOK(v[2:4]) && orgType >= 4 && orgType <= 6 && subdivision <= 3
}

// validBINorIIN — номер проходит как БИН или как ИИН (самозанятый и ИП работают по ИИН,
// ТОО — по БИН; какой нужен — решает правовая форма, binIinKindFor).
func validBINorIIN(v string) bool { return validIIN(v) || validBIN(v) }

// jsSpace — пробельный символ в смысле JavaScript (\s и String.prototype.trim):
// WhiteSpace и LineTerminator спецификации ECMAScript.
func jsSpace(r rune) bool {
	switch r {
	case 0x09, 0x0a, 0x0b, 0x0c, 0x0d, 0x20, 0xa0, 0x1680, 0x2028, 0x2029, 0x202f, 0x205f, 0x3000, 0xfeff:
		return true
	}
	return r >= 0x2000 && r <= 0x200a
}

// jsLen — длина строки в JavaScript (кодовые единицы UTF-16).
func jsLen(s string) int {
	n := 0
	for _, r := range s {
		n += utf16.RuneLen(r)
	}
	return n
}

// normalizeFullName — ФИО как в удостоверении: пробелы по краям убраны, внутри схлопнуты
// в один (normalizeFullName).
func normalizeFullName(v string) string {
	return strings.Join(strings.FieldsFunc(v, jsSpace), " ")
}

// validFullName — уже нормализованное ФИО: 5–120 символов, хотя бы фамилия и имя
// (isValidFullName).
func validFullName(name string) bool {
	n := jsLen(name)
	return n >= 5 && n <= 120 && strings.Contains(name, " ")
}

// instagramMax — ограничение Instagram на длину имени пользователя (INSTAGRAM_MAX).
const instagramMax = 30

var instagramRe = regexp.MustCompile(`^[A-Za-z0-9._]*$`)

// normalizeInstagram — Instagram без «@» (instagramField): пробелы по краям и одна
// ведущая «@» убираются; остальное — латиница, цифры, точка и подчёркивание, не длиннее
// 30. Пусто — не указан. ok=false — неверное имя; tooLong — причина отказа в длине.
func normalizeInstagram(raw string) (name string, ok bool) {
	name, _, ok = checkInstagram(raw)
	return name, ok
}

func checkInstagram(raw string) (name string, tooLong, ok bool) {
	name = strings.TrimPrefix(strings.TrimFunc(raw, jsSpace), "@")
	if jsLen(name) > instagramMax {
		return "", true, false
	}
	if !instagramRe.MatchString(name) {
		return "", false, false
	}
	return name, false, true
}

// emailMax — предел длины адреса (emailField: max(254)).
const emailMax = 254

// emailRe — шаблон z.email() из zod 4 (zod/v4/core/regexes.js, email).
var emailRe = regexp.MustCompile(`^(?:[A-Za-z0-9_'+\-]+\.)*[A-Za-z0-9_'+\-]*[A-Za-z0-9_+-]@(?:[A-Za-z0-9][A-Za-z0-9\-]*\.)+[A-Za-z]{2,}$`)

// normalizeEmail — e-mail профиля (emailField): пробелы по краям убираются, адрес — в
// нижнем регистре; пусто — не указан. ok=false — неверный адрес.
func normalizeEmail(raw string) (email string, ok bool) {
	email = strings.ToLower(strings.TrimFunc(raw, jsSpace))
	if email == "" {
		return "", true
	}
	if jsLen(email) > emailMax || !emailRe.MatchString(email) {
		return "", false
	}
	return email, true
}
