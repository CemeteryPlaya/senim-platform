package internal

import (
	"testing"
	"time"
)

// Секрет векторов RFC 6238 (приложение B) для HMAC-SHA1.
var rfcSecret = []byte("12345678901234567890")

// TestTotpRFC6238Vectors — 6 младших цифр 8-значных векторов RFC 6238 для SHA1.
func TestTotpRFC6238Vectors(t *testing.T) {
	for _, c := range []struct {
		unix int64
		want string
	}{
		{59, "287082"},
		{1111111109, "081804"},
		{1234567890, "005924"},
		{2000000000, "279037"},
	} {
		if got := totpCode(rfcSecret, c.unix/totpPeriod); got != c.want {
			t.Errorf("t=%d: %s, want %s", c.unix, got, c.want)
		}
	}
}

// TestTotpVerifyWindow: принимаются шаги −1, 0, +1 от текущего; −2 и +2 — нет.
func TestTotpVerifyWindow(t *testing.T) {
	now := time.Unix(1_800_000_015, 0)
	cur := now.Unix() / totpPeriod
	for d := int64(-2); d <= 2; d++ {
		step, ok := totpVerify(rfcSecret, totpCode(rfcSecret, cur+d), now, 0)
		want := d >= -1 && d <= 1
		if ok != want {
			t.Errorf("шаг %+d: ok=%v, want %v", d, ok, want)
		}
		if ok && step != cur+d {
			t.Errorf("шаг %+d: вернулся шаг %d, want %d", d, step, cur+d)
		}
	}
	// Не шесть цифр — отказ без сравнения.
	for _, bad := range []string{"", "12345", "1234567", "12a456", "１２３４５６"} {
		if _, ok := totpVerify(rfcSecret, bad, now, 0); ok {
			t.Errorf("код %q принят", bad)
		}
	}
	// Пробелы по краям допустимы (копирование из приложения).
	if _, ok := totpVerify(rfcSecret, " "+totpCode(rfcSecret, cur)+"\n", now, 0); !ok {
		t.Error("код с пробелами по краям не принят")
	}
}

// TestTotpVerifyRejectsUsedStep: шаг не больше lastUsed не принимается, даже если код верный.
func TestTotpVerifyRejectsUsedStep(t *testing.T) {
	now := time.Unix(1_800_000_015, 0)
	cur := now.Unix() / totpPeriod
	code := totpCode(rfcSecret, cur)
	if _, ok := totpVerify(rfcSecret, code, now, cur); ok {
		t.Fatal("код уже использованного шага принят")
	}
	if _, ok := totpVerify(rfcSecret, code, now, cur+1); ok {
		t.Fatal("код шага раньше использованного принят")
	}
	if step, ok := totpVerify(rfcSecret, code, now, cur-1); !ok || step != cur {
		t.Fatalf("код нового шага: step=%d ok=%v", step, ok)
	}
	// Код прошлого шага после использования текущего — отказ.
	if _, ok := totpVerify(rfcSecret, totpCode(rfcSecret, cur-1), now, cur); ok {
		t.Fatal("код прошлого шага принят после текущего")
	}
}
