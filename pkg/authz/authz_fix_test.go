package authz_test

import (
	"context"
	"crypto/ecdsa"
	"crypto/elliptic"
	"crypto/rand"
	"crypto/rsa"
	"errors"
	"testing"

	"connectrpc.com/connect/v2"
	"github.com/golang-jwt/jwt/v5"

	testingv1 "github.com/CemeteryPlaya/senim-platform/gen/go/senim/testing/v1"
	"github.com/CemeteryPlaya/senim-platform/pkg/authz"
)

func TestInterceptorRejectsMultipleAuthorizationValues(t *testing.T) {
	pub, priv := newKey(t)
	c := interceptorClient(t, verifier(pub))
	ctx, info := connect.NewClientContext(context.Background())
	good := "Bearer " + mint(t, priv, nil)
	info.RequestHeader().Add("Authorization", good)
	info.RequestHeader().Add("Authorization", good)
	_, err := c.Echo(ctx, &testingv1.EchoRequest{})
	code, reason := refusal(t, err)
	if code != connect.CodeUnauthenticated || reason != "token_invalid" {
		t.Fatalf("code=%v reason=%q", code, reason)
	}
}

func TestRejectsRSAAndECDSA(t *testing.T) {
	pub, priv := newKey(t)
	rsaKey, err := rsa.GenerateKey(rand.Reader, 2048)
	if err != nil {
		t.Fatal(err)
	}
	ecKey, err := ecdsa.GenerateKey(elliptic.P256(), rand.Reader)
	if err != nil {
		t.Fatal(err)
	}
	cases := map[string]string{
		"RS256": mint(t, priv, func(c *tok) { c.method = jwt.SigningMethodRS256; c.key = rsaKey }),
		"ES256": mint(t, priv, func(c *tok) { c.method = jwt.SigningMethodES256; c.key = ecKey }),
	}
	for name, token := range cases {
		if _, err := verifier(pub).Verify(context.Background(), token); !errors.Is(err, authz.ErrTokenInvalid) {
			t.Errorf("%s: err = %v, ждали ErrTokenInvalid", name, err)
		}
	}
}
