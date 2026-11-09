//go:build smoke

package smoke

import (
	"context"
	"crypto/rand"
	"crypto/tls"
	"encoding/base64"
	"errors"
	"fmt"
	"math/big"
	"net/http"
	"sync"
	"testing"
	"time"

	"connectrpc.com/connect/v2"
	"connectrpc.com/connect/v2/connecthttp"

	identityv1 "github.com/CemeteryPlaya/senim-platform/gen/go/senim/identity/v1"
	"github.com/CemeteryPlaya/senim-platform/gen/go/senim/identity/v1/identityv1connect"
	"github.com/CemeteryPlaya/senim-platform/pkg/authz"
)

const instanceHeader = "x-senim-instance"

// meshIdentity — клиент IdentityService через mesh с клиентским сертификатом cert.
func meshIdentity(t *testing.T, cert tls.Certificate) identityv1connect.IdentityServiceClient {
	t.Helper()
	cfg := meshTLS(t)
	cfg.Certificates = []tls.Certificate{cert}
	tr := &http.Transport{ForceAttemptHTTP2: true, TLSClientConfig: cfg}
	t.Cleanup(tr.CloseIdleConnections)
	return identityv1connect.NewIdentityServiceClient(connect.NewClient(connecthttp.NewTransport(
		&http.Client{Transport: tr, Timeout: ioTimeout}, "https://"+meshAddr, connecthttp.WithGRPC())))
}

func callCtx(t *testing.T) context.Context {
	t.Helper()
	ctx, cancel := context.WithTimeout(context.Background(), ioTimeout)
	t.Cleanup(cancel)
	return ctx
}

func randomKey(t *testing.T) string {
	t.Helper()
	b := make([]byte, 32)
	if _, err := rand.Read(b); err != nil {
		t.Fatal(err)
	}
	return base64.RawURLEncoding.EncodeToString(b)
}

// randomPhone — номер из демо-диапазона +7 70000 xxxxx, случайный на каждый запуск: стенд
// dev-only, а повторный вход на том же номере в течение минуты упёрся бы в паузу между кодами.
func randomPhone(t *testing.T) string {
	t.Helper()
	n, err := rand.Int(rand.Reader, big.NewInt(100000))
	if err != nil {
		t.Fatal(err)
	}
	return fmt.Sprintf("+770000%05d", n.Int64())
}

type loginResult struct {
	sessionToken string
	verify       *identityv1.VerifyOtpResponse
}

var (
	loginOnce sync.Once
	loginRes  loginResult
	loginErr  error
)

// loginOnceViaMesh входит один раз за запуск (лимиты кодов на префикс номера дневные): RequestOtp →
// demo_code → VerifyOtp со своим session_token. Сертификат — web, как у настоящего BFF.
func loginOnceViaMesh(t *testing.T) loginResult {
	t.Helper()
	loginOnce.Do(func() {
		web := meshIdentity(t, loadCert(t, "web"))
		phone := randomPhone(t)
		req, err := web.RequestOtp(callCtx(t), &identityv1.RequestOtpRequest{Phone: phone, IdempotencyKey: randomKey(t)})
		if err != nil {
			loginErr = fmt.Errorf("RequestOtp: %w", err)
			return
		}
		if len(req.GetDemoCode()) != 6 {
			loginErr = errors.New("RequestOtp: demo_code пуст или не 6 цифр (на стенде DEMO_MODE=true и мок-провайдер)")
			return
		}
		token := randomKey(t)
		ver, err := web.VerifyOtp(callCtx(t), &identityv1.VerifyOtpRequest{
			Phone: phone, Code: req.GetDemoCode(), SessionToken: token, UserAgent: "smoke", IdempotencyKey: randomKey(t),
		})
		if err != nil {
			loginErr = fmt.Errorf("VerifyOtp: %w", err)
			return
		}
		loginRes = loginResult{sessionToken: token, verify: ver}
	})
	if loginErr != nil {
		t.Fatal(loginErr)
	}
	return loginRes
}

// TestLoginThroughMesh: весь путь входа через mesh с mTLS, затем внутренний токен проверяется
// authz.Verifier по ключам из GetSigningKeys (читает сервис identity, не web).
func TestLoginThroughMesh(t *testing.T) {
	login := loginOnceViaMesh(t)
	if login.verify.GetUser().GetId() == "" || login.verify.GetSession().GetId() == "" || !login.verify.GetIsNew() {
		t.Fatalf("VerifyOtp: %+v, want новый пользователь и сессия", login.verify)
	}

	web := meshIdentity(t, loadCert(t, "web"))
	auth, err := web.Authenticate(callCtx(t), &identityv1.AuthenticateRequest{SessionToken: login.sessionToken})
	if err != nil {
		t.Fatalf("Authenticate: %v", err)
	}
	if auth.GetUser().GetId() != login.verify.GetUser().GetId() || auth.GetAccessToken() == "" {
		t.Fatalf("Authenticate: %+v", auth)
	}

	keys := authz.IdentityKeys(meshIdentity(t, loadCert(t, "identity")), time.Minute)
	claims, err := authz.NewVerifier(keys).Verify(callCtx(t), auth.GetAccessToken())
	if err != nil {
		t.Fatalf("authz не принял access_token: %v", err)
	}
	if claims.UserID != auth.GetUser().GetId() || claims.SessionID != auth.GetSession().GetId() {
		t.Fatalf("claims = %+v, want пользователь и сессия из Authenticate", claims)
	}

	// Ключи подписи web читать не может: только сервисы платформы.
	_, err = web.GetSigningKeys(callCtx(t), &identityv1.GetSigningKeysRequest{})
	if connect.CodeOf(err) != connect.CodePermissionDenied {
		t.Fatalf("GetSigningKeys от web: %v, want permission_denied", err)
	}
}

// TestEdgeCannotCallIdentity: сертификат нашего CA с SAN edge (edge своего сертификата не имеет,
// ADR-011) mesh отвергает на уровне TLS.
func TestEdgeCannotCallIdentity(t *testing.T) {
	edge := meshIdentity(t, strangerCert(t, "edge"))
	_, err := edge.Authenticate(callCtx(t), &identityv1.AuthenticateRequest{SessionToken: randomKey(t)})
	requireTLSRejection(t, err, "клиента edge при вызове Authenticate")
}

// TestAuthenticateLoadBalanced: 20 вызовов Authenticate с одной сессией mesh раскладывает по
// обеим репликам (заголовок экземпляра), и каждая реплика узнаёт сессию — состояние в базе.
func TestAuthenticateLoadBalanced(t *testing.T) {
	login := loginOnceViaMesh(t)
	web := meshIdentity(t, loadCert(t, "web"))
	instances := map[string]int{}
	for i := range requests {
		ctx, info := connect.NewClientContext(callCtx(t))
		res, err := web.Authenticate(ctx, &identityv1.AuthenticateRequest{SessionToken: login.sessionToken})
		if err != nil {
			t.Fatalf("Authenticate %d: %v", i+1, err)
		}
		if res.GetUser().GetId() != login.verify.GetUser().GetId() {
			t.Fatalf("Authenticate %d: другой пользователь %q", i+1, res.GetUser().GetId())
		}
		inst := info.ResponseHeader().Get(instanceHeader)
		if inst == "" {
			t.Fatalf("Authenticate %d: нет заголовка %s", i+1, instanceHeader)
		}
		instances[inst]++
	}
	if len(instances) != 2 {
		t.Fatalf("разных реплик = %d (%v), want 2", len(instances), instances)
	}
	t.Logf("распределение Authenticate по репликам: %v", instances)
}
