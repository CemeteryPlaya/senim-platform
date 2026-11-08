package server

import (
	"context"
	"errors"
	"fmt"
	"log/slog"
	"regexp"
	"strings"

	"connectrpc.com/connect/v2"
	"connectrpc.com/connect/v2/connecthttp"

	"github.com/CemeteryPlaya/senim-platform/pkg/tlsx"
)

const (
	// MeshPeer is the TLS identity of the Envoy mesh-gateway. Only from this peer does a
	// service read the caller from the x-forwarded-client-cert header (XFCC).
	MeshPeer = "mesh"

	// CallerHeader echoes the caller identity the service saw back in every response, so
	// the smoke test (and a developer) can see that identity survives the mesh. The caller
	// learns only its own name.
	CallerHeader = "x-senim-caller"

	xfccHeader = "x-forwarded-client-cert"
)

// serviceNameRe — an identity is a service name, as devcerts writes it into the DNS SAN.
var serviceNameRe = regexp.MustCompile(`^[a-z][a-z0-9-]{0,62}$`)

type callerKey struct{}

// Caller returns the identity of the service that made this RPC (ADR-011):
//   - the TLS peer is the mesh → the client certificate the mesh verified, from XFCC;
//     without XFCC it is the mesh itself (Envoy's own health checks);
//   - any other TLS peer (a direct call, e.g. the service's own replica) → that peer's
//     DNS SAN from Options.AllowedPeers; an XFCC header from it is ignored.
//
// Authorization by caller (who may call which method) is the handler's or a later
// interceptor's job; Caller only says who it is. ok is false outside an RPC.
func Caller(ctx context.Context) (name string, ok bool) {
	name, ok = ctx.Value(callerKey{}).(string)
	return name, ok
}

// callerInterceptor puts the caller into the context and into CallerHeader. A request it
// cannot attribute — no verified TLS peer, a peer outside allowed, or an XFCC from the mesh
// that does not parse strictly — is refused with PermissionDenied before the handler runs.
func callerInterceptor(log *slog.Logger, allowed []string) connect.ServerInterceptor {
	return func(next connect.ServerFunc) connect.ServerFunc {
		return func(ctx context.Context, spec connect.Spec, stream connect.ServerStream) error {
			info, _ := connect.CallInfoForServerContext(ctx)
			name, err := identify(ctx, info, allowed)
			if err != nil {
				log.WarnContext(ctx, "rpc: caller rejected", slog.String("procedure", spec.Procedure), slog.Any("err", err))
				return connect.NewError(connect.CodePermissionDenied, "caller identity rejected")
			}
			if info != nil {
				info.ResponseHeader().Set(CallerHeader, name)
			}
			return next(context.WithValue(ctx, callerKey{}, name), spec, stream)
		}
	}
}

func identify(ctx context.Context, info *connect.CallInfo, allowed []string) (string, error) {
	srv, ok := connecthttp.ServerInfoForContext(ctx)
	if !ok || srv.TLS() == nil || len(srv.TLS().PeerCertificates) == 0 {
		return "", errors.New("no verified TLS peer")
	}
	peer, ok := tlsx.PeerName(srv.TLS().PeerCertificates[0], allowed)
	if !ok {
		return "", errors.New("TLS peer is not in AllowedPeers")
	}
	if peer != MeshPeer || info == nil {
		return peer, nil // XFCC from anyone but the mesh is not evidence of anything
	}
	values := info.RequestHeader().Values(xfccHeader)
	switch len(values) {
	case 0:
		return MeshPeer, nil
	case 1:
		return xfccCaller(values[0])
	default:
		return "", fmt.Errorf("%s: %d header values, want 1", xfccHeader, len(values))
	}
}

// xfccKeys — keys Envoy writes into an XFCC element (envoy docs, x-forwarded-client-cert).
var xfccKeys = map[string]bool{"By": true, "Hash": true, "Cert": true, "Chain": true, "Subject": true, "URI": true, "DNS": true}

// xfccCaller parses the XFCC value the mesh sets with forward_client_cert_details:
// SANITIZE_SET — exactly one element, the current hop: key=value pairs split by ';',
// values optionally in double quotes (with \" inside). It returns the first DNS value that
// is not localhost. Anything else — a second element, an unknown key, an empty pair, an
// unterminated quote, no usable DNS — is an error: the service never guesses.
func xfccCaller(value string) (string, error) {
	pairs, err := splitXFCC(value)
	if err != nil {
		return "", fmt.Errorf("%s: %w", xfccHeader, err)
	}
	caller := ""
	for _, p := range pairs {
		k, v, ok := strings.Cut(p, "=")
		if !ok || !xfccKeys[k] {
			return "", fmt.Errorf("%s: unexpected pair %q", xfccHeader, p)
		}
		v, err := unquoteXFCC(v)
		if err != nil {
			return "", fmt.Errorf("%s: %s: %w", xfccHeader, k, err)
		}
		if k != "DNS" || caller != "" || v == "localhost" {
			continue
		}
		if !serviceNameRe.MatchString(v) {
			return "", fmt.Errorf("%s: DNS %q is not a service name", xfccHeader, v)
		}
		caller = v
	}
	if caller == "" {
		return "", fmt.Errorf("%s: no DNS identity", xfccHeader)
	}
	return caller, nil
}

// splitXFCC splits one XFCC element into key=value pairs, honouring quotes. A ',' outside
// quotes means a second element: with SANITIZE_SET there is never one.
func splitXFCC(s string) ([]string, error) {
	var pairs []string
	var cur strings.Builder
	quoted, escaped := false, false
	for _, r := range s {
		switch {
		case escaped:
			escaped = false
		case quoted && r == '\\':
			escaped = true
		case r == '"':
			quoted = !quoted
		case !quoted && r == ',':
			return nil, errors.New("more than one element")
		case !quoted && r == ';':
			if cur.Len() == 0 {
				return nil, errors.New("empty pair")
			}
			pairs = append(pairs, cur.String())
			cur.Reset()
			continue
		}
		cur.WriteRune(r)
	}
	if quoted || escaped {
		return nil, errors.New("unterminated quote")
	}
	if cur.Len() == 0 {
		return nil, errors.New("empty pair")
	}
	return append(pairs, cur.String()), nil
}

func unquoteXFCC(v string) (string, error) {
	if !strings.HasPrefix(v, `"`) {
		if strings.ContainsRune(v, '"') {
			return "", errors.New("stray quote")
		}
		return v, nil
	}
	if len(v) < 2 || !strings.HasSuffix(v, `"`) {
		return "", errors.New("unterminated quote")
	}
	inner := v[1 : len(v)-1]
	var b strings.Builder
	escaped := false
	for _, r := range inner {
		switch {
		case escaped:
			b.WriteRune(r)
			escaped = false
		case r == '\\':
			escaped = true
		case r == '"':
			return "", errors.New("stray quote")
		default:
			b.WriteRune(r)
		}
	}
	return b.String(), nil
}
