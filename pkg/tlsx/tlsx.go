// Package tlsx provides mutual TLS for service-to-service gRPC: a tiny dev CA,
// leaf issuance and ready-made server/client tls.Config values.
package tlsx

import (
	"crypto/ecdsa"
	"crypto/elliptic"
	"crypto/rand"
	"crypto/tls"
	"crypto/x509"
	"crypto/x509/pkix"
	"encoding/pem"
	"errors"
	"fmt"
	"math/big"
	"net"
	"os"
	"slices"
	"time"
)

// clockSkew is how far into the past NotBefore is set.
const clockSkew = 5 * time.Minute

func serial() (*big.Int, error) {
	limit := new(big.Int).Lsh(big.NewInt(1), 128)
	n, err := rand.Int(rand.Reader, limit)
	if err != nil {
		return nil, fmt.Errorf("tlsx: serial: %w", err)
	}
	return n, nil
}

func encodeKey(k *ecdsa.PrivateKey) ([]byte, error) {
	der, err := x509.MarshalPKCS8PrivateKey(k)
	if err != nil {
		return nil, fmt.Errorf("tlsx: marshal key: %w", err)
	}
	return pem.EncodeToMemory(&pem.Block{Type: "PRIVATE KEY", Bytes: der}), nil
}

// NewCA creates a self-signed ECDSA P-256 certificate authority.
func NewCA(commonName string, validFor time.Duration) (certPEM, keyPEM []byte, err error) {
	key, err := ecdsa.GenerateKey(elliptic.P256(), rand.Reader)
	if err != nil {
		return nil, nil, fmt.Errorf("tlsx: generate CA key: %w", err)
	}
	sn, err := serial()
	if err != nil {
		return nil, nil, err
	}
	now := time.Now()
	tmpl := &x509.Certificate{
		SerialNumber:          sn,
		Subject:               pkix.Name{CommonName: commonName},
		NotBefore:             now.Add(-clockSkew),
		NotAfter:              now.Add(validFor),
		IsCA:                  true,
		BasicConstraintsValid: true,
		MaxPathLenZero:        true,
		KeyUsage:              x509.KeyUsageCertSign | x509.KeyUsageCRLSign,
	}
	der, err := x509.CreateCertificate(rand.Reader, tmpl, tmpl, &key.PublicKey, key)
	if err != nil {
		return nil, nil, fmt.Errorf("tlsx: create CA: %w", err)
	}
	keyPEM, err = encodeKey(key)
	if err != nil {
		return nil, nil, err
	}
	return pem.EncodeToMemory(&pem.Block{Type: "CERTIFICATE", Bytes: der}), keyPEM, nil
}

func parseCA(caCertPEM, caKeyPEM []byte) (*x509.Certificate, *ecdsa.PrivateKey, error) {
	cb, _ := pem.Decode(caCertPEM)
	if cb == nil {
		return nil, nil, errors.New("tlsx: CA certificate is not PEM")
	}
	cert, err := x509.ParseCertificate(cb.Bytes)
	if err != nil {
		return nil, nil, fmt.Errorf("tlsx: parse CA certificate: %w", err)
	}
	kb, _ := pem.Decode(caKeyPEM)
	if kb == nil {
		return nil, nil, errors.New("tlsx: CA key is not PEM")
	}
	parsed, err := x509.ParsePKCS8PrivateKey(kb.Bytes)
	if err != nil {
		return nil, nil, fmt.Errorf("tlsx: parse CA key: %w", err)
	}
	key, ok := parsed.(*ecdsa.PrivateKey)
	if !ok {
		return nil, nil, errors.New("tlsx: CA key is not ECDSA")
	}
	if !cert.IsCA || cert.KeyUsage&x509.KeyUsageCertSign == 0 {
		return nil, nil, errors.New("tlsx: certificate is not a CA (IsCA and CertSign required)")
	}
	if time.Now().After(cert.NotAfter) {
		return nil, nil, errors.New("tlsx: CA certificate has expired")
	}
	return cert, key, nil
}

