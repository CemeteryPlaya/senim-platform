package internal

import (
	"context"
	"crypto/ed25519"
	"errors"
	"slices"
	"time"

	"github.com/golang-jwt/jwt/v5"

	identityv1 "github.com/CemeteryPlaya/senim-platform/gen/go/senim/identity/v1"
	"github.com/CemeteryPlaya/senim-platform/services/identity/internal/store"
	"github.com/CemeteryPlaya/senim-platform/tools/services"
)

const (
	// accessTokenTTL — срок внутреннего токена (спека §4.4); не дольше сессии.
	accessTokenTTL = 5 * time.Minute
	tokenIssuer    = "senim-identity"
	tokenAudience  = "senim"
	// keyAlg — алгоритм подписи в ответе GetSigningKeys.
	keyAlg = "EdDSA"
)

// accessClaims — содержимое внутреннего токена. Роли — имена как в базе (CLIENT, ...).
type accessClaims struct {
	UserID    string
	SessionID string
	Role      string
	Roles     []string
	MFA       bool
	MFAAt     time.Time // когда в сессии пройден второй фактор; нулевое — не пройден
	ExpiresAt time.Time // верхняя граница срока (конец сессии); exp не позже неё
}

type jwtClaims struct {
	SID   string   `json:"sid"`
	Role  string   `json:"role"`
	Roles []string `json:"roles"`
	MFA   bool     `json:"mfa"`
	MFAAt int64    `json:"mfa_at"` // Unix-секунды; 0 — второй фактор не пройден
	jwt.RegisteredClaims
}

// signAccessToken подписывает токен ключом key. exp = min(now + 5 мин, c.ExpiresAt);
// возвращает токен и фактический exp. Токен нельзя писать в лог.
func signAccessToken(key ed25519.PrivateKey, kid string, c accessClaims, now time.Time) (string, time.Time, error) {
	if len(key) != ed25519.PrivateKeySize || kid == "" {
		return "", time.Time{}, errors.New("identity: ключ подписи не задан")
	}
	exp := now.Add(accessTokenTTL)
	if !c.ExpiresAt.IsZero() && c.ExpiresAt.Before(exp) {
		exp = c.ExpiresAt
	}
	var mfaAt int64
	if c.MFA && !c.MFAAt.IsZero() {
		mfaAt = c.MFAAt.Unix()
	}
	t := jwt.NewWithClaims(jwt.SigningMethodEdDSA, jwtClaims{
		SID: c.SessionID, Role: c.Role, Roles: c.Roles, MFA: c.MFA, MFAAt: mfaAt,
		RegisteredClaims: jwt.RegisteredClaims{
			Issuer: tokenIssuer, Subject: c.UserID, Audience: jwt.ClaimStrings{tokenAudience},
			IssuedAt: jwt.NewNumericDate(now), ExpiresAt: jwt.NewNumericDate(exp),
		},
	})
	t.Header["kid"] = kid
	signed, err := t.SignedString(key)
	if err != nil {
		return "", time.Time{}, err
	}
	return signed, exp, nil
}

// issueAccessToken — внутренний токен для сессии: активная роль считается по правилу
// activeRole, срок не дольше сессии; mfa и mfa_at — из mfa_verified_at сессии.
func (s *Service) issueAccessToken(_ context.Context, user store.User, sess store.Session) (token string, expiresAt time.Time, err error) {
	return signAccessToken(s.cfg.TokenSigningKey, s.cfg.TokenKID, accessClaims{
		UserID:    user.ID.String(),
		SessionID: sess.ID.String(),
		Role:      activeRole(user.Roles, user.DefaultRole, &sess.ActiveRole),
		Roles:     user.Roles,
		MFA:       sess.MfaVerifiedAt.Valid,
		MFAAt:     sess.MfaVerifiedAt.Time,
		ExpiresAt: sess.ExpiresAt.Time,
	}, s.now())
}

// GetSigningKeys — чтение: публичные ключи проверки токенов (текущий, затем прежний на
// время ротации). Вызывают сервисы платформы; web и входной edge не вызывают.
func (s *Service) GetSigningKeys(ctx context.Context, _ *identityv1.GetSigningKeysRequest) (*identityv1.GetSigningKeysResponse, error) {
	if err := requireCaller(ctx, services.Go...); err != nil {
		return nil, err
	}
	pub, ok := s.cfg.TokenSigningKey.Public().(ed25519.PublicKey)
	if !ok {
		s.log.ErrorContext(ctx, "get_signing_keys: ключ подписи не задан")
		return nil, internalError()
	}
	keys := []*identityv1.SigningKey{{Kid: s.cfg.TokenKID, PublicKey: slices.Clone(pub), Alg: keyAlg}}
	if p := s.cfg.TokenPreviousKey; p != nil {
		keys = append(keys, &identityv1.SigningKey{Kid: p.KID, PublicKey: slices.Clone(p.Public), Alg: keyAlg})
	}
	return &identityv1.GetSigningKeysResponse{Keys: keys}, nil
}
