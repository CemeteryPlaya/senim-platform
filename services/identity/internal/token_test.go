package internal

import (
	"bytes"
	"context"
	"crypto/ed25519"
	"testing"
	"time"

	"connectrpc.com/connect/v2"
	"github.com/golang-jwt/jwt/v5"

	identityv1 "github.com/CemeteryPlaya/senim-platform/gen/go/senim/identity/v1"
	"github.com/CemeteryPlaya/senim-platform/gen/go/senim/identity/v1/identityv1connect"
)

// Ключ подписи тестов: seed из 32 одинаковых байт.
var (
	testSigningKey = ed25519.NewKeyFromSeed(bytes.Repeat([]byte{9}, ed25519.SeedSize))
	testKID        = "test-kid-1"
)

func (h *harness) signingKeys(caller string) (*identityv1.GetSigningKeysResponse, error) {
	h.t.Helper()
	return idc(h, caller, func(ctx context.Context, c identityv1connect.IdentityServiceClient) (*identityv1.GetSigningKeysResponse, error) {
		return c.GetSigningKeys(ctx, &identityv1.GetSigningKeysRequest{})
	})
}

func TestAuthenticateIssuesVerifiableToken(t *testing.T) {
	h := newHarness(t, nil)
	u := h.user([]string{"CLIENT", "EXECUTOR"}, "EXECUTOR")
	token := h.session(u)
	res := h.mustAuth(token)

	keys, err := h.signingKeys("deal")
	if err != nil || len(keys.GetKeys()) == 0 {
		t.Fatalf("GetSigningKeys: %v %v", keys, err)
	}
	pub := ed25519.PublicKey(keys.GetKeys()[0].GetPublicKey())

	claims := jwt.MapClaims{}
	parsed, err := jwt.ParseWithClaims(res.GetAccessToken(), claims, func(tk *jwt.Token) (any, error) {
		if tk.Header["kid"] != keys.GetKeys()[0].GetKid() {
			t.Errorf("kid = %v", tk.Header["kid"])
		}
		return pub, nil
	}, jwt.WithValidMethods([]string{"EdDSA"}), jwt.WithTimeFunc(h.clock.now), jwt.WithIssuer("senim-identity"), jwt.WithAudience("senim"), jwt.WithExpirationRequired())
	if err != nil || !parsed.Valid {
		t.Fatalf("токен не проверяется: %v", err)
	}
	if parsed.Header["typ"] != "JWT" || parsed.Header["alg"] != "EdDSA" {
		t.Fatalf("header = %v", parsed.Header)
	}
	sess := h.sessionRow(token)
	if claims["sub"] != u.ID.String() || claims["sid"] != sess.ID.String() || claims["role"] != "EXECUTOR" {
		t.Fatalf("claims = %v", claims)
	}
	roles, _ := claims["roles"].([]any)
	if len(roles) != 2 || roles[0] != "CLIENT" || roles[1] != "EXECUTOR" {
		t.Fatalf("roles = %v", claims["roles"])
	}
	if mfa, ok := claims["mfa"].(bool); !ok || mfa {
		t.Fatalf("mfa = %v", claims["mfa"])
	}
	now := h.clock.now()
	if iat, _ := claims.GetIssuedAt(); !iat.Equal(now) {
		t.Fatalf("iat = %v, want %v", iat, now)
	}
	if exp, _ := claims.GetExpirationTime(); !exp.Equal(now.Add(accessTokenTTL)) || !res.GetAccessExpiresAt().AsTime().Equal(exp.Time) {
		t.Fatalf("exp = %v, access_expires_at = %v", exp, res.GetAccessExpiresAt().AsTime())
	}
}

func TestTokenExpiryCappedBySession(t *testing.T) {
	h := newHarness(t, nil)
	token := h.session(h.user([]string{"CLIENT"}, "CLIENT"))
	end := h.clock.now().Add(2 * time.Minute)
	if _, err := h.pool.Exec(context.Background(), `UPDATE sessions SET expires_at = $2 WHERE id = $1`, h.sessionRow(token).ID, end); err != nil {
		t.Fatal(err)
	}
	res := h.mustAuth(token)
	if !res.GetAccessExpiresAt().AsTime().Equal(end) {
		t.Fatalf("access_expires_at = %v, want %v", res.GetAccessExpiresAt().AsTime(), end)
	}
	parsed, _, err := jwt.NewParser().ParseUnverified(res.GetAccessToken(), jwt.MapClaims{})
	if err != nil {
		t.Fatal(err)
	}
	exp, _ := parsed.Claims.GetExpirationTime()
	if !exp.Equal(end) {
		t.Fatalf("exp = %v, want %v", exp, end)
	}
}

func TestSigningKeysOnlyPublic(t *testing.T) {
	h := newHarness(t, nil)
	res, err := h.signingKeys("deal")
	if err != nil {
		t.Fatal(err)
	}
	if len(res.GetKeys()) != 1 {
		t.Fatalf("keys = %v", res.GetKeys())
	}
	k := res.GetKeys()[0]
	if k.GetKid() != testKID || k.GetAlg() != "EdDSA" || len(k.GetPublicKey()) != ed25519.PublicKeySize {
		t.Fatalf("key = %v", k)
	}
	if !bytes.Equal(k.GetPublicKey(), testSigningKey.Public().(ed25519.PublicKey)) {
		t.Fatal("публичный ключ не совпадает с ключом подписи")
	}
	if bytes.Contains(k.GetPublicKey(), testSigningKey.Seed()) {
		t.Fatal("в ответе seed")
	}
}

func TestPreviousKeyListed(t *testing.T) {
	prevPub, _, _ := ed25519.GenerateKey(bytes.NewReader(bytes.Repeat([]byte{3}, 64)))
	h := newHarness(t, func(c *ServeConfig) {
		c.TokenPreviousKey = &SigningKey{KID: "old-kid", Public: prevPub}
	})
	res, err := h.signingKeys("notify")
	if err != nil {
		t.Fatal(err)
	}
	keys := res.GetKeys()
	if len(keys) != 2 || keys[0].GetKid() != testKID || keys[1].GetKid() != "old-kid" {
		t.Fatalf("keys = %v", keys)
	}
	if !bytes.Equal(keys[1].GetPublicKey(), prevPub) || keys[1].GetAlg() != "EdDSA" {
		t.Fatalf("previous = %v", keys[1])
	}
}

func TestGetSigningKeysAnyServiceCaller(t *testing.T) {
	h := newHarness(t, nil)
	for _, caller := range []string{"deal", "identity", "operator", "audit"} {
		if _, err := h.signingKeys(caller); err != nil {
			t.Errorf("%s: %v", caller, err)
		}
	}
	for _, caller := range []string{"edge", "mesh", "web", ""} {
		_, err := h.signingKeys(caller)
		h.wantRefusal(err, connect.CodePermissionDenied, "caller_forbidden")
	}
}
