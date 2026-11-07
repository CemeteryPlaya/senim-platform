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

// TestMeshRejectsWithoutClientCert: mesh не принимает соединение без клиентского сертификата нашего CA.
// В TLS 1.3 сервер проверяет сертификат клиента после рукопожатия на его стороне — отказ приходит
// алертом при первом чтении. Контроль: тот же запрос с сертификатом web получает SETTINGS от HTTP/2.
func TestMeshRejectsWithoutClientCert(t *testing.T) {
	pool := x509.NewCertPool()
	caPEM, err := os.ReadFile(filepath.Join(certsDir, "ca.pem"))
	if err != nil {
		t.Fatalf("CA: %v (npm run v2:certs)", err)
	}
	if !pool.AppendCertsFromPEM(caPEM) {
		t.Fatal("CA: нет сертификатов в ca.pem")
	}
	base := &tls.Config{RootCAs: pool, ServerName: "mesh", NextProtos: []string{"h2"}, MinVersion: tls.VersionTLS13}

	t.Run("без сертификата — отказ", func(t *testing.T) {
		requireTLSRejection(t, readAfterHandshake(base), "без клиентского сертификата")
	})

	withCert := func(t *testing.T, name string) *tls.Config {
		t.Helper()
		cert, err := tls.LoadX509KeyPair(filepath.Join(certsDir, name+".pem"), filepath.Join(certsDir, name+"-key.pem"))
		if err != nil {
			t.Fatalf("сертификат %s: %v", name, err)
		}
		cfg := base.Clone()
		cfg.Certificates = []tls.Certificate{cert}
		return cfg
	}

	t.Run("с сертификатом web — принято", func(t *testing.T) {
		if err := readAfterHandshake(withCert(t, "web")); err != nil {
			t.Fatalf("mesh отверг клиента web с сертификатом нашего CA: %v", err)
		}
	})

	// edge — тоже сертификат нашего CA, но звать сервисы через mesh ему нельзя (список SAN в mesh.yaml).
	t.Run("с сертификатом edge — отказ", func(t *testing.T) {
		requireTLSRejection(t, readAfterHandshake(withCert(t, "edge")), "клиента edge (SAN не в списке допущенных)")
	})
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
