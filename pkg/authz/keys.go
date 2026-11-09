package authz

import (
	"context"
	"crypto/ed25519"
	"errors"
	"fmt"
	"slices"
	"sync"
	"time"

	identityv1 "github.com/CemeteryPlaya/senim-platform/gen/go/senim/identity/v1"
	"github.com/CemeteryPlaya/senim-platform/gen/go/senim/identity/v1/identityv1connect"
)

const (
	// minRefreshGap — не чаще одного обращения к identity за ключами (плановое обновление
	// после сбоя и внеочередное по неизвестному kid).
	minRefreshGap = 30 * time.Second
	// noKeysRetryGap — пока ключей нет совсем, повтор после сбоя не чаще раза в секунду.
	noKeysRetryGap = time.Second

	keyAlg = "EdDSA"
)

// KeySource отдаёт публичные ключи проверки токенов по kid.
type KeySource interface {
	Keys(ctx context.Context) (map[string]ed25519.PublicKey, error)
}

// Refresher — необязательная возможность источника: внеочередное обновление ключей. Verifier
// вызывает её, когда kid токена неизвестен. Ошибку возвращают вместе с прежними ключами.
type Refresher interface {
	Refresh(ctx context.Context) (map[string]ed25519.PublicKey, error)
}

type identityKeys struct {
	client  identityv1connect.IdentityServiceClient
	refresh time.Duration
	now     func() time.Time

	mu        sync.Mutex // держится на время обращения: параллельные проверки не штурмуют identity
	keys      map[string]ed25519.PublicKey
	fetchedAt time.Time // последнее удачное обновление
	attemptAt time.Time // последняя попытка
	lastErr   error     // ошибка последней попытки; nil после удачной
}

// IdentityKeys — источник ключей из identity.GetSigningKeys. Ключи живут refresh (10 мин);
// неизвестный kid вызывает внеочередное обновление не чаще раза в 30 с. Если обновление
// не удалось, отдаются прежние ключи, а ошибка — только когда нужного kid среди них нет.
// Вызов GetSigningKeys разрешён только сервисам платформы (mesh), web его не делает.
func IdentityKeys(client identityv1connect.IdentityServiceClient, refresh time.Duration) KeySource {
	return newIdentityKeys(client, refresh, time.Now)
}

func newIdentityKeys(client identityv1connect.IdentityServiceClient, refresh time.Duration, now func() time.Time) *identityKeys {
	return &identityKeys{client: client, refresh: refresh, now: now}
}

// Keys возвращает кэш, обновляя его по сроку. Ошибка — только когда ключей нет совсем.
func (k *identityKeys) Keys(ctx context.Context) (map[string]ed25519.PublicKey, error) {
	k.mu.Lock()
	defer k.mu.Unlock()
	now := k.now()
	if k.keys != nil {
		if now.Sub(k.fetchedAt) < k.refresh || now.Sub(k.attemptAt) < minRefreshGap {
			return k.keys, nil
		}
		_ = k.fetch(ctx, now) // при сбое остаются прежние ключи
		return k.keys, nil
	}
	if k.lastErr != nil && now.Sub(k.attemptAt) < noKeysRetryGap {
		return nil, k.lastErr
	}
	if err := k.fetch(ctx, now); err != nil {
		return nil, err
	}
	return k.keys, nil
}

// Refresh — внеочередное обновление по неизвестному kid, не чаще раза в 30 с. Внутри паузы
// возвращает кэш и ошибку последней попытки (если она была неудачной).
func (k *identityKeys) Refresh(ctx context.Context) (map[string]ed25519.PublicKey, error) {
	k.mu.Lock()
	defer k.mu.Unlock()
	now := k.now()
	if k.keys != nil && !k.attemptAt.IsZero() && now.Sub(k.attemptAt) < minRefreshGap {
		return k.keys, k.lastErr
	}
	err := k.fetch(ctx, now)
	return k.keys, err
}

// fetch обращается к identity; вызывать под k.mu. При сбое прежние ключи остаются.
func (k *identityKeys) fetch(ctx context.Context, now time.Time) error {
	k.attemptAt = now
	res, err := k.client.GetSigningKeys(ctx, &identityv1.GetSigningKeysRequest{})
	if err != nil {
		k.lastErr = fmt.Errorf("authz: get signing keys: %w", err)
		return k.lastErr
	}
	keys := map[string]ed25519.PublicKey{}
	for _, sk := range res.GetKeys() {
		if sk.GetKid() == "" || sk.GetAlg() != keyAlg || len(sk.GetPublicKey()) != ed25519.PublicKeySize {
			continue
		}
		keys[sk.GetKid()] = ed25519.PublicKey(slices.Clone(sk.GetPublicKey()))
	}
	if len(keys) == 0 {
		k.lastErr = errors.New("authz: get signing keys: no usable keys in response")
		return k.lastErr
	}
	k.keys, k.fetchedAt, k.lastErr = keys, now, nil
	return nil
}
