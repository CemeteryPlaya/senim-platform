package internal

import (
	"fmt"
	"strconv"
	"strings"
	"testing"
)

// testIIN — ИИН с верной контрольной цифрой (testIin из apps/web/src/demo/kz-id.ts):
// ГГММДД + цифра века и пола + 4 цифры порядкового номера + контроль.
func testIIN(t *testing.T, birth string, centuryGender, n int) string {
	t.Helper()
	return withCheckDigit(t, fmt.Sprintf("%s%d%04d", birth, centuryGender, n))
}

// testBIN — БИН юрлица-резидента (testBin): ГГММ + «4» + «0» + 5 цифр номера + контроль.
func testBIN(t *testing.T, registered string, n int) string {
	t.Helper()
	return withCheckDigit(t, fmt.Sprintf("%s40%05d", registered, n))
}

// withCheckDigit подставляет верную контрольную цифру к 11 первым цифрам.
func withCheckDigit(t *testing.T, s string) string {
	t.Helper()
	first11 := s[:11]
	check := kzCheckDigit(first11)
	if check < 0 {
		t.Fatalf("для %s нет контрольной цифры — смените пример", first11)
	}
	return first11 + strconv.Itoa(check)
}

// Те же случаи, что в apps/web/src/modules/identity/kz-id.test.ts.
func TestKzIDVectors(t *testing.T) {
	iin1 := testIIN(t, "940512", 4, 11)
	iin2 := testIIN(t, "880217", 3, 12)
	bin := testBIN(t, "2101", 16)

	t.Run("ИИН с верной контрольной цифрой", func(t *testing.T) {
		for _, v := range []string{iin1, iin2} {
			if !validIIN(v) {
				t.Errorf("validIIN(%s) = false", v)
			}
		}
	})
	t.Run("неверная контрольная цифра ИИН", func(t *testing.T) {
		d := int(iin1[11] - '0')
		broken := iin1[:11] + strconv.Itoa((d+1)%10)
		if validIIN(broken) {
			t.Errorf("validIIN(%s) = true", broken)
		}
	})
	for _, c := range []struct{ value, why string }{
		{"94051241001", "11 цифр"},
		{"9405124100111", "13 цифр"},
		{"94O512410011", "буква"},
		{"", "пусто"},
		{"９４０５１２４１００１１", "не ASCII-цифры"},
	} {
		t.Run("отклоняет "+c.why, func(t *testing.T) {
			if validIIN(c.value) {
				t.Errorf("validIIN(%q) = true", c.value)
			}
		})
	}
	t.Run("несуществующая дата и неверная цифра века", func(t *testing.T) {
		for _, c := range []struct{ twelve, why string }{
			{"941312400011", "месяц 13"},
			{"940532400011", "день 32"},
			{"940512000021", "век/пол 0"},
			{"940512700011", "век/пол 7"},
		} {
			v := withCheckDigit(t, c.twelve)
			if validIIN(v) {
				t.Errorf("%s (%s): validIIN = true", v, c.why)
			}
		}
	})
	t.Run("БИН не проходит как ИИН", func(t *testing.T) {
		if validIIN(bin) {
			t.Errorf("validIIN(%s) = true", bin)
		}
	})

	t.Run("БИН с верной контрольной цифрой", func(t *testing.T) {
		for _, v := range []string{bin, "210140000016"} {
			if !validBIN(v) {
				t.Errorf("validBIN(%s) = false", v)
			}
		}
	})
	t.Run("неверная контрольная цифра БИН", func(t *testing.T) {
		if validBIN("210140000017") {
			t.Error("validBIN(210140000017) = true")
		}
	})
	t.Run("ИИН не проходит как БИН", func(t *testing.T) {
		if validBIN(iin1) {
			t.Errorf("validBIN(%s) = true", iin1)
		}
	})

	t.Run("БИН или ИИН", func(t *testing.T) {
		for _, v := range []string{iin1, iin2, bin, "210140000016"} {
			if !validBINorIIN(v) {
				t.Errorf("validBINorIIN(%s) = false", v)
			}
		}
		for _, v := range []string{"210140000017", "94051241001", "", strings.Repeat("0", 12)} {
			if validBINorIIN(v) {
				t.Errorf("validBINorIIN(%q) = true", v)
			}
		}
	})
}

