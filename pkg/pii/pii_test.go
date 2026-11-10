package pii

import (
	"bytes"
	"errors"
	"strings"
	"testing"

	"pgregory.net/rapid"
)

func key(fill byte) []byte { return bytes.Repeat([]byte{fill}, 32) }

func ring(t testing.TB, current string, kids ...string) *Keyring {
	t.Helper()
	keks := make(map[string][]byte, len(kids))
	for i, kid := range kids {
		keks[kid] = key(byte('a' + i))
	}
	k, err := NewKeyring(current, keks)
	if err != nil {
		t.Fatal(err)
	}
	return k
}

const aadA = "identity.persons.iin_enc:11111111-1111-1111-1111-111111111111"

func TestSealOpenRoundTrip(t *testing.T) {
	k := ring(t, "k1", "k1")
	rapid.Check(t, func(rt *rapid.T) {
		plain := rapid.SliceOf(rapid.Byte()).Draw(rt, "plain")
		aad := rapid.String().Draw(rt, "aad")
		blob, err := k.Seal(plain, aad)
		if err != nil {
			rt.Fatal(err)
		}
		got, err := k.Open(blob, aad)
		if err != nil {
			rt.Fatal(err)
		}
		if !bytes.Equal(got, plain) {
			rt.Fatalf("round trip: got %x, want %x", got, plain)
		}
	})
}

func TestOpenWrongAAD(t *testing.T) {
	k := ring(t, "k1", "k1")
	blob, err := k.Seal([]byte("900101300123"), aadA)
	if err != nil {
		t.Fatal(err)
	}
	// Шифртекст пользователя A, перенесённый в строку пользователя B.
	other := "identity.persons.iin_enc:22222222-2222-2222-2222-222222222222"
	for _, aad := range []string{other, "", "identity.parties.bin_iin_enc:11111111-1111-1111-1111-111111111111"} {
		if _, err := k.Open(blob, aad); !errors.Is(err, ErrAuth) {
			t.Errorf("Open with aad %q: err = %v, want ErrAuth", aad, err)
		}
	}
}

// Любой изменённый байт любой части: подделка не расшифровывается. Замена в kid даёт
// другой kid — неизвестный (ErrUnknownKID) или известный с другим ключом (ErrAuth).
func TestOpenTampered(t *testing.T) {
	k := ring(t, "k1", "k1", "k2")
	// Каждая позиция строки — хотя бы одна замена; дальше rapid перебирает замены.
	blob, err := k.Seal([]byte("900101300123"), aadA)
	if err != nil {
		t.Fatal(err)
	}
	for pos := range len(blob) {
		bad := []byte(blob)
		bad[pos] ^= 0x01
		_, err := k.Open(string(bad), aadA)
		inKID := pos >= len("v2.") && pos < len("v2.k1")
		if !errors.Is(err, ErrAuth) && !errors.Is(err, ErrMalformed) && (!inKID || !errors.Is(err, ErrUnknownKID)) {
			t.Fatalf("tampered byte %d: err = %v", pos, err)
		}
	}
	rapid.Check(t, func(rt *rapid.T) {
		plain := rapid.SliceOf(rapid.Byte()).Draw(rt, "plain")
		blob, err := k.Seal(plain, aadA)
		if err != nil {
			rt.Fatal(err)
		}
		pos := rapid.IntRange(0, len(blob)-1).Draw(rt, "pos")
		repl := rapid.Byte().Filter(func(b byte) bool { return b != blob[pos] }).Draw(rt, "repl")
		bad := []byte(blob)
		bad[pos] = repl
		_, err = k.Open(string(bad), aadA)
		inKID := pos >= len("v2.") && pos < len("v2.k1")
		switch {
		case errors.Is(err, ErrAuth), errors.Is(err, ErrMalformed):
		case inKID && errors.Is(err, ErrUnknownKID):
		default:
			rt.Fatalf("tampered byte %d (%q→%q): err = %v", pos, blob[pos], repl, err)
		}
	})
}

func TestOpenUnknownKID(t *testing.T) {
	old := ring(t, "gone", "gone")
	blob, err := old.Seal([]byte("x"), aadA)
	if err != nil {
		t.Fatal(err)
	}
	k := ring(t, "k1", "k1")
	_, err = k.Open(blob, aadA)
	if !errors.Is(err, ErrUnknownKID) {
		t.Fatalf("err = %v, want ErrUnknownKID", err)
	}
	if !strings.Contains(err.Error(), "gone") {
		t.Errorf("error must name the kid: %v", err)
	}
	if _, _, err := k.Rewrap(blob, aadA); !errors.Is(err, ErrUnknownKID) {
		t.Fatalf("Rewrap err = %v, want ErrUnknownKID", err)
	}
}

