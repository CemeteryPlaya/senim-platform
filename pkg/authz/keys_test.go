package authz

import (
	"context"
	"crypto/ed25519"
	"crypto/rand"
	"errors"
	"sync"
	"sync/atomic"
	"testing"
	"time"

	"connectrpc.com/connect/v2"
	"github.com/golang-jwt/jwt/v5"

	identityv1 "github.com/CemeteryPlaya/senim-platform/gen/go/senim/identity/v1"
	"github.com/CemeteryPlaya/senim-platform/gen/go/senim/identity/v1/identityv1connect"
)

type fakeIdentity struct {
	identityv1connect.IdentityServiceClient // остальные методы не вызываются

	mu    sync.Mutex
	keys  map[string]ed25519.PublicKey
	err   error
	calls atomic.Int32
	delay atomic.Int64 // наносекунды
}

func (f *fakeIdentity) set(keys map[string]ed25519.PublicKey, err error) {
	f.mu.Lock()
	defer f.mu.Unlock()
	f.keys, f.err = keys, err
}

func (f *fakeIdentity) GetSigningKeys(context.Context, *identityv1.GetSigningKeysRequest) (*identityv1.GetSigningKeysResponse, error) {
	f.calls.Add(1)
	time.Sleep(time.Duration(f.delay.Load()))
	f.mu.Lock()
	defer f.mu.Unlock()
	if f.err != nil {
		return nil, f.err
	}
	res := &identityv1.GetSigningKeysResponse{}
	for kid, pub := range f.keys {
		res.Keys = append(res.Keys, &identityv1.SigningKey{Kid: kid, PublicKey: pub, Alg: "EdDSA"})
	}
	return res, nil
}

type clock struct {
	mu sync.Mutex
	t  time.Time
}

func (c *clock) now() time.Time { c.mu.Lock(); defer c.mu.Unlock(); return c.t }
func (c *clock) add(d time.Duration) {
	c.mu.Lock()
	defer c.mu.Unlock()
	c.t = c.t.Add(d)
}

func genKey(t *testing.T) (ed25519.PublicKey, ed25519.PrivateKey) {
	t.Helper()
	pub, priv, err := ed25519.GenerateKey(rand.Reader)
	if err != nil {
		t.Fatal(err)
	}
	return pub, priv
}

func sign(t *testing.T, priv ed25519.PrivateKey, kid string, now time.Time) string {
	t.Helper()
	tk := jwt.NewWithClaims(jwt.SigningMethodEdDSA, jwt.MapClaims{
		"iss": Issuer, "aud": []string{Audience}, "sub": "u", "sid": "s", "role": "CLIENT",
		"roles": []string{"CLIENT"}, "iat": now.Unix(), "exp": now.Add(5 * time.Minute).Unix(),
	})
	tk.Header["kid"] = kid
	s, err := tk.SignedString(priv)
	if err != nil {
		t.Fatal(err)
	}
	return s
}

func setup(t *testing.T) (*fakeIdentity, *clock, *Verifier) {
	t.Helper()
	pub, _ := genKey(t)
	f := &fakeIdentity{keys: map[string]ed25519.PublicKey{"k1": pub}}
	c := &clock{t: time.Date(2026, 11, 10, 12, 0, 0, 0, time.UTC)}
	src := newIdentityKeys(f, 10*time.Minute, c.now)
	return f, c, NewVerifier(src).WithClock(c.now)
}

func TestUnknownKidRefreshesOnce(t *testing.T) {
	f, c, v := setup(t)
	ctx := context.Background()
	pub2, priv2 := genKey(t)

	// первый вызов загружает ключи; внеочередное обновление сразу после загрузки отложено,
	// поэтому неизвестный kid — повторяемая ErrKeysUnavailable, а не «токен неверен»
	if _, err := v.Verify(ctx, sign(t, priv2, "k2", c.now())); !errors.Is(err, ErrKeysUnavailable) {
		t.Fatalf("неизвестный kid: %v", err)
	}
	if n := f.calls.Load(); n != 1 {
		t.Fatalf("после первого вызова обращений %d, ждали 1", n)
	}
	// ключ появился у identity (ротация), но 30 с ещё не прошло — внеочередного обновления нет
	f.set(map[string]ed25519.PublicKey{"k1": nil, "k2": pub2}, nil)
	c.add(10 * time.Second)
	for range 5 {
		if _, err := v.Verify(ctx, sign(t, priv2, "k2", c.now())); !errors.Is(err, ErrKeysUnavailable) {
			t.Fatalf("до паузы 30 с: %v", err)
		}
	}
	if n := f.calls.Load(); n != 1 {
		t.Fatalf("внутри 30 с обращений %d, ждали 1", n)
	}
	// после 30 с — одно обновление, ключ найден
	c.add(25 * time.Second)
	if _, err := v.Verify(ctx, sign(t, priv2, "k2", c.now())); err != nil {
		t.Fatalf("после обновления: %v", err)
	}
	if n := f.calls.Load(); n != 2 {
		t.Fatalf("обращений %d, ждали 2", n)
	}
	// и дальше ключ в кэше
	for range 3 {
		if _, err := v.Verify(ctx, sign(t, priv2, "k2", c.now())); err != nil {
			t.Fatal(err)
		}
	}
	if n := f.calls.Load(); n != 2 {
		t.Fatalf("обращений %d, ждали 2", n)
	}
}