// kzCheckDigit: основа, для которой номер не выдаётся (обе суммы дают 10), — -1.
func TestKzCheckDigitNone(t *testing.T) {
	found := false
	for n := range 100000 {
		first11 := fmt.Sprintf("940512%05d", n)
		if kzCheckDigit(first11) < 0 {
			found = true
			for d := range 10 {
				if validIIN(first11 + strconv.Itoa(d)) {
					t.Fatalf("%s%d: номер без контрольной цифры прошёл проверку", first11, d)
				}
			}
			break
		}
	}
	if !found {
		t.Fatal("не нашлось основы без контрольной цифры")
	}
}

// ФИО — как full-name.ts: пробелы схлопнуты, 5–120 символов, хотя бы два слова.
func TestFullNameRules(t *testing.T) {
	for _, c := range []struct {
		raw, want string
		ok        bool
	}{
		{"Иван Петров", "Иван Петров", true},
		{"  Сапаров  Ерлан ", "Сапаров Ерлан", true},
		{"Сапаров\t Ерлан　Маратович", "Сапаров Ерлан Маратович", true},
		{"Ерлан", "Ерлан", false},
		{"А Б", "А Б", false},
		{"Ан Б", "Ан Б", false},
		{"Ан Бо", "Ан Бо", true},
		{"   ", "", false},
		{strings.Repeat("а", 60) + " " + strings.Repeat("б", 59), strings.Repeat("а", 60) + " " + strings.Repeat("б", 59), true},
		{strings.Repeat("а", 60) + " " + strings.Repeat("б", 60), strings.Repeat("а", 60) + " " + strings.Repeat("б", 60), false},
	} {
		got := normalizeFullName(c.raw)
		if got != c.want {
			t.Errorf("normalizeFullName(%q) = %q, want %q", c.raw, got, c.want)
		}
		if validFullName(got) != c.ok {
			t.Errorf("validFullName(%q) = %v, want %v", got, !c.ok, c.ok)
		}
	}
}

// Instagram — те же случаи, что в apps/web/src/modules/identity/instagram.test.ts.
func TestInstagramRules(t *testing.T) {
	for _, c := range []struct{ raw, want string }{
		{"dala_mebel", "dala_mebel"},
		{"@dala.mebel", "dala.mebel"},
		{"  @Aigerim.Home_2  ", "Aigerim.Home_2"},
		{"a", "a"},
		{strings.Repeat("x", instagramMax), strings.Repeat("x", instagramMax)},
		{"", ""},
		{"   ", ""},
		{"@", ""},
	} {
		got, ok := normalizeInstagram(c.raw)
		if !ok || got != c.want {
			t.Errorf("normalizeInstagram(%q) = %q, %v; want %q, true", c.raw, got, ok, c.want)
		}
	}
	for _, raw := range []string{
		"дала_мебель", "dala mebel", "dala-mebel", "https://instagram.com/dala", "@@dala", "dala@mebel",
		strings.Repeat("x", instagramMax+1),
	} {
		if got, ok := normalizeInstagram(raw); ok {
			t.Errorf("normalizeInstagram(%q) = %q, true; want ошибка", raw, got)
		}
	}
}

// E-mail — как emailField в instagram.ts: пробелы по краям убираются, нижний регистр,
// формат z.email() (zod 4), не длиннее 254; пусто — не указан.
func TestEmailRules(t *testing.T) {
	for _, c := range []struct{ raw, want string }{
		{"  Aigerim@Example.KZ ", "aigerim@example.kz"},
		{"master@example.kz", "master@example.kz"},
		{"first.last+tag@sub.example.com", "first.last+tag@sub.example.com"},
		{"o'brien@example.ie", "o'brien@example.ie"},
		{"", ""},
		{"   ", ""},
	} {
		got, ok := normalizeEmail(c.raw)
		if !ok || got != c.want {
			t.Errorf("normalizeEmail(%q) = %q, %v; want %q, true", c.raw, got, ok, c.want)
		}
	}
	long := strings.Repeat("a", 64) + "@" + strings.Repeat("b", 187) + ".kz" // 255 символов
	for _, raw := range []string{
		"не почта", "a@b", "a@b.c", "@example.kz", "a@example", ".a@example.kz", "a..b@example.kz",
		"a.@example.kz", "a@-example.kz", "a b@example.kz", "почта@пример.кз", long,
	} {
		if got, ok := normalizeEmail(raw); ok {
			t.Errorf("normalizeEmail(%q) = %q, true; want ошибка", raw, got)
		}
	}
}
