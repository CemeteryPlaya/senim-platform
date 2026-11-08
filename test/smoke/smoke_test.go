//go:build smoke

// Package smoke проверяет поднятый локальный стенд v2 (npm run v2:up):
// браузер → edge → web → mesh (gRPC, mTLS, балансировка по запросам) → identity.
package smoke

import (
	"bufio"
	"bytes"
	"context"
	"crypto/tls"
	"crypto/x509"
	"encoding/json"
	"errors"
	"fmt"
	"net"
	"net/http"
	"os"
	"os/exec"
	"path/filepath"
	"strconv"
	"strings"
	"testing"
	"time"

	"connectrpc.com/connect/v2"
	"connectrpc.com/connect/v2/connecthttp"
	"connectrpc.com/grpchealth/v2"

	"github.com/CemeteryPlaya/senim-platform/pkg/tlsx"
)

const (
	healthzURL = "http://localhost:8180/api/v2/healthz"
	meshAddr   = "127.0.0.1:9443"
	project    = "senim-v2"
	certsDir   = "../../deploy/compose/certs"
	requests   = 20

	coreBudget   = 3 << 30  // профиль core целиком
	goSvcBudget  = 64 << 20 // каждый Go-сервис в простое
	ioTimeout    = 5 * time.Second
	statsTimeout = 30 * time.Second
)

// Сервисы профиля core, которые работают постоянно (одноразовые migrate-сервисы к этому времени завершились).
var coreServices = map[string]bool{
	"postgres": true, "nats": true, "identity": true, "mesh": true, "web": true, "edge": true,
}

// Go-сервисы: на них отдельный бюджет памяти.
var goServices = map[string]bool{"identity": true}

type healthz struct {
	Identity string `json:"identity"`
	Instance string `json:"instance"`
}

// TestPathThroughMesh: каждый запрос проходит весь путь, а mesh раскладывает их по обеим репликам identity.
func TestPathThroughMesh(t *testing.T) {
	client := &http.Client{Timeout: ioTimeout}
	instances := map[string]int{}
	for i := range requests {
		resp, err := client.Get(healthzURL)
		if err != nil {
			t.Fatalf("запрос %d: %v", i+1, err)
		}
		var body healthz
		decodeErr := json.NewDecoder(resp.Body).Decode(&body)
		_ = resp.Body.Close()
		if resp.StatusCode != http.StatusOK {
			t.Fatalf("запрос %d: статус %d, ответ %+v", i+1, resp.StatusCode, body)
		}
		if decodeErr != nil {
			t.Fatalf("запрос %d: тело не JSON: %v", i+1, decodeErr)
		}
		if body.Identity != "SERVING" {
			t.Fatalf("запрос %d: identity = %q, want SERVING", i+1, body.Identity)
		}
		if body.Instance == "" {
			t.Fatalf("запрос %d: нет instance (стенд должен работать с APP_ENV=dev)", i+1)
		}
		instances[body.Instance]++
		if i == 0 {
			checkEdgeHeaders(t, resp.Header)
		}
	}
	if len(instances) != 2 {
		t.Fatalf("разных instance = %d (%v), want 2: mesh не балансирует по запросам", len(instances), instances)
	}
	t.Logf("распределение по репликам: %v", instances)
}

// checkEdgeHeaders: edge гарантирует заголовки безопасности (свои значения web не перетираются).
func checkEdgeHeaders(t *testing.T, h http.Header) {
	t.Helper()
	if got := h.Values("X-Content-Type-Options"); len(got) != 1 || got[0] != "nosniff" {
		t.Errorf("X-Content-Type-Options = %q, want один nosniff", got)
	}
	if got := h.Values("Referrer-Policy"); len(got) != 1 {
		t.Errorf("Referrer-Policy = %q, want ровно одно значение", got)
	}
	if got := h.Get("Strict-Transport-Security"); got != "" {
		t.Errorf("Strict-Transport-Security = %q: HSTS только в prod", got)
	}
}

