// Package authz проверяет внутренний токен доступа, который выдаёт identity (спека §4.4,
// ADR-011): JWT EdDSA с kid в заголовке. Сервис-владелец проверяет подпись сам, не
// доверяя web и operator.
//
// Интерсептор только удостоверяет вызывающего: есть верный токен — Claims в контексте;
// токена нет — обработчик вызывается без Claims; токен есть, но неверен — отказ
// Unauthenticated / token_invalid. Решение о правах — в обработчике, первой строкой.
//
// Подключение в сервисе:
//
//	keys := authz.IdentityKeys(identityv1connect.NewIdentityServiceClient(mesh), 10*time.Minute)
//	ver := authz.NewVerifier(keys)
//	// authz.Interceptor(ver) — в connect.NewServer(...) рядом с остальными; затем в обработчике:
//	claims, ok := authz.FromContext(ctx)
package authz

import (
	"context"
	"crypto/ed25519"
	"errors"
	"fmt"
	"strings"
	"time"

	"connectrpc.com/connect/v2"
	"connectrpc.com/connect/v2/connectproto"
	"github.com/golang-jwt/jwt/v5"

	commonv1 "github.com/CemeteryPlaya/senim-platform/gen/go/senim/common/v1"
)

const (
	// Issuer и Audience — значения iss и aud внутреннего токена identity.
	Issuer   = "senim-identity"
	Audience = "senim"

	leeway      = 30 * time.Second // допуск расхождения часов
	maxTokenLen = 4096

	codeTokenInvalid    = "token_invalid"
	codeAuthUnavailable = "auth_unavailable"
)

var (
	// ErrTokenInvalid — токен не прошёл проверку. Причина — в тексте после двоеточия,
	// сам токен в ошибку не попадает.
	ErrTokenInvalid = errors.New("authz: token invalid")
	// ErrKeysUnavailable — ключей проверки нет (identity недоступен), токен не оценён.
	ErrKeysUnavailable = errors.New("authz: signing keys unavailable")
)

// Claims — проверенное содержимое токена. Role — активная роль сессии, Roles — все роли.
type Claims struct {
	UserID    string
	SessionID string
	Role      string
	Roles     []string
	MFA       bool
	ExpiresAt time.Time
}

type tokenClaims struct {
	SID   string   `json:"sid"`
	Role  string   `json:"role"`
	Roles []string `json:"roles"`
	MFA   bool     `json:"mfa"`
	jwt.RegisteredClaims
}

// Verifier проверяет токены по ключам из KeySource. Безопасен для параллельных вызовов,
// если безопасен KeySource.
type Verifier struct {
	src    KeySource
	now    func() time.Time
	parser *jwt.Parser
}

// NewVerifier создаёт проверяющего.
func NewVerifier(src KeySource) *Verifier {
	v := &Verifier{src: src, now: time.Now}
	v.build()
	return v
}

// WithClock подменяет часы (тесты). Возвращает v.
func (v *Verifier) WithClock(now func() time.Time) *Verifier {
	v.now = now
	v.build()
	return v
}

func (v *Verifier) build() {
	v.parser = jwt.NewParser(
		jwt.WithValidMethods([]string{jwt.SigningMethodEdDSA.Alg()}),
		jwt.WithIssuer(Issuer),
		jwt.WithAudience(Audience),
		jwt.WithExpirationRequired(),
		jwt.WithLeeway(leeway),
		jwt.WithTimeFunc(v.now),
	)
}

func invalid(why string) error { return fmt.Errorf("%w: %s", ErrTokenInvalid, why) }

// Verify проверяет подпись (только EdDSA, ключ по kid), iss, aud, exp (допуск 30 с) и
// наличие sub, sid, role. Ошибки: ErrTokenInvalid (с причиной) или ErrKeysUnavailable.
func (v *Verifier) Verify(ctx context.Context, token string) (Claims, error) {
	if token == "" || len(token) > maxTokenLen {
		return Claims{}, invalid("malformed")
	}
	var keysErr error
	claims := &tokenClaims{}
	parsed, err := v.parser.ParseWithClaims(token, claims, func(t *jwt.Token) (any, error) {
		kid, _ := t.Header["kid"].(string)
		if kid == "" {
			return nil, errors.New("no kid")
		}
		key, err := v.key(ctx, kid)
		if err != nil {
			if errors.Is(err, ErrKeysUnavailable) {
				keysErr = err
			}
			return nil, err
		}
		return key, nil
	})
	if keysErr != nil {
		return Claims{}, keysErr
	}
	if err != nil {
		return Claims{}, invalid(reason(err))
	}
	if !parsed.Valid {
		return Claims{}, invalid("not valid")
	}
	if claims.Subject == "" || claims.SID == "" || claims.Role == "" {
		return Claims{}, invalid("missing claim")
	}
	return Claims{
		UserID: claims.Subject, SessionID: claims.SID, Role: claims.Role, Roles: claims.Roles,
		MFA: claims.MFA, ExpiresAt: claims.ExpiresAt.Time,
	}, nil
}

