package server

import (
	"context"
	"fmt"
	"io"
	"net"
	"net/http"
)

// CheckReady asks the local probe listener for /readyz and returns nil on 200.
// It backs the `<service> healthcheck` subcommand: distroless images have no shell or
// curl, so docker compose runs the service binary itself as the container healthcheck.
// probeAddr is the listen address (":8081" or "host:port"); an empty or wildcard host
// means loopback.
func CheckReady(ctx context.Context, probeAddr string) error {
	host, port, err := net.SplitHostPort(probeAddr)
	if err != nil {
		return fmt.Errorf("healthcheck: probe address %q: %w", probeAddr, err)
	}
	if ip := net.ParseIP(host); host == "" || (ip != nil && ip.IsUnspecified()) {
		host = "127.0.0.1"
	}
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, "http://"+net.JoinHostPort(host, port)+"/readyz", nil)
	if err != nil {
		return fmt.Errorf("healthcheck: %w", err)
	}
	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		return fmt.Errorf("healthcheck: %w", err)
	}
	defer func() { _ = resp.Body.Close() }()
	_, _ = io.Copy(io.Discard, resp.Body)
	if resp.StatusCode != http.StatusOK {
		return fmt.Errorf("healthcheck: /readyz returned %d", resp.StatusCode)
	}
	return nil
}