// TestMeshRejectsWithoutClientCert: mesh не принимает соединение без клиентского сертификата нашего CA
// и с сертификатом нашего CA, чей SAN не в списке допущенных. В TLS 1.3 сервер проверяет сертификат
// клиента после рукопожатия на его стороне — отказ приходит алертом при первом чтении. Контроль: тот же
// запрос с сертификатом web получает SETTINGS от HTTP/2.
func TestMeshRejectsWithoutClientCert(t *testing.T) {
	base := meshTLS(t)

	t.Run("без сертификата — отказ", func(t *testing.T) {
		requireTLSRejection(t, readAfterHandshake(base), "без клиентского сертификата")
	})

	t.Run("с сертификатом web — принято", func(t *testing.T) {
		cfg := base.Clone()
		cfg.Certificates = []tls.Certificate{loadCert(t, "web")}
		if err := readAfterHandshake(cfg); err != nil {
			t.Fatalf("mesh отверг клиента web с сертификатом нашего CA: %v", err)
		}
	})

	// Сертификат нашего CA с SAN не из списка (так выглядел бы сертификат edge, который devcerts
	// больше не выпускает): звать сервисы через mesh ему нельзя.
	t.Run("с чужим SAN нашего CA — отказ", func(t *testing.T) {
		cfg := base.Clone()
		cfg.Certificates = []tls.Certificate{strangerCert(t, "edge")}
		requireTLSRejection(t, readAfterHandshake(cfg), "клиента edge (SAN не в списке допущенных)")
	})
}

// loadCert читает пару сертификат/ключ из deploy/compose/certs.
func loadCert(t *testing.T, name string) tls.Certificate {
	t.Helper()
	cert, err := tls.LoadX509KeyPair(filepath.Join(certsDir, name+".pem"), filepath.Join(certsDir, name+"-key.pem"))
	if err != nil {
		t.Fatalf("сертификат %s: %v (npm run v2:certs)", name, err)
	}
	return cert
}

// strangerCert выпускает dev-CA сертификат на имя, которого нет ни в одном списке допущенных.
func strangerCert(t *testing.T, name string) tls.Certificate {
	t.Helper()
	caCert, err := os.ReadFile(filepath.Join(certsDir, "ca.pem"))
	if err != nil {
		t.Fatal(err)
	}
	caKey, err := os.ReadFile(filepath.Join(certsDir, "ca-key.pem"))
	if err != nil {
		t.Fatal(err)
	}
	certPEM, keyPEM, err := tlsx.Issue(caCert, caKey, name, []string{name, "localhost"}, time.Hour)
	if err != nil {
		t.Fatal(err)
	}
	cert, err := tls.X509KeyPair(certPEM, keyPEM)
	if err != nil {
		t.Fatal(err)
	}
	return cert
}

// TestCallerSurvivesMesh: identity видит вызывающего за mesh (XFCC от Envoy, ADR-011), а не сам mesh,
// и подделанный клиентом XFCC mesh вычищает.
func TestCallerSurvivesMesh(t *testing.T) {
	hc := meshHealth(t, "web")
	ctx, info := identityCtx(t)
	info.RequestHeader().Set("x-forwarded-client-cert", "Hash=forged;DNS=operator")
	res, err := hc.Check(ctx, &grpchealth.CheckRequest{Service: "senim.identity.v1.IdentityService"})
	if err != nil || res.Status != grpchealth.StatusServing {
		t.Fatalf("health через mesh: %v %v", res, err)
	}
	if got := info.ResponseHeader().Get("x-senim-caller"); got != "web" {
		t.Fatalf("identity видит вызывающего %q, want web", got)
	}
}

