package internal

import "testing"

func TestParsePhone(t *testing.T) {
	ok := map[string]string{
		"+7 700 000 55 01":  "+77000005501",
		"8 700 000 55 01":   "+77000005501",
		"7 (700) 000-55-01": "+77000005501",
		"700 000 55 01":     "+77000005501",
		"  +77000005501\n":  "+77000005501",
		"87000005501":       "+77000005501",
		"+7(777)123-45-67":  "+77771234567",
		"+7 777 123 45 67":  "+77771234567",
	}
	for in, want := range ok {
		if got, valid := parsePhone(in); !valid || got != want {
			t.Errorf("parsePhone(%q) = %q, %v; want %q", in, got, valid, want)
		}
	}
	bad := []string{
		"", "+", "abc", "+7 912 000 00 00", "+7 600 000 55 01", "+1 700 000 55 01",
		"7000005501x", "+770000055010", "+8 700 000 55 01 1", "700000550", "++77000005501",
		"+7 700 000 55 01 ext", "7000005501١", "8 800 555 35 35", "700+000 55 01",
	}
	for _, in := range bad {
		if got, valid := parsePhone(in); valid {
			t.Errorf("parsePhone(%q) = %q, want invalid", in, got)
		}
	}
}