func TestKeysCachedUntilRefreshInterval(t *testing.T) {
	f, c, v := setup(t)
	ctx := context.Background()
	pub, priv := genKey(t)
	f.set(map[string]ed25519.PublicKey{"k1": pub}, nil)
	for range 3 {
		if _, err := v.Verify(ctx, sign(t, priv, "k1", c.now())); err != nil {
			t.Fatal(err)
		}
	}
	if n := f.calls.Load(); n != 1 {
		t.Fatalf("обращений %d, ждали 1", n)
	}
	c.add(11 * time.Minute)
	if _, err := v.Verify(ctx, sign(t, priv, "k1", c.now())); err != nil {
		t.Fatal(err)
	}
	if n := f.calls.Load(); n != 2 {
		t.Fatalf("после 10 мин обращений %d, ждали 2", n)
	}
}

func TestStaleKeysServedWhenRefreshFails(t *testing.T) {
	f, c, v := setup(t)
	ctx := context.Background()
	pub, priv := genKey(t)
	f.set(map[string]ed25519.PublicKey{"k1": pub}, nil)
	if _, err := v.Verify(ctx, sign(t, priv, "k1", c.now())); err != nil {
		t.Fatal(err)
	}
	f.set(nil, connect.NewError(connect.CodeUnavailable, "down"))
	c.add(11 * time.Minute)
	// известный kid продолжает проверяться по старым ключам
	if _, err := v.Verify(ctx, sign(t, priv, "k1", c.now())); err != nil {
		t.Fatalf("известный kid при сбое обновления: %v", err)
	}
	// неизвестный kid при недоступном identity — ошибка источника ключей, не «токен неверен»
	_, priv2 := genKey(t)
	c.add(time.Minute)
	_, err := v.Verify(ctx, sign(t, priv2, "k9", c.now()))
	if !errors.Is(err, ErrKeysUnavailable) || errors.Is(err, ErrTokenInvalid) {
		t.Fatalf("err = %v, ждали ErrKeysUnavailable", err)
	}
}

func TestKeysUnavailableWithoutCache(t *testing.T) {
	f, c, v := setup(t)
	f.set(nil, errors.New("down"))
	_, priv := genKey(t)
	_, err := v.Verify(context.Background(), sign(t, priv, "k1", c.now()))
	if !errors.Is(err, ErrKeysUnavailable) {
		t.Fatalf("err = %v", err)
	}
}

func TestConcurrentUnknownKidNoStampede(t *testing.T) {
	f, c, v := setup(t)
	f.delay.Store(int64(50 * time.Millisecond))
	ctx := context.Background()
	_, priv := genKey(t)
	token := sign(t, priv, "kx", c.now())
	var wg sync.WaitGroup
	for range 30 {
		wg.Add(1)
		go func() {
			defer wg.Done()
			_, _ = v.Verify(ctx, token)
		}()
	}
	wg.Wait()
	if n := f.calls.Load(); n != 1 {
		t.Fatalf("обращений %d, ждали 1", n)
	}
}

func TestBadKeysFromIdentityIgnored(t *testing.T) {
	f, c, _ := setup(t)
	pub, _ := genKey(t)
	f.keys = map[string]ed25519.PublicKey{"short": pub[:10], "ok": pub}
	src := newIdentityKeys(f, time.Minute, c.now)
	keys, err := src.Keys(context.Background())
	if err != nil || len(keys) != 1 || keys["ok"] == nil {
		t.Fatalf("keys = %v, err = %v", keys, err)
	}
}
