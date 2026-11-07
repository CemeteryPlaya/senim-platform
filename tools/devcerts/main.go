// Command devcerts writes a dev CA and per-service mTLS certificates.
package main

import (
	"errors"
	"flag"
	"fmt"
	"io/fs"
	"os"
	"path/filepath"
	"time"

	"github.com/CemeteryPlaya/senim-platform/pkg/tlsx"
)

var services = []string{
	"edge", "mesh", "web", "identity", "deal", "marketplace",
	"documents", "files", "notify", "operator", "audit",
}

const (
	validFor  = 365 * 24 * time.Hour
	certExt   = ".pem"
	keySuffix = "-key" + certExt
)

func main() {
	out := flag.String("out", "", "output directory")
	flag.Parse()
	if *out == "" {
		fmt.Fprintln(os.Stderr, "usage: devcerts -out <dir>")
		os.Exit(2)
	}
	if err := run(*out); err != nil {
		fmt.Fprintln(os.Stderr, "devcerts:", err)
		os.Exit(1)
	}
}

func run(dir string) error {
	if err := os.MkdirAll(dir, 0o755); err != nil {
		return err
	}
	caCert, caKey, err := loadOrCreateCA(dir)
	if err != nil {
		return err
	}
	for _, name := range services {
		cert, key, err := tlsx.Issue(caCert, caKey, name, []string{name, "localhost"}, validFor)
		if err != nil {
			return err
		}
		if err := write(filepath.Join(dir, name+certExt), cert, 0o644); err != nil {
			return err
		}
		if err := write(filepath.Join(dir, name+keySuffix), key, 0o600); err != nil {
			return err
		}
	}
	fmt.Printf("devcerts: %d services in %s\n", len(services), dir)
	return nil
}

// loadOrCreateCA reuses an existing CA pair and creates one only when both files are absent.
func loadOrCreateCA(dir string) (cert, key []byte, err error) {
	certPath, keyPath := filepath.Join(dir, "ca"+certExt), filepath.Join(dir, "ca"+keySuffix)
	cert, cerr := os.ReadFile(certPath)
	key, kerr := os.ReadFile(keyPath)
	if cerr == nil && kerr == nil {
		return cert, key, nil
	}
	for _, e := range []error{cerr, kerr} {
		if e != nil && !errors.Is(e, fs.ErrNotExist) {
			return nil, nil, e
		}
	}
	cert, key, err = tlsx.NewCA("senim-dev-ca", validFor)
	if err != nil {
		return nil, nil, err
	}
	if err := write(certPath, cert, 0o644); err != nil {
		return nil, nil, err
	}
	if err := write(keyPath, key, 0o600); err != nil {
		return nil, nil, err
	}
	return cert, key, nil
}

func write(path string, data []byte, mode os.FileMode) error {
	if err := os.WriteFile(path, data, mode); err != nil {
		return err
	}
	return os.Chmod(path, mode)
}
