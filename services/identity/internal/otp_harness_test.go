package internal

import (
	"bytes"
	"context"
	"crypto/hmac"
	"crypto/sha256"
	"errors"
	"fmt"
	"log/slog"
	"net"
	"net/http"
	"os"
	"path/filepath"
	"sync"
	"testing"
	"time"

	"connectrpc.com/connect/v2"
	"connectrpc.com/connect/v2/connecthttp"
	"connectrpc.com/connect/v2/connectproto"
	"github.com/jackc/pgx/v5/pgxpool"

	commonv1 "github.com/CemeteryPlaya/senim-platform/gen/go/senim/common/v1"
	identityv1 "github.com/CemeteryPlaya/senim-platform/gen/go/senim/identity/v1"
	"github.com/CemeteryPlaya/senim-platform/gen/go/senim/identity/v1/identityv1connect"
	"github.com/CemeteryPlaya/senim-platform/pkg/logging"
	"github.com/CemeteryPlaya/senim-platform/pkg/pii"
	"github.com/CemeteryPlaya/senim-platform/pkg/server"
	"github.com/CemeteryPlaya/senim-platform/pkg/tlsx"
	"github.com/CemeteryPlaya/senim-platform/services/identity/internal/store"
)

// testHMACKey — ключ HMAC кодов в тестах (32 байта).
var testHMACKey = bytes.Repeat([]byte{7}, 32)

// testKeyring — ключи ПДн тестов: один KEK из 32 одинаковых байт.
func testKeyring(t *testing.T) *pii.Keyring {
	t.Helper()
	k, err := pii.NewKeyring("test-1", map[string][]byte{"test-1": bytes.Repeat([]byte{5}, 32)})
	if err != nil {
		t.Fatal(err)
	}
	return k
}

// fakeClock — управляемые часы сервиса.
type fakeClock struct {
	mu sync.Mutex
	t  time.Time
}

func (c *fakeClock) now() time.Time {
	c.mu.Lock()
	defer c.mu.Unlock()
	return c.t
}

func (c *fakeClock) advance(d time.Duration) {
	c.mu.Lock()
	defer c.mu.Unlock()
	c.t = c.t.Add(d)
}

type sentCode struct{ phone, code string }

// fakeSender записывает вызовы Send.
type fakeSender struct {
	mu    sync.Mutex
	calls []sentCode
	err   error
}

func (f *fakeSender) Send(_ context.Context, phone, code string) error {
	f.mu.Lock()
	defer f.mu.Unlock()
	if f.err != nil {
		return f.err
	}
	f.calls = append(f.calls, sentCode{phone, code})
	return nil
}

func (f *fakeSender) sent() []sentCode {
	f.mu.Lock()
	defer f.mu.Unlock()
	return append([]sentCode(nil), f.calls...)
}

func (f *fakeSender) failWith(err error) {
	f.mu.Lock()
	defer f.mu.Unlock()
	f.err = err
}

type syncLog struct {
	mu sync.Mutex
	b  bytes.Buffer
}

func (s *syncLog) Write(p []byte) (int, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	return s.b.Write(p)
}

func (s *syncLog) String() string {
	s.mu.Lock()
	defer s.mu.Unlock()
	return s.b.String()
}

// harness — identity за server.Run с настоящими сертификатами: вызывающий определяется
// так же, как в бою (mTLS с сертификатом mesh и XFCC).
type harness struct {
	t      *testing.T
	pool   *pgxpool.Pool
	q      *store.Queries
	svc    *Service
	sender *fakeSender
	clock  *fakeClock
	logs   *syncLog
	rpc    *connect.Client
	keySeq int
}