// TestIdentityRefusesDirectWeb: порт identity наружу не опубликован, поэтому проверка идёт изнутри
// контейнера web — с его настоящим сертификатом. identity обязан отказать (только mesh и свои
// реплики), а mesh с тем же сертификатом — принять (контроль того, что скрипт видит успех).
func TestIdentityRefusesDirectWeb(t *testing.T) {
	web := composeContainer(t, "web")
	if out, code := nodeTLS(t, web, "identity", 8443); code != 0 {
		t.Fatalf("web → identity:8443 напрямую: код %d, %s (ожидался отказ TLS)", code, out)
	} else {
		t.Logf("web → identity напрямую — отказ: %s", out)
	}
	if out, code := nodeTLS(t, web, "mesh", 9443); code != 1 {
		t.Fatalf("web → mesh:9443: код %d, %s (ожидалось принятие)", code, out)
	}
}

// composeContainer — имя запущенного контейнера сервиса compose.
func composeContainer(t *testing.T, service string) string {
	t.Helper()
	ctx, cancel := context.WithTimeout(context.Background(), statsTimeout)
	defer cancel()
	out, err := exec.CommandContext(ctx, "docker", "ps", //nolint:gosec // тест: аргументы — константы теста
		"--filter", "label=com.docker.compose.project="+project,
		"--filter", "label=com.docker.compose.service="+service,
		"--format", "{{.Names}}").Output()
	if err != nil {
		t.Fatalf("docker ps: %v", err)
	}
	name, _, _ := strings.Cut(strings.TrimSpace(string(out)), "\n")
	if name == "" {
		t.Fatalf("контейнер %s не запущен (npm run v2:up)", service)
	}
	return name
}

// nodeTLSScript: mTLS-соединение с сертификатом web, преамбула HTTP/2, ждём первый кадр.
// Выход: 0 — отказ TLS (алерт о сертификате), 1 — принято (SETTINGS), 2 — иное.
const nodeTLSScript = `
const tls = require("node:tls"), fs = require("node:fs");
const [host, port] = process.argv.slice(1);
const s = tls.connect({ host, port: Number(port), servername: host, ALPNProtocols: ["h2"],
  minVersion: "TLSv1.3", ca: fs.readFileSync("/certs/ca.pem"),
  cert: fs.readFileSync("/certs/web.pem"), key: fs.readFileSync("/certs/web-key.pem") });
const done = (code, msg) => { console.log(msg); s.destroy(); process.exit(code); };
s.setTimeout(5000, () => done(2, "timeout"));
s.on("secureConnect", () => s.write("PRI * HTTP/2.0\r\n\r\nSM\r\n\r\n"));
s.on("data", (b) => done(b[3] === 4 ? 1 : 2, "frame type " + b[3]));
s.on("error", (e) => done(/ALERT|certificate/i.test(String(e.code) + e.message) ? 0 : 2, String(e.code) + " " + e.message));
s.on("end", () => done(2, "closed without alert"));
`

func nodeTLS(t *testing.T, container, host string, port int) (string, int) {
	t.Helper()
	ctx, cancel := context.WithTimeout(context.Background(), statsTimeout)
	defer cancel()
	out, err := exec.CommandContext(ctx, "docker", "exec", container, "node", "-e", nodeTLSScript, host, strconv.Itoa(port)).CombinedOutput() //nolint:gosec // тест: контейнер из docker ps, остальное — константы
	var exitErr *exec.ExitError
	switch {
	case err == nil:
		return strings.TrimSpace(string(out)), 0
	case errors.As(err, &exitErr):
		return strings.TrimSpace(string(out)), exitErr.ExitCode()
	default:
		t.Fatalf("docker exec: %v", err)
		return "", -1
	}
}

// readAfterHandshake подключается к mesh, отправляет преамбулу HTTP/2 и читает первый ответ сервера.
func readAfterHandshake(cfg *tls.Config) error {
	dialer := &net.Dialer{Timeout: ioTimeout}
	conn, err := tls.DialWithDialer(dialer, "tcp", meshAddr, cfg)
	if err != nil {
		return err
	}
	defer func() { _ = conn.Close() }()
	if err := conn.SetDeadline(time.Now().Add(ioTimeout)); err != nil {
		return err
	}
	if _, err := conn.Write([]byte("PRI * HTTP/2.0\r\n\r\nSM\r\n\r\n")); err != nil {
		return err
	}
	buf := make([]byte, 9) // заголовок кадра HTTP/2
	if _, err := conn.Read(buf); err != nil {
		return err
	}
	if buf[3] != 0x4 { // тип кадра SETTINGS
		return fmt.Errorf("первый кадр типа %d, want SETTINGS", buf[3])
	}
	return nil
}

