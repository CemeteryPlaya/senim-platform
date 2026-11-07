package tlsx_test

import (
	"crypto/tls"
	"crypto/x509"
	"encoding/pem"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"github.com/CemeteryPlaya/senim-platform/pkg/tlsx"
)

type pki struct {
	dir    string
	caFile string
	caCert []byte
	caKey  []byte
}

func newPKI(t *testing.T) *pki {
	t.Helper()
	dir := t.TempDir()
	caCert, caKey, err := tlsx.NewCA("test-ca", time.Hour)
	if err != nil {
		t.Fatalf("NewCA: %v", err)
	}
	p := &pki{dir: dir, caFile: filepath.Join(dir, "ca.pem"), caCert: caCert, caKey: caKey}
	if err := os.WriteFile(p.caFile, caCert, 0o600); err != nil {
		t.Fatal(err)
	}
	return p
}

// leaf issues a certificate and returns file paths for cert and key.
func (p *pki) leaf(t *testing.T, name string) (certFile, keyFile string) {
	t.Helper()
	c, k, err := tlsx.Issue(p.caCert, p.caKey, name, []string{name, "localhost"}, time.Hour)
	if err != nil {
		t.Fatalf("Issue %s: %v", name, err)
	}
	certFile = filepath.Join(p.dir, name+".pem")
	keyFile = filepath.Join(p.dir, name+"-key.pem")
	if err := os.WriteFile(certFile, c, 0o600); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(keyFile, k, 0o600); err != nil {
		t.Fatal(err)
	}
	return certFile, keyFile
}

type serverResult struct {
	cn     string
	err    error // handshake (or accept) error
	noPeer bool  // handshake succeeded but the client presented no certificate
}

func mustContain(t *testing.T, err error, subs ...string) {
	t.Helper()
	if err == nil {
		t.Fatalf("expected error containing one of %q, got nil", subs)
	}
	for _, s := range subs {
		if strings.Contains(err.Error(), s) {
			return
		}
	}
	t.Fatalf("error %q contains none of %q", err, subs)
}

// serve starts a TLS listener; the first connection's handshake result is sent on the channel.
func serve(t *testing.T, cfg *tls.Config) (addr string, res <-chan serverResult) {
	t.Helper()
	ln, err := tls.Listen("tcp", "127.0.0.1:0", cfg)
	if err != nil {
		t.Fatalf("Listen: %v", err)
	}
	t.Cleanup(func() { _ = ln.Close() })
	ch := make(chan serverResult, 1)
	go func() {
		conn, err := ln.Accept()
		if err != nil {
			ch <- serverResult{err: err}
			return
		}
		defer func() { _ = conn.Close() }()
		tc := conn.(*tls.Conn)
		_ = tc.SetDeadline(time.Now().Add(5 * time.Second))
		if err := tc.Handshake(); err != nil {
			ch <- serverResult{err: err}
			return
		}
		// TLS 1.3: read once so client-side rejection alerts surface.
		_, _ = tc.Read(make([]byte, 1))
		peers := tc.ConnectionState().PeerCertificates
		if len(peers) == 0 {
			ch <- serverResult{noPeer: true}
			return
		}
		ch <- serverResult{cn: peers[0].Subject.CommonName}
	}()
	return ln.Addr().String(), ch
}

// roundTrip dials, handshakes and performs one write+read so TLS 1.3 post-handshake alerts are seen.
func roundTrip(addr string, cfg *tls.Config) error {
	d := &tls.Dialer{NetDialer: nil, Config: cfg}
	conn, err := d.Dial("tcp", addr)
	if err != nil {
		return err
	}
	defer func() { _ = conn.Close() }()
	_ = conn.SetDeadline(time.Now().Add(5 * time.Second))
	if _, err := conn.Write([]byte("x")); err != nil {
		return err
	}
	_, err = conn.Read(make([]byte, 1))
	return err
}

func serverCfg(t *testing.T, p *pki) *tls.Config {
	t.Helper()
	cert, key := p.leaf(t, "identity")
	cfg, err := tlsx.ServerConfig(cert, key, p.caFile)
	if err != nil {
		t.Fatalf("ServerConfig: %v", err)
	}
	return cfg
}

func TestMutualTLSAccepts(t *testing.T) {
	p := newPKI(t)
	addr, res := serve(t, serverCfg(t, p))
	cert, key := p.leaf(t, "web")
	ccfg, err := tlsx.ClientConfig(cert, key, p.caFile)
	if err != nil {
		t.Fatalf("ClientConfig: %v", err)
	}
	ccfg.ServerName = "identity"
	conn, err := tls.Dial("tcp", addr, ccfg)
	if err != nil {
		t.Fatalf("dial: %v", err)
	}
	defer func() { _ = conn.Close() }()
	if got := conn.ConnectionState().NegotiatedProtocol; got != "h2" {
		t.Errorf("ALPN = %q, want h2", got)
	}
	if conn.ConnectionState().Version != tls.VersionTLS13 {
		t.Errorf("version = %x, want TLS 1.3", conn.ConnectionState().Version)
	}
	_, _ = conn.Write([]byte("x"))
	r := <-res
	if r.err != nil {
		t.Fatalf("server: %v", r.err)
	}
	if r.cn != "web" {
		t.Errorf("client CN = %q, want web", r.cn)
	}
}

