package authz_test

import (
	"context"
	"crypto/ed25519"
	"crypto/rand"
	"errors"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"connectrpc.com/connect/v2"
	"connectrpc.com/connect/v2/connecthttp"
	"connectrpc.com/connect/v2/connectproto"
	"github.com/golang-jwt/jwt/v5"

	commonv1 "github.com/CemeteryPlaya/senim-platform/gen/go/senim/common/v1"
	testingv1 "github.com/CemeteryPlaya/senim-platform/gen/go/senim/testing/v1"
	"github.com/CemeteryPlaya/senim-platform/gen/go/senim/testing/v1/testingv1connect"
	"github.com/CemeteryPlaya/senim-platform/pkg/authz"
)

const kid = "kid-1"

var now = time.Date(2026, 11, 10, 12, 0, 0, 0, time.UTC)

type staticKeys map[string]ed25519.PublicKey

func (s staticKeys) Keys(context.Context) (map[string]ed25519.PublicKey, error) { return s, nil }

func newKey(t *testing.T) (ed25519.PublicKey, ed25519.PrivateKey) {
	t.Helper()
	pub, priv, err := ed25519.GenerateKey(rand.Reader)
	if err != nil {
		t.Fatal(err)
	}
	return pub, priv
}

// tok — поля токена; нулевые значения заменяются нормальными, опции меняют отдельные поля.
type tok struct {
	method        jwt.SigningMethod
	key           any
	kid           any // nil — без kid
	iss           string
	aud           any
	sub, sid      string
	role          string
	roles         []string
	exp           *time.Time
	noExp         bool
	noKid, noRole bool
}

func mint(t *testing.T, priv ed25519.PrivateKey, mod func(*tok)) string {
	t.Helper()
	exp := now.Add(5 * time.Minute)
	c := tok{method: jwt.SigningMethodEdDSA, key: priv, kid: kid, iss: "senim-identity", aud: jwt.ClaimStrings{"senim"},
		sub: "user-1", sid: "sess-1", role: "EXECUTOR", roles: []string{"CLIENT", "EXECUTOR"}, exp: &exp}
	if mod != nil {
		mod(&c)
	}
	m := jwt.MapClaims{"iat": now.Unix(), "mfa": true}
	setIf := func(k string, v any, ok bool) {
		if ok {
			m[k] = v
		}
	}
	setIf("iss", c.iss, c.iss != "")
	setIf("aud", c.aud, c.aud != nil)
	setIf("sub", c.sub, c.sub != "")
	setIf("sid", c.sid, c.sid != "")
	setIf("role", c.role, !c.noRole && c.role != "")
	setIf("roles", c.roles, true)
	setIf("exp", c.exp.Unix(), !c.noExp && c.exp != nil)
	tk := jwt.NewWithClaims(c.method, m)
	if c.kid != nil {
		tk.Header["kid"] = c.kid
	}
	s, err := tk.SignedString(c.key)
	if err != nil {
		t.Fatalf("sign: %v", err)
	}
	return s
}

func verifier(pub ed25519.PublicKey) *authz.Verifier {
	return authz.NewVerifier(staticKeys{kid: pub}).WithClock(func() time.Time { return now })
}

func TestVerifyAcceptsIdentityToken(t *testing.T) {
	pub, priv := newKey(t)
	c, err := verifier(pub).Verify(context.Background(), mint(t, priv, nil))
	if err != nil {
		t.Fatalf("Verify: %v", err)
	}
	if c.UserID != "user-1" || c.SessionID != "sess-1" || c.Role != "EXECUTOR" || !c.MFA ||
		len(c.Roles) != 2 || c.Roles[0] != "CLIENT" || !c.ExpiresAt.Equal(now.Add(5*time.Minute)) {
		t.Fatalf("claims = %+v", c)
	}
}

func TestVerifyAcceptsAudienceAsString(t *testing.T) {
	pub, priv := newKey(t)
	if _, err := verifier(pub).Verify(context.Background(), mint(t, priv, func(c *tok) { c.aud = "senim" })); err != nil {
		t.Fatalf("aud строкой: %v", err)
	}
	if _, err := verifier(pub).Verify(context.Background(), mint(t, priv, func(c *tok) { c.aud = []string{"other", "senim"} })); err != nil {
		t.Fatalf("aud из нескольких: %v", err)
	}
}