// Issue signs a leaf certificate usable as both server and client (CN = name).
// 127.0.0.1 is always added as an IP SAN so local tests and host-mapped ports verify.
func Issue(caCertPEM, caKeyPEM []byte, name string, dnsNames []string, validFor time.Duration) (certPEM, keyPEM []byte, err error) {
	caCert, caKey, err := parseCA(caCertPEM, caKeyPEM)
	if err != nil {
		return nil, nil, err
	}
	key, err := ecdsa.GenerateKey(elliptic.P256(), rand.Reader)
	if err != nil {
		return nil, nil, fmt.Errorf("tlsx: generate key: %w", err)
	}
	sn, err := serial()
	if err != nil {
		return nil, nil, err
	}
	now := time.Now()
	notAfter := now.Add(validFor)
	if notAfter.After(caCert.NotAfter) {
		notAfter = caCert.NotAfter
	}
	tmpl := &x509.Certificate{
		SerialNumber:          sn,
		Subject:               pkix.Name{CommonName: name},
		NotBefore:             now.Add(-clockSkew),
		NotAfter:              notAfter,
		BasicConstraintsValid: true,
		KeyUsage:              x509.KeyUsageDigitalSignature,
		ExtKeyUsage:           []x509.ExtKeyUsage{x509.ExtKeyUsageServerAuth, x509.ExtKeyUsageClientAuth},
		DNSNames:              dnsNames,
		IPAddresses:           []net.IP{net.ParseIP("127.0.0.1")},
	}
	der, err := x509.CreateCertificate(rand.Reader, tmpl, caCert, &key.PublicKey, caKey)
	if err != nil {
		return nil, nil, fmt.Errorf("tlsx: issue %s: %w", name, err)
	}
	keyPEM, err = encodeKey(key)
	if err != nil {
		return nil, nil, err
	}
	return pem.EncodeToMemory(&pem.Block{Type: "CERTIFICATE", Bytes: der}), keyPEM, nil
}

func loadPool(caFile string) (*x509.CertPool, error) {
	data, err := os.ReadFile(caFile)
	if err != nil {
		return nil, fmt.Errorf("tlsx: read CA: %w", err)
	}
	pool := x509.NewCertPool()
	if !pool.AppendCertsFromPEM(data) {
		return nil, fmt.Errorf("tlsx: no certificates in %s", caFile)
	}
	return pool, nil
}

// localhost is in every dev certificate (devcerts) and never identifies a peer.
const localhost = "localhost"

// PeerName returns the peer identity of cert: its only DNS SAN other than "localhost",
// provided that name is in allowed. A platform certificate carries exactly one identity
// (devcerts issues [name, localhost]); the CN is not used. A certificate with no name or
// with two or more names (say web and mesh) has no identity and is rejected, so it can
// never pass as the more privileged one.
func PeerName(cert *x509.Certificate, allowed []string) (string, bool) {
	name := ""
	for _, dns := range cert.DNSNames {
		if dns == localhost {
			continue
		}
		if name != "" {
			return "", false
		}
		name = dns
	}
	if name == "" || !slices.Contains(allowed, name) {
		return "", false
	}
	return name, true
}

// ServerConfig requires and verifies client certificates issued by the CA in caFile and
// accepts only clients whose single DNS SAN is in allowedPeers (see PeerName): any other holder of
// a certificate from the same CA is refused during the handshake. allowedPeers must not be
// empty.
func ServerConfig(certFile, keyFile, caFile string, allowedPeers []string) (*tls.Config, error) {
	peers := make([]string, 0, len(allowedPeers))
	for _, p := range allowedPeers {
		if p != "" && p != localhost {
			peers = append(peers, p)
		}
	}
	if len(peers) == 0 {
		return nil, errors.New("tlsx: allowed peers are required")
	}
	pair, err := tls.LoadX509KeyPair(certFile, keyFile)
	if err != nil {
		return nil, fmt.Errorf("tlsx: load key pair: %w", err)
	}
	pool, err := loadPool(caFile)
	if err != nil {
		return nil, err
	}
	return &tls.Config{
		MinVersion:   tls.VersionTLS13,
		Certificates: []tls.Certificate{pair},
		ClientAuth:   tls.RequireAndVerifyClientCert,
		ClientCAs:    pool,
		NextProtos:   []string{"h2"},
		// Runs after chain verification: the leaf is signed by our CA; now check who it is.
		VerifyConnection: func(cs tls.ConnectionState) error {
			if len(cs.PeerCertificates) == 0 {
				return errors.New("tlsx: no client certificate")
			}
			if _, ok := PeerName(cs.PeerCertificates[0], peers); !ok {
				return fmt.Errorf("tlsx: client %q is not allowed", cs.PeerCertificates[0].Subject.CommonName)
			}
			return nil
		},
	}, nil
}

// ClientConfig presents the client certificate and trusts servers signed by the CA in caFile.
func ClientConfig(certFile, keyFile, caFile string) (*tls.Config, error) {
	pair, err := tls.LoadX509KeyPair(certFile, keyFile)
	if err != nil {
		return nil, fmt.Errorf("tlsx: load key pair: %w", err)
	}
	pool, err := loadPool(caFile)
	if err != nil {
		return nil, err
	}
	return &tls.Config{
		MinVersion:   tls.VersionTLS13,
		Certificates: []tls.Certificate{pair},
		RootCAs:      pool,
		NextProtos:   []string{"h2"},
	}, nil
}