func TestFormat(t *testing.T) {
	k := ring(t, "kz-2026-1", "kz-2026-1")
	blob, err := k.Seal([]byte("KZ86125KZT5004100100"), aadA)
	if err != nil {
		t.Fatal(err)
	}
	if !strings.HasPrefix(blob, "v2.kz-2026-1.") {
		t.Fatalf("prefix: %s", blob)
	}
	parts := strings.Split(blob, ".")
	if len(parts) != 4 {
		t.Fatalf("parts: %d in %s", len(parts), blob)
	}
	for _, p := range parts[2:] {
		if strings.ContainsAny(p, "+/=") {
			t.Errorf("part %q is not unpadded base64url", p)
		}
	}
	kid, err := k.KIDOf(blob)
	if err != nil || kid != "kz-2026-1" {
		t.Fatalf("KIDOf = %q, %v", kid, err)
	}
	for _, bad := range []string{"", "v2", "v1.kz-2026-1.a.b", "v2.kz-2026-1.a", "v2..a.b", "v2.KZ.a.b", "v2.k.a.b.c"} {
		if _, err := k.KIDOf(bad); !errors.Is(err, ErrMalformed) {
			t.Errorf("KIDOf(%q) err = %v, want ErrMalformed", bad, err)
		}
		if _, err := k.Open(bad, aadA); !errors.Is(err, ErrMalformed) {
			t.Errorf("Open(%q) err = %v, want ErrMalformed", bad, err)
		}
	}
}

func TestRewrapToCurrent(t *testing.T) {
	keks := map[string][]byte{"old": key('o'), "new": key('n')}
	before, err := NewKeyring("old", keks)
	if err != nil {
		t.Fatal(err)
	}
	blob, err := before.Seal([]byte("900101300123"), aadA)
	if err != nil {
		t.Fatal(err)
	}
	after, err := NewKeyring("new", keks)
	if err != nil {
		t.Fatal(err)
	}
	// Значение под прежним kid читается и после смены текущего ключа.
	if got, err := after.Open(blob, aadA); err != nil || string(got) != "900101300123" {
		t.Fatalf("Open old blob after rotation: %q, %v", got, err)
	}
	re, changed, err := after.Rewrap(blob, aadA)
	if err != nil || !changed {
		t.Fatalf("Rewrap: changed=%v err=%v", changed, err)
	}
	if kid, _ := after.KIDOf(re); kid != "new" {
		t.Fatalf("rewrapped kid = %q, want new", kid)
	}
	// Перешифрован только ключ данных: шифртекст значения тот же.
	if strings.Split(re, ".")[3] != strings.Split(blob, ".")[3] {
		t.Error("value ciphertext changed on rewrap")
	}
	if got, err := after.Open(re, aadA); err != nil || string(got) != "900101300123" {
		t.Fatalf("Open rewrapped: %q, %v", got, err)
	}
	again, changed, err := after.Rewrap(re, aadA)
	if err != nil || changed || again != re {
		t.Fatalf("second Rewrap: changed=%v same=%v err=%v", changed, again == re, err)
	}
	// Перешифровка с чужим AAD не проходит: ключ данных привязан к строке.
	if _, _, err := after.Rewrap(blob, "identity.persons.iin_enc:other"); !errors.Is(err, ErrAuth) {
		t.Fatalf("Rewrap wrong aad: %v, want ErrAuth", err)
	}
}

func TestSealTwiceDiffers(t *testing.T) {
	k := ring(t, "k1", "k1")
	a, err := k.Seal([]byte("same"), aadA)
	if err != nil {
		t.Fatal(err)
	}
	b, err := k.Seal([]byte("same"), aadA)
	if err != nil {
		t.Fatal(err)
	}
	if a == b {
		t.Fatal("two seals of the same value are equal")
	}
	pa, pb := strings.Split(a, "."), strings.Split(b, ".")
	if pa[2] == pb[2] || pa[3] == pb[3] {
		t.Fatal("data key or value ciphertext repeated")
	}
}

func TestNewKeyringRejects(t *testing.T) {
	cases := map[string]struct {
		current string
		keks    map[string][]byte
	}{
		"empty":           {"k1", nil},
		"current missing": {"k2", map[string][]byte{"k1": key('a')}},
		"short key":       {"k1", map[string][]byte{"k1": key('a')[:16]}},
		"long key":        {"k1", map[string][]byte{"k1": append(key('a'), 1)}},
		"bad kid":         {"K1", map[string][]byte{"K1": key('a')}},
		"kid with dot":    {"k.1", map[string][]byte{"k.1": key('a')}},
		"kid too long":    {strings.Repeat("k", 33), map[string][]byte{strings.Repeat("k", 33): key('a')}},
	}
	for name, c := range cases {
		if _, err := NewKeyring(c.current, c.keks); err == nil {
			t.Errorf("%s: NewKeyring accepted", name)
		}
	}
	if _, err := NewKeyring(strings.Repeat("k", 32), map[string][]byte{strings.Repeat("k", 32): key('a')}); err != nil {
		t.Errorf("32-char kid rejected: %v", err)
	}
}

func TestLast4(t *testing.T) {
	for in, want := range map[string]string{
		"900101300123":         "0123",
		"KZ86125KZT5004100100": "0100",
		"abc":                  "abc",
		"":                     "",
		"Айгерим":              "ерим",
	} {
		if got := Last4(in); got != want {
			t.Errorf("Last4(%q) = %q, want %q", in, got, want)
		}
	}
}