// key ищет ключ по kid; неизвестный kid — внеочередное обновление источника (если он
// умеет), затем отказ.
func (v *Verifier) key(ctx context.Context, kid string) (ed25519.PublicKey, error) {
	keys, err := v.src.Keys(ctx)
	if err != nil {
		return nil, fmt.Errorf("%w: %w", ErrKeysUnavailable, err)
	}
	if k, ok := keys[kid]; ok {
		return k, nil
	}
	if r, ok := v.src.(Refresher); ok {
		keys, err = r.Refresh(ctx)
		if k, found := keys[kid]; found {
			return k, nil
		}
		if err != nil {
			return nil, fmt.Errorf("%w: %w", ErrKeysUnavailable, err)
		}
	}
	return nil, errors.New("unknown kid")
}

// reason — короткая причина без содержимого токена.
func reason(err error) string {
	switch {
	case errors.Is(err, jwt.ErrTokenExpired):
		return "expired"
	case errors.Is(err, jwt.ErrTokenNotValidYet):
		return "not yet valid"
	case errors.Is(err, jwt.ErrTokenInvalidIssuer):
		return "issuer"
	case errors.Is(err, jwt.ErrTokenInvalidAudience):
		return "audience"
	case errors.Is(err, jwt.ErrTokenRequiredClaimMissing):
		return "missing claim"
	case errors.Is(err, jwt.ErrTokenMalformed):
		return "malformed"
	case errors.Is(err, jwt.ErrTokenSignatureInvalid):
		return "signature or algorithm"
	case errors.Is(err, jwt.ErrTokenUnverifiable):
		return "unknown or missing kid"
	default:
		return "rejected"
	}
}

type claimsKey struct{}

// FromContext возвращает проверенные Claims вызова; ok false — токена не было.
func FromContext(ctx context.Context) (Claims, bool) {
	c, ok := ctx.Value(claimsKey{}).(Claims)
	return c, ok
}

// Interceptor — серверный интерсептор: заголовок authorization: Bearer <токен>.
// Нет заголовка — вызов идёт дальше без Claims; верный токен — Claims в контексте; неверный —
// Unauthenticated / token_invalid; ключей нет (identity недоступен) — Unavailable /
// auth_unavailable. Прав не решает.
func Interceptor(v *Verifier) connect.ServerInterceptor {
	return func(next connect.ServerFunc) connect.ServerFunc {
		return func(ctx context.Context, spec connect.Spec, stream connect.ServerStream) error {
			info, ok := connect.CallInfoForServerContext(ctx)
			if !ok {
				return next(ctx, spec, stream)
			}
			header := info.RequestHeader().Get("authorization")
			if header == "" {
				return next(ctx, spec, stream)
			}
			scheme, token, _ := strings.Cut(header, " ")
			if !strings.EqualFold(scheme, "bearer") {
				return refuse(connect.CodeUnauthenticated, codeTokenInvalid)
			}
			claims, err := v.Verify(ctx, strings.TrimSpace(token))
			switch {
			case errors.Is(err, ErrKeysUnavailable):
				return refuse(connect.CodeUnavailable, codeAuthUnavailable)
			case err != nil:
				return refuse(connect.CodeUnauthenticated, codeTokenInvalid)
			}
			return next(context.WithValue(ctx, claimsKey{}, claims), spec, stream)
		}
	}
}

func refuse(code connect.Code, why string) error {
	e := connect.NewError(code, why)
	if d, err := connectproto.NewErrorDetail(&commonv1.ErrorDetail{Code: why}); err == nil {
		e = e.WithDetail(d)
	}
	return e
}