// newHarness поднимает сервис на чистых таблицах кодов и лимитов. tune меняет конфиг.
func newHarness(t *testing.T, tune func(*ServeConfig)) *harness {
	t.Helper()
	pool, q := migratedDB(t)
	ctx := context.Background()
	for _, table := range []string{"otp_codes", "rate_limits", "idempotency"} {
		if _, err := pool.Exec(ctx, "DELETE FROM "+table); err != nil {
			t.Fatal(err)
		}
	}
	cfg := ServeConfig{
		DemoMode: true, OTPProvider: "mock", OTPHMACKey: testHMACKey,
		OTPDailyGlobalLimit: 500, OTPDailyPrefixLimit: 50,
		TokenSigningKey: testSigningKey, TokenKID: testKID,
		PII: testKeyring(t),
	}
	if tune != nil {
		tune(&cfg)
	}
	h := &harness{t: t, pool: pool, q: q, sender: &fakeSender{}, clock: &fakeClock{t: time.Now().UTC().Truncate(time.Second)}, logs: &syncLog{}}
	log := logging.New(h.logs, ServiceID, slog.LevelDebug)
	h.svc = NewService(pool, cfg, h.sender, log)
	h.svc.now = h.clock.now

	dir := t.TempDir()
	caCert, caKey, err := tlsx.NewCA("test-ca", time.Hour)
	if err != nil {
		t.Fatal(err)
	}
	write := func(name string, data []byte) string {
		p := filepath.Join(dir, name)
		if err := os.WriteFile(p, data, 0o600); err != nil {
			t.Fatal(err)
		}
		return p
	}
	caFile := write("ca.pem", caCert)
	issue := func(name string) (string, string) {
		c, k, err := tlsx.Issue(caCert, caKey, name, []string{name, "localhost"}, time.Hour)
		if err != nil {
			t.Fatal(err)
		}
		return write(name+".pem", c), write(name+".key", k)
	}
	srvCert, srvKey := issue("identity")
	meshCert, meshKey := issue(server.MeshPeer)
	clientTLS, err := tlsx.ClientConfig(meshCert, meshKey, caFile)
	if err != nil {
		t.Fatal(err)
	}
	tr := &http.Transport{TLSClientConfig: clientTLS, ForceAttemptHTTP2: true}
	t.Cleanup(tr.CloseIdleConnections)

	grpcAddr, probeAddr := freeTCPAddr(t), freeTCPAddr(t)
	runCtx, cancel := context.WithCancel(context.Background())
	done := make(chan error, 1)
	go func() {
		done <- server.Run(runCtx, server.Options{
			Name: ServiceID, GRPCAddr: grpcAddr, ProbeAddr: probeAddr,
			CertFile: srvCert, KeyFile: srvKey, CAFile: caFile,
			Logger: log, DrainDelay: time.Millisecond, ShutdownTimeout: 5 * time.Second,
			AllowedPeers: []string{server.MeshPeer, ServiceID},
		}, func(s *connect.Server) error {
			identityv1connect.RegisterIdentityServiceHandler(s, h.svc)
			return nil
		}, nil)
	}()
	t.Cleanup(func() {
		cancel()
		tr.CloseIdleConnections()
		select {
		case err := <-done:
			if err != nil {
				t.Errorf("server.Run: %v", err)
			}
		case <-time.After(15 * time.Second):
			t.Error("server.Run не остановился")
		}
	})
	deadline := time.Now().Add(10 * time.Second)
	for {
		c, err := net.DialTimeout("tcp", grpcAddr, 100*time.Millisecond)
		if err == nil {
			_ = c.Close()
			break
		}
		if time.Now().After(deadline) {
			t.Fatal("сервер не слушает порт")
		}
		time.Sleep(20 * time.Millisecond)
	}
	h.rpc = connect.NewClient(connecthttp.NewTransport(&http.Client{Transport: tr}, "https://"+grpcAddr, connecthttp.WithGRPC()))
	return h
}

func freeTCPAddr(t *testing.T) string {
	t.Helper()
	l, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		t.Fatal(err)
	}
	defer func() { _ = l.Close() }()
	return l.Addr().String()
}

// callAs вызывает RequestOtp от имени сервиса caller: XFCC, как его ставит Envoy.
// Пустое имя — без XFCC (вызывает сам mesh).
func (h *harness) callAs(caller string, req *identityv1.RequestOtpRequest) (*identityv1.RequestOtpResponse, error) {
	h.t.Helper()
	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()
	ctx, info := connect.NewClientContext(ctx)
	if caller != "" {
		info.RequestHeader().Add("x-forwarded-client-cert", "Hash=4d5f6a;DNS="+caller+";DNS=localhost")
	}
	return identityv1connect.NewIdentityServiceClient(h.rpc).RequestOtp(ctx, req)
}

// request — вызов от имени web с новым ключом идемпотентности.
func (h *harness) request(phone, ip string) (*identityv1.RequestOtpResponse, error) {
	h.t.Helper()
	h.keySeq++
	return h.callAs("web", &identityv1.RequestOtpRequest{Phone: phone, ClientIp: ip, IdempotencyKey: fmt.Sprintf("key-%d-%d", time.Now().UnixNano(), h.keySeq)})
}

// mustRequest — запрос, который обязан пройти.
func (h *harness) mustRequest(phone, ip string) *identityv1.RequestOtpResponse {
	h.t.Helper()
	res, err := h.request(phone, ip)
	if err != nil {
		h.t.Fatalf("RequestOtp(%s): %v", phone, err)
	}
	return res
}

// registered создаёт пользователя с телефоном phone.
func (h *harness) registered(phone string) string {
	h.t.Helper()
	// База общая и переживает -count=2: пользователь с этим номером мог остаться с прошлого прогона.
	if _, err := h.q.GetUserByPhone(context.Background(), phone); err == nil {
		return phone
	}
	if _, err := h.q.CreateUser(context.Background(), store.CreateUserParams{Phone: phone, Roles: []string{"CLIENT"}, DefaultRole: "CLIENT"}); err != nil {
		h.t.Fatal(err)
	}
	return phone
}

// refusal разбирает ошибку: gRPC-код и код ErrorDetail.
func refusal(t *testing.T, err error) (connect.Code, string) {
	t.Helper()
	if err == nil {
		t.Fatal("ожидалась ошибка, получен успех")
	}
	var ce *connect.Error
	if !errors.As(err, &ce) {
		t.Fatalf("ошибка не connect.Error: %v", err)
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
	t.Fatalf("в ошибке нет ErrorDetail: %v", err)
	return 0, ""
}

func (h *harness) wantRefusal(err error, code connect.Code, reason string) {
	h.t.Helper()
	gotCode, gotReason := refusal(h.t, err)
	if gotCode != code || gotReason != reason {
		h.t.Fatalf("отказ %v/%q, want %v/%q", gotCode, gotReason, code, reason)
	}
}

func (h *harness) count(query string, args ...any) int {
	h.t.Helper()
	var n int
	if err := h.pool.QueryRow(context.Background(), query, args...).Scan(&n); err != nil {
		h.t.Fatal(err)
	}
	return n
}

func (h *harness) codeRows(phone string) int {
	return h.count(`SELECT count(*) FROM otp_codes WHERE phone = $1`, phone)
}

func wantHash(phone, code string) []byte {
	m := hmac.New(sha256.New, testHMACKey)
	m.Write([]byte("otp:v1:" + phone + ":" + code))
	return m.Sum(nil)
}
