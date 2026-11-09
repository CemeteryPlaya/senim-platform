package authz

import (
	"context"
	"crypto/ed25519"
	"errors"
	"fmt"
	"slices"
	"sync"
	"sync/atomic"
	"time"

	identityv1 "github.com/CemeteryPlaya/senim-platform/gen/go/senim/identity/v1"
	"github.com/CemeteryPlaya/senim-platform/gen/go/senim/identity/v1/identityv1connect"
)

const (
	// minRefreshGap — не чаще одного обращения к identity за ключами (плановое обновление
	// и внеочередное по неизвестному kid).
	minRefreshGap = 30 * time.Second
	// noKeysRetryGap — пока ключей нет совсем, повтор после сбоя не чаще раза в секунду.
	noKeysRetryGap = time.Second
	// fetchTimeout — предел одного обращения к identity; обращение не зависит от отмены
	// контекста того, кто его вызвал.
	fetchTimeout = 2 * time.Second

	keyAlg = "EdDSA"
)

// errRefreshSuppressed — внеочередное обновление отложено паузой в 30 с.
var errRefreshSuppressed = errors.New("authz: signing keys refresh is rate limited")

// KeySource отдаёт публичные ключи проверки токенов по kid.
type KeySource interface {
	Keys(ctx context.Context) (map[string]ed25519.PublicKey, error)
}

// Refresher — необязательная возможность источника: внеочередное обновление ключей. Verifier
// вызывает её, когда kid токена неизвестен. Ошибку возвращают вместе с прежними ключами.
type Refresher interface {
	Refresh(ctx context.Context) (map[string]ed25519.PublicKey, error)
}

type snapshot struct {
	keys      map[string]ed25519.PublicKey
	fetchedAt time.Time
}

// flight — одно выполняющееся обращение к identity; его ждут все, кому нужны новые ключи.
type flight struct {
	done chan struct{}
	err  error
}

type identityKeys struct {
	client  identityv1connect.IdentityServiceClient
	refresh time.Duration
	now     func() time.Time

	snap atomic.Pointer[snapshot] // читатели с ключами в кэше замок не берут

	mu        sync.Mutex // только учёт попыток; сетевой вызов под ним не делается
	attemptAt time.Time
	lastErr   error // ошибка последней попытки; nil после удачной
	cur       *flight
}

// IdentityKeys — источник ключей из identity.GetSigningKeys. Ключи живут refresh (10 мин);
// просроченный кэш обновляется в фоне, а проверки пока идут по прежним ключам. Неизвестный
// kid вызывает внеочередное обновление не чаще раза в 30 с, и только его ждут. Обращение к
// identity не зависит от отмены контекста вызывающего и ограничено 2 с. Если обновление не
// удалось, отдаются прежние ключи, а ошибка — только когда нужного kid среди них нет.
// Вызов GetSigningKeys разрешён только сервисам платформы (mesh), web его не делает.
func IdentityKeys(client identityv1connect.IdentityServiceClient, refresh time.Duration) KeySource {
	return newIdentityKeys(client, refresh, time.Now)
}

func newIdentityKeys(client identityv1connect.IdentityServiceClient, refresh time.Duration, now func() time.Time) *identityKeys {
	return &identityKeys{client: client, refresh: refresh, now: now}
}

// Keys возвращает кэш. Ждёт обращения к identity только когда ключей нет совсем.
func (k *identityKeys) Keys(ctx context.Context) (map[string]ed25519.PublicKey, error) {
	now := k.now()
	if s := k.snap.Load(); s != nil {
		if now.Sub(s.fetchedAt) >= k.refresh {
			_, _ = k.start(ctx, now, minRefreshGap) // в фоне; эта проверка не ждёт
		}
		return s.keys, nil
	}
	f, lastErr := k.start(ctx, now, noKeysRetryGap)
	if f == nil {
		if s := k.snap.Load(); s != nil {
			return s.keys, nil
		}
		return nil, lastErr
	}
	if err := wait(ctx, f); err != nil {
		return nil, err
	}
	if s := k.snap.Load(); s != nil {
		return s.keys, nil
	}
	return nil, f.err
}

// Refresh — внеочередное обновление по неизвестному kid, не чаще раза в 30 с. Внутри паузы
// возвращает кэш и ошибку: последней неудачной попытки или errRefreshSuppressed.
func (k *identityKeys) Refresh(ctx context.Context) (map[string]ed25519.PublicKey, error) {
	f, lastErr := k.start(ctx, k.now(), minRefreshGap)
	cached := func() map[string]ed25519.PublicKey {
		if s := k.snap.Load(); s != nil {
			return s.keys
		}
		return nil
	}
	if f == nil {
		if lastErr == nil {
			lastErr = errRefreshSuppressed
		}
		return cached(), lastErr
	}
	if err := wait(ctx, f); err != nil {
		return cached(), err
	}
	return cached(), f.err
}

func wait(ctx context.Context, f *flight) error {
	select {
	case <-f.done:
		return nil
	case <-ctx.Done():
		return fmt.Errorf("authz: waiting for signing keys: %w", ctx.Err())
	}
}

// start запускает обращение к identity, если оно не идёт и пауза gap прошла. Идущее
// обращение возвращает как есть. Пауза не истекла — nil и ошибка последней попытки.
func (k *identityKeys) start(ctx context.Context, now time.Time, gap time.Duration) (*flight, error) {
	k.mu.Lock()
	defer k.mu.Unlock()
	if k.cur != nil {
		return k.cur, nil
	}
	if !k.attemptAt.IsZero() && now.Sub(k.attemptAt) < gap {
		return nil, k.lastErr
	}
	k.attemptAt = now
	f := &flight{done: make(chan struct{})}
	k.cur = f
	// Отмена вызывающего не должна срывать обращение и тратить паузу для остальных.
	fctx, cancel := context.WithTimeout(context.WithoutCancel(ctx), fetchTimeout)
	go func() {
		defer cancel()
		keys, err := k.fetch(fctx)
		if err == nil {
			k.snap.Store(&snapshot{keys: keys, fetchedAt: now})
		}
		k.mu.Lock()
		k.lastErr, k.cur, f.err = err, nil, err
		k.mu.Unlock()
		close(f.done)
	}()
	return f, nil
}

func (k *identityKeys) fetch(ctx context.Context) (map[string]ed25519.PublicKey, error) {
	res, err := k.client.GetSigningKeys(ctx, &identityv1.GetSigningKeysRequest{})
	if err != nil {
		return nil, fmt.Errorf("authz: get signing keys: %w", err)
	}
	keys := map[string]ed25519.PublicKey{}
	for _, sk := range res.GetKeys() {
		if sk.GetKid() == "" || sk.GetAlg() != keyAlg || len(sk.GetPublicKey()) != ed25519.PublicKeySize {
			continue
		}
		keys[sk.GetKid()] = ed25519.PublicKey(slices.Clone(sk.GetPublicKey()))
	}
	if len(keys) == 0 {
		return nil, errors.New("authz: get signing keys: no usable keys in response")
	}
	return keys, nil
}