func TestRejectsWrongAlg(t *testing.T) {
	pub, priv := newKey(t)
	cases := map[string]string{
		"none": mint(t, priv, func(c *tok) { c.method = jwt.SigningMethodNone; c.key = jwt.UnsafeAllowNoneSignatureType }),
		// классическая подмена: HMAC, ключом которого служит публичный ключ
		"HS256": mint(t, priv, func(c *tok) { c.method = jwt.SigningMethodHS256; c.key = []byte(pub) }),
		"HS512": mint(t, priv, func(c *tok) { c.method = jwt.SigningMethodHS512; c.key = []byte(pub) }),
	}
	for name, token := range cases {
		_, err := verifier(pub).Verify(context.Background(), token)
		if !errors.Is(err, authz.ErrTokenInvalid) {
			t.Errorf("%s: err = %v, ждали ErrTokenInvalid", name, err)
		}
		if err != nil && strings.Contains(err.Error(), token) {
			t.Errorf("%s: ошибка содержит токен", name)
		}
	}
}

func TestRejectsExpired(t *testing.T) {
	pub, priv := newKey(t)
	v := verifier(pub)
	within := now.Add(-20 * time.Second) // в пределах допуска 30 с
	if _, err := v.Verify(context.Background(), mint(t, priv, func(c *tok) { c.exp = &within })); err != nil {
		t.Fatalf("в пределах допуска: %v", err)
	}
	past := now.Add(-31 * time.Second)
	_, err := v.Verify(context.Background(), mint(t, priv, func(c *tok) { c.exp = &past }))
	if !errors.Is(err, authz.ErrTokenInvalid) {
		t.Fatalf("истёкший принят: %v", err)
	}
}

func TestRejectsWrongAudience(t *testing.T) {
	pub, priv := newKey(t)
	for name, aud := range map[string]any{"other": jwt.ClaimStrings{"other"}, "missing": nil, "empty": jwt.ClaimStrings{}} {
		_, err := verifier(pub).Verify(context.Background(), mint(t, priv, func(c *tok) { c.aud = aud }))
		if !errors.Is(err, authz.ErrTokenInvalid) {
			t.Errorf("%s: err = %v", name, err)
		}
	}
}

func TestRejectsOtherClaimProblems(t *testing.T) {
	pub, priv := newKey(t)
	otherPub, otherPriv := newKey(t)
	_ = otherPub
	cases := map[string]string{
		"issuer":     mint(t, priv, func(c *tok) { c.iss = "evil" }),
		"no issuer":  mint(t, priv, func(c *tok) { c.iss = "" }),
		"no exp":     mint(t, priv, func(c *tok) { c.noExp = true }),
		"no kid":     mint(t, priv, func(c *tok) { c.kid = nil }),
		"unknown":    mint(t, priv, func(c *tok) { c.kid = "kid-x" }),
		"kid number": mint(t, priv, func(c *tok) { c.kid = 7 }),
		"no sub":     mint(t, priv, func(c *tok) { c.sub = "" }),
		"no sid":     mint(t, priv, func(c *tok) { c.sid = "" }),
		"no role":    mint(t, priv, func(c *tok) { c.noRole = true }),
		"foreign":    mint(t, otherPriv, nil), // подпись чужим ключом под известным kid
		"garbage":    "not-a-token",
		"empty":      "",
		"huge":       strings.Repeat("a", 100_000),
	}
	for name, token := range cases {
		_, err := verifier(pub).Verify(context.Background(), token)
		if !errors.Is(err, authz.ErrTokenInvalid) {
			t.Errorf("%s: err = %v, ждали ErrTokenInvalid", name, err)
			continue
		}
		if len(token) > 0 && len(token) < 1000 && strings.Contains(err.Error(), token) {
			t.Errorf("%s: ошибка содержит токен", name)
		}
	}
}

// --- интерсептор ---

type claimEcho struct{}