func TestRejectsClientWithoutCert(t *testing.T) {
	p := newPKI(t)
	addr, res := serve(t, serverCfg(t, p))
	cert, key := p.leaf(t, "web")
	ccfg, err := tlsx.ClientConfig(cert, key, p.caFile)
	if err != nil {
		t.Fatalf("ClientConfig: %v", err)
	}
	ccfg.Certificates = nil // no client certificate
	ccfg.ServerName = "identity"
	mustContain(t, roundTrip(addr, ccfg), "certificate required", "bad certificate")
	r := <-res
	if r.noPeer {
		t.Fatal("server completed handshake without a client certificate")
	}
	mustContain(t, r.err, "client didn't provide a certificate")
}

func TestRejectsForeignCA(t *testing.T) {
	p := newPKI(t)
	foreign := newPKI(t)
	addr, res := serve(t, serverCfg(t, p))
	cert, key := foreign.leaf(t, "web")
	// Client trusts the real CA for the server, but presents a cert from a foreign CA.
	ccfg, err := tlsx.ClientConfig(cert, key, p.caFile)
	if err != nil {
		t.Fatalf("ClientConfig: %v", err)
	}
	ccfg.ServerName = "identity"
	mustContain(t, roundTrip(addr, ccfg), "bad certificate", "unknown certificate authority")
	r := <-res
	if r.noPeer || r.cn != "" {
		t.Fatalf("server accepted foreign client certificate: %+v", r)
	}
	mustContain(t, r.err, "unknown authority")
}

func TestClientRejectsForeignServerCert(t *testing.T) {
	p := newPKI(t)
	foreign := newPKI(t)
	// Server presents a certificate issued by a foreign CA.
	cert, key := foreign.leaf(t, "identity")
	scfg, err := tlsx.ServerConfig(cert, key, p.caFile)
	if err != nil {
		t.Fatalf("ServerConfig: %v", err)
	}
	addr, res := serve(t, scfg)
	ccert, ckey := p.leaf(t, "web")
	ccfg, err := tlsx.ClientConfig(ccert, ckey, p.caFile)
	if err != nil {
		t.Fatalf("ClientConfig: %v", err)
	}
	ccfg.ServerName = "identity"
	mustContain(t, roundTrip(addr, ccfg), "unknown authority")
	r := <-res
	if r.err == nil || r.cn != "" {
		t.Fatalf("server handshake should fail after client rejection: %+v", r)
	}
}

func TestIssueRejectsNonCA(t *testing.T) {
	p := newPKI(t)
	leafCert, leafKey, err := tlsx.Issue(p.caCert, p.caKey, "web", []string{"web"}, time.Hour)
	if err != nil {
		t.Fatal(err)
	}
	if _, _, err := tlsx.Issue(leafCert, leafKey, "x", []string{"x"}, time.Hour); err == nil {
		t.Fatal("leaf certificate accepted as CA")
	}
}

func TestIssueRejectsExpiredCA(t *testing.T) {
	caCert, caKey, err := tlsx.NewCA("old", -time.Hour)
	if err != nil {
		t.Fatal(err)
	}
	if _, _, err := tlsx.Issue(caCert, caKey, "web", []string{"web"}, time.Hour); err == nil {
		t.Fatal("expired CA accepted")
	}
}

func TestIssueClampsToCAExpiry(t *testing.T) {
	p := newPKI(t) // CA valid for one hour
	c, _, err := tlsx.Issue(p.caCert, p.caKey, "web", []string{"web"}, 100*time.Hour)
	if err != nil {
		t.Fatal(err)
	}
	leaf, err := x509.ParseCertificate(mustDecode(t, c))
	if err != nil {
		t.Fatal(err)
	}
	ca, err := x509.ParseCertificate(mustDecode(t, p.caCert))
	if err != nil {
		t.Fatal(err)
	}
	if leaf.NotAfter.After(ca.NotAfter) {
		t.Fatalf("leaf NotAfter %v after CA NotAfter %v", leaf.NotAfter, ca.NotAfter)
	}
}

func mustDecode(t *testing.T, b []byte) []byte {
	t.Helper()
	blk, _ := pem.Decode(b)
	if blk == nil {
		t.Fatal("not PEM")
	}
	return blk.Bytes
}
