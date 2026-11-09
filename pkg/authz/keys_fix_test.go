package authz

import (
	"context"
	"crypto/ed25519"
	"errors"
	"testing"
	"time"
)

func TestKnownKidNotBlockedBySlowRefresh(t *testing.T) {
	f, c, v := setup(t)
	pub, priv := genKey(t)
	f.set(map[string]ed25519.PublicKey{"k1": pub}, nil)
	ctx := context.Background()
	if _, err := v.Verify(ctx, sign(t, priv, "k1", c.now())); err != nil {
		t.Fatal(err)
	}
	f.delay.Store(int64(500 * time.Millisecond))
	c.add(11 * time.Minute) // кэш просрочен: обновление уйдёт в фон
	began := time.Now()
	for range 5 {
		if _, err := v.Verify(ctx, sign(t, priv, "k1", c.now())); err != nil {
			t.Fatal(err)
		}
	}
	if d := time.Since(began); d > 200*time.Millisecond {
		t.Fatalf("проверки известного kid ждали обновления: %v", d)
	}
}

func TestCallerCancelDoesNotBurnRefreshSlot(t *testing.T) {
	f, c, v := setup(t)
	f.delay.Store(int64(200 * time.Millisecond))
	pub, priv := genKey(t)
	f.set(map[string]ed25519.PublicKey{"k1": pub}, nil)

	cctx, cancel := context.WithTimeout(context.Background(), 20*time.Millisecond)
	defer cancel()
	// ключей ещё нет, вызывающий отваливается во время обязательного обращения
	if _, err := v.Verify(cctx, sign(t, priv, "k1", c.now())); !errors.Is(err, ErrKeysUnavailable) {
		t.Fatalf("err = %v, ждали ErrKeysUnavailable", err)
	}
	// обращение завершилось само; следующий запрос не упирается в паузу 30 с
	if _, err := v.Verify(context.Background(), sign(t, priv, "k1", c.now())); err != nil {
		t.Fatalf("следующий запрос: %v", err)
	}
	if n := f.calls.Load(); n != 1 {
		t.Fatalf("обращений %d, ждали 1", n)
	}
}
