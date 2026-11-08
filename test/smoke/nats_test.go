//go:build smoke

package smoke

import (
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"github.com/nats-io/nats.go"

	"github.com/CemeteryPlaya/senim-platform/pkg/natsx"
)

const natsURL = "tls://127.0.0.1:4222"

// devVar читает значение из deploy/compose/dev.vars (dev-заглушки стенда).
func devVar(t *testing.T, key string) string {
	t.Helper()
	data, err := os.ReadFile("../../deploy/compose/dev.vars")
	if err != nil {
		t.Fatal(err)
	}
	for line := range strings.Lines(string(data)) {
		if v, ok := strings.CutPrefix(strings.TrimSpace(line), key+"="); ok {
			return v
		}
	}
	t.Fatalf("dev.vars: нет %s", key)
	return ""
}

func natsCfg(cert, user, password string) natsx.Config {
	return natsx.Config{
		URL: natsURL, User: user, Password: password,
		CertFile: filepath.Join(certsDir, cert+".pem"),
		KeyFile:  filepath.Join(certsDir, cert+"-key.pem"),
		CAFile:   filepath.Join(certsDir, "ca.pem"),
	}
}

// TestNATSRequiresAccountAndTLS: NATS стенда пускает только по TLS с сертификатом нашего CA и с
// учётной записью сервиса (ADR-012); identity публикует только в свои субъекты.
func TestNATSRequiresAccountAndTLS(t *testing.T) {
	if nc, err := natsx.Connect(natsCfg("web", "", ""), "web", nil); err == nil {
		nc.Close()
		t.Fatal("NATS принял web без учётной записи")
	}
	if nc, err := nats.Connect("nats://127.0.0.1:4222", nats.Timeout(ioTimeout)); err == nil {
		nc.Close()
		t.Fatal("NATS принял соединение без TLS")
	}

	violations := make(chan string, 4)
	nc, err := nats.Connect(natsURL, nats.Timeout(ioTimeout),
		nats.UserInfo("identity", devVar(t, "IDENTITY_NATS_PASSWORD")),
		nats.ClientCert(filepath.Join(certsDir, "identity.pem"), filepath.Join(certsDir, "identity-key.pem")),
		nats.RootCAs(filepath.Join(certsDir, "ca.pem")),
		nats.CustomInboxPrefix(natsx.InboxPrefix("identity")),
		nats.ErrorHandler(func(_ *nats.Conn, _ *nats.Subscription, err error) { violations <- err.Error() }))
	if err != nil {
		t.Fatalf("identity с учётной записью и сертификатом: %v", err)
	}
	defer nc.Close()
	if err := nc.Publish("senim.deal.offer_concluded", []byte("forged")); err != nil {
		t.Fatal(err)
	}
	_ = nc.Flush()
	select {
	case v := <-violations:
		if !strings.Contains(v, "Permissions Violation") || !strings.Contains(v, "senim.deal.offer_concluded") {
			t.Fatalf("ожидалось нарушение прав на senim.deal.*, получено: %s", v)
		}
		t.Logf("identity → senim.deal.*: %s", v)
	case <-time.After(ioTimeout):
		t.Fatal("NATS не отверг публикацию identity в senim.deal.*")
	}
}