// meshHealth — gRPC-health identity через mesh с клиентским сертификатом name.
func meshHealth(t *testing.T, name string) *grpchealth.Client {
	t.Helper()
	cfg := meshTLS(t)
	cfg.Certificates = []tls.Certificate{loadCert(t, name)}
	tr := &http.Transport{ForceAttemptHTTP2: true, TLSClientConfig: cfg}
	t.Cleanup(tr.CloseIdleConnections)
	return grpchealth.NewClient(connect.NewClient(connecthttp.NewTransport(
		&http.Client{Transport: tr, Timeout: ioTimeout}, "https://"+meshAddr, connecthttp.WithGRPC())))
}

// meshTLS — доверие нашему CA и имя сервера mesh, без клиентского сертификата.
func meshTLS(t *testing.T) *tls.Config {
	t.Helper()
	pool := x509.NewCertPool()
	caPEM, err := os.ReadFile(filepath.Join(certsDir, "ca.pem"))
	if err != nil {
		t.Fatalf("CA: %v (npm run v2:certs)", err)
	}
	if !pool.AppendCertsFromPEM(caPEM) {
		t.Fatal("CA: нет сертификатов в ca.pem")
	}
	return &tls.Config{RootCAs: pool, ServerName: "mesh", NextProtos: []string{"h2"}, MinVersion: tls.VersionTLS13}
}

// identityCtx — контекст вызова с маршрутом mesh до identity (в пути health нет имени сервиса).
func identityCtx(t *testing.T) (context.Context, *connect.CallInfo) {
	t.Helper()
	ctx, cancel := context.WithTimeout(context.Background(), ioTimeout)
	t.Cleanup(cancel)
	ctx, info := connect.NewClientContext(ctx)
	info.RequestHeader().Set("x-senim-target", "identity")
	return ctx, info
}

// TestMeshRejectsOversizedMessage: запрос больше 4 МиБ отвергает сам mesh (буфер-фильтр), обычный — проходит.
func TestMeshRejectsOversizedMessage(t *testing.T) {
	hc := meshHealth(t, "web")
	ctx, _ := identityCtx(t)
	res, err := hc.Check(ctx, &grpchealth.CheckRequest{Service: "senim.identity.v1.IdentityService"})
	if err != nil || res.Status != grpchealth.StatusServing {
		t.Fatalf("обычный запрос через mesh: %v %v", res, err)
	}
	ctx, _ = identityCtx(t)
	_, err = hc.Check(ctx, &grpchealth.CheckRequest{Service: strings.Repeat("a", 4<<20+1)})
	if err == nil {
		t.Fatal("запрос больше 4 МиБ прошёл через mesh")
	}
	// Отказ самого identity был бы resource_exhausted (или not_found для чужого имени);
	// mesh отвечает своим кодом (413 → unknown).
	if code := connect.CodeOf(err); code == connect.CodeResourceExhausted || code == connect.CodeNotFound {
		t.Fatalf("запрос дошёл до identity (%v), а должен остановиться на mesh", err)
	}
	t.Logf("отказ mesh: %v", err)
}

type dockerStat struct {
	Name     string `json:"Name"`
	MemUsage string `json:"MemUsage"`
}