func (claimEcho) Echo(ctx context.Context, _ *testingv1.EchoRequest) (*testingv1.EchoResponse, error) {
	c, ok := authz.FromContext(ctx)
	if !ok {
		return &testingv1.EchoResponse{Message: "<none>"}, nil
	}
	return &testingv1.EchoResponse{Message: c.UserID + "/" + c.Role}, nil
}

func interceptorClient(t *testing.T, v *authz.Verifier) testingv1connect.EchoServiceClient {
	t.Helper()
	srv := connect.NewServer(authz.Interceptor(v))
	testingv1connect.RegisterEchoServiceHandler(srv, claimEcho{})
	mux := http.NewServeMux()
	connecthttp.Mount(mux, srv)
	ts := httptest.NewServer(mux)
	t.Cleanup(ts.Close)
	return testingv1connect.NewEchoServiceClient(connect.NewClient(connecthttp.NewTransport(ts.Client(), ts.URL)))
}

func echoWith(c testingv1connect.EchoServiceClient, header string) (string, error) {
	ctx, info := connect.NewClientContext(context.Background())
	if header != "" {
		info.RequestHeader().Set("Authorization", header)
	}
	res, err := c.Echo(ctx, &testingv1.EchoRequest{})
	if err != nil {
		return "", err
	}
	return res.GetMessage(), nil
}

func TestInterceptorMissingVsInvalid(t *testing.T) {
	pub, priv := newKey(t)
	c := interceptorClient(t, verifier(pub))

	// нет заголовка — обработчик вызван без Claims
	if got, err := echoWith(c, ""); err != nil || got != "<none>" {
		t.Fatalf("без заголовка: %q, %v", got, err)
	}
	// верный токен — Claims в контексте
	if got, err := echoWith(c, "Bearer "+mint(t, priv, nil)); err != nil || got != "user-1/EXECUTOR" {
		t.Fatalf("верный токен: %q, %v", got, err)
	}
	// схема без учёта регистра
	if got, err := echoWith(c, "bearer "+mint(t, priv, nil)); err != nil || got != "user-1/EXECUTOR" {
		t.Fatalf("bearer: %q, %v", got, err)
	}
	// неверные: чужая подпись, мусор, пустой Bearer, другая схема
	_, otherPriv := newKey(t)
	for name, h := range map[string]string{
		"foreign sig": "Bearer " + mint(t, otherPriv, nil),
		"garbage":     "Bearer abc.def.ghi",
		"empty":       "Bearer ",
		"basic":       "Basic dXNlcjpwYXNz",
		"bare":        mint(t, priv, nil),
	} {
		_, err := echoWith(c, h)
		code, reason := refusal(t, err)
		if code != connect.CodeUnauthenticated || reason != "token_invalid" {
			t.Errorf("%s: code=%v reason=%q, ждали Unauthenticated/token_invalid", name, code, reason)
		}
		if err != nil && strings.Contains(err.Error(), "abc.def.ghi") {
			t.Errorf("%s: ошибка содержит токен", name)
		}
	}
}

func TestInterceptorKeysUnavailable(t *testing.T) {
	_, priv := newKey(t)
	v := authz.NewVerifier(failingKeys{}).WithClock(func() time.Time { return now })
	c := interceptorClient(t, v)
	_, err := echoWith(c, "Bearer "+mint(t, priv, nil))
	code, reason := refusal(t, err)
	if code != connect.CodeUnavailable || reason != "auth_unavailable" {
		t.Fatalf("code=%v reason=%q", code, reason)
	}
}

type failingKeys struct{}

func (failingKeys) Keys(context.Context) (map[string]ed25519.PublicKey, error) {
	return nil, errors.New("identity down")
}

func refusal(t *testing.T, err error) (connect.Code, string) {
	t.Helper()
	if err == nil {
		t.Fatal("ожидалась ошибка")
	}
	var ce *connect.Error
	if !errors.As(err, &ce) {
		t.Fatalf("не connect.Error: %v", err)
	}
	for _, d := range ce.Details() {
		msg, derr := connectproto.UnmarshalErrorDetail(d)
		if derr != nil {
			continue
		}
		if ed, ok := msg.(*commonv1.ErrorDetail); ok {
			return ce.Code(), ed.GetCode()
		}
	}
	t.Fatalf("нет ErrorDetail: %v", err)
	return 0, ""
}
