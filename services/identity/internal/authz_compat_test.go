package internal

import (
	"context"
	"crypto/ed25519"
	"testing"

	"github.com/CemeteryPlaya/senim-platform/pkg/authz"
)

// staticKeys — KeySource из ответа GetSigningKeys.
type staticKeys map[string]ed25519.PublicKey

func (s staticKeys) Keys(context.Context) (map[string]ed25519.PublicKey, error) { return s, nil }

// TestAuthzVerifiesIdentityToken закрепляет совместимость: токен, который identity выдал в
// Authenticate, проходит pkg/authz по ключам из GetSigningKeys.
func TestAuthzVerifiesIdentityToken(t *testing.T) {
	h := newHarness(t, nil)
	u := h.user([]string{"CLIENT", "EXECUTOR"}, "EXECUTOR")
	token := h.session(u)
	res := h.mustAuth(token)

	keys, err := h.signingKeys("deal")
	if err != nil {
		t.Fatalf("GetSigningKeys: %v", err)
	}
	src := staticKeys{}
	for _, k := range keys.GetKeys() {
		src[k.GetKid()] = ed25519.PublicKey(k.GetPublicKey())
	}

	claims, err := authz.NewVerifier(src).WithClock(h.clock.now).Verify(context.Background(), res.GetAccessToken())
	if err != nil {
		t.Fatalf("authz не принял токен identity: %v", err)
	}
	sess := h.sessionRow(token)
	if claims.UserID != u.ID.String() || claims.SessionID != sess.ID.String() || claims.Role != "EXECUTOR" ||
		len(claims.Roles) != 2 || claims.Roles[0] != "CLIENT" || claims.Roles[1] != "EXECUTOR" || claims.MFA {
		t.Fatalf("claims = %+v", claims)
	}
	if !claims.ExpiresAt.Equal(res.GetAccessExpiresAt().AsTime()) {
		t.Fatalf("exp = %v, access_expires_at = %v", claims.ExpiresAt, res.GetAccessExpiresAt().AsTime())
	}
}