// TestMemoryBudgetCore: память работающих контейнеров профиля core по docker stats.
func TestMemoryBudgetCore(t *testing.T) {
	ctx, cancel := context.WithTimeout(context.Background(), statsTimeout)
	defer cancel()

	ps, err := exec.CommandContext(ctx, "docker", "ps",
		"--filter", "label=com.docker.compose.project="+project,
		"--format", "{{.Names}}\t{{.Label \"com.docker.compose.service\"}}").Output()
	if err != nil {
		t.Fatalf("docker ps: %v", err)
	}
	service := map[string]string{} // имя контейнера → сервис compose
	for line := range strings.Lines(string(ps)) {
		name, svc, ok := strings.Cut(strings.TrimSpace(line), "\t")
		if ok && coreServices[svc] {
			service[name] = svc
		}
	}
	for svc := range coreServices {
		if !containsValue(service, svc) {
			t.Fatalf("сервис %s профиля core не запущен (npm run v2:up)", svc)
		}
	}

	args := []string{"stats", "--no-stream", "--format", "json"}
	for name := range service {
		args = append(args, name)
	}
	out, err := exec.CommandContext(ctx, "docker", args...).Output()
	if err != nil {
		t.Fatalf("docker stats: %v", err)
	}
	var total int64
	sc := bufio.NewScanner(bytes.NewReader(out))
	for sc.Scan() {
		var s dockerStat
		if err := json.Unmarshal(sc.Bytes(), &s); err != nil {
			t.Fatalf("docker stats: %v в %q", err, sc.Text())
		}
		used, err := parseMem(s.MemUsage)
		if err != nil {
			t.Fatalf("%s: %v", s.Name, err)
		}
		total += used
		t.Logf("%-28s %8.1f MiB", s.Name, float64(used)/(1<<20))
		if goServices[service[s.Name]] && used > goSvcBudget {
			t.Errorf("%s: %.1f MiB > 64 MiB (бюджет Go-сервиса в простое)", s.Name, float64(used)/(1<<20))
		}
	}
	if err := sc.Err(); err != nil {
		t.Fatal(err)
	}
	t.Logf("итого core: %.1f MiB", float64(total)/(1<<20))
	if total > coreBudget {
		t.Errorf("профиль core: %.1f MiB > 3 GiB", float64(total)/(1<<20))
	}
}

func containsValue(m map[string]string, v string) bool {
	for _, x := range m {
		if x == v {
			return true
		}
	}
	return false
}

// parseMem разбирает «12.5MiB / 7.6GiB» из docker stats и возвращает использованные байты.
func parseMem(usage string) (int64, error) {
	used, _, _ := strings.Cut(usage, "/")
	used = strings.TrimSpace(used)
	units := []struct {
		suffix string
		mul    float64
	}{{"GiB", 1 << 30}, {"MiB", 1 << 20}, {"KiB", 1 << 10}, {"GB", 1e9}, {"MB", 1e6}, {"kB", 1e3}, {"B", 1}}
	for _, u := range units {
		if num, ok := strings.CutSuffix(used, u.suffix); ok {
			v, err := strconv.ParseFloat(num, 64)
			if err != nil {
				return 0, fmt.Errorf("память %q: %w", usage, err)
			}
			return int64(v * u.mul), nil
		}
	}
	return 0, fmt.Errorf("память %q: неизвестная единица", usage)
}

// requireTLSRejection: mesh отказал именно на уровне TLS (алерт о сертификате или сбой рукопожатия),
// а не тайм-аутом или закрытым портом — иначе тест «прошёл» бы на неработающем стенде.
func requireTLSRejection(t *testing.T, err error, who string) {
	t.Helper()
	if err == nil {
		t.Fatalf("mesh принял соединение %s", who)
	}
	var netErr net.Error
	if errors.As(err, &netErr) && netErr.Timeout() {
		t.Fatalf("%s: ожидался отказ TLS, получен тайм-аут: %v", who, err)
	}
	msg := err.Error()
	tlsAlert := strings.Contains(msg, "tls:") && (strings.Contains(msg, "certificate") || strings.Contains(msg, "handshake"))
	if !tlsAlert {
		t.Fatalf("%s: ожидался алерт TLS о сертификате или сбой рукопожатия, получено: %v", who, err)
	}
	t.Logf("%s — отказ: %v", who, err)
}
