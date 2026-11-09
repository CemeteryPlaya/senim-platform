package internal

import (
	"context"
	"crypto/sha256"
	"errors"
	"time"

	"connectrpc.com/connect/v2"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgtype"
	"google.golang.org/protobuf/proto"
	"google.golang.org/protobuf/types/known/timestamppb"

	identityv1 "github.com/CemeteryPlaya/senim-platform/gen/go/senim/identity/v1"
	"github.com/CemeteryPlaya/senim-platform/gen/go/senim/identity/v1/identityv1connect"
	"github.com/CemeteryPlaya/senim-platform/pkg/dbx"
	"github.com/CemeteryPlaya/senim-platform/pkg/idem"
	"github.com/CemeteryPlaya/senim-platform/services/identity/internal/store"
)

// lastSeenThrottle — как часто Authenticate обновляет last_seen_at: чаще раза в минуту
// запись не меняется, чтобы чтение не превращалось в запись на каждый запрос страницы.
const lastSeenThrottle = time.Minute

func sessionInvalid() error { return rpcError(connect.CodeUnauthenticated, "session_invalid", nil) }

func ts(t time.Time) pgtype.Timestamptz { return pgtype.Timestamptz{Time: t, Valid: true} }

// sessionLive — сессия действует: не отозвана, не вышел абсолютный срок, нет простоя
// дольше idleTimeout. Границы строгие: ровно в срок сессия уже недействительна.
func sessionLive(sess store.Session, now time.Time) bool {
	return !sess.RevokedAt.Valid &&
		now.Before(sess.ExpiresAt.Time) &&
		now.Before(sess.LastSeenAt.Time.Add(idleTimeout))
}

// sessionUsable — сессия действует и её пользователь не заблокирован.
func sessionUsable(sess store.Session, user store.User, now time.Time) bool {
	return sessionLive(sess, now) && !user.BlockedAt.Valid
}

// sessionByToken находит сессию по токену из запроса. Токен неверного формата и
// неизвестный токен — одно и то же: ok=false. lock берёт блокировку строки (FOR UPDATE).
func sessionByToken(ctx context.Context, q *store.Queries, token string, lock bool) (sess store.Session, ok bool, err error) {
	if !validSessionToken(token) {
		return sess, false, nil
	}
	sum := sha256.Sum256([]byte(token))
	if lock {
		sess, err = q.LockSessionByTokenHash(ctx, sum[:])
	} else {
		sess, err = q.GetSessionByTokenHash(ctx, sum[:])
	}
	if errors.Is(err, pgx.ErrNoRows) {
		return sess, false, nil
	}
	return sess, err == nil, err
}

// sessionView — ответ про сессию: активная роль считается по правилу activeRole, а не
// берётся из строки как есть (выданные роли могли измениться).
func sessionView(sess store.Session, user store.User) *identityv1.Session {
	sess.ActiveRole = activeRole(user.Roles, user.DefaultRole, &sess.ActiveRole)
	return sessionProto(sess, idleTimeout)
}

// issueAccessToken — шов для Task 7: внутренний токен (Ed25519, 5 мин). Пока токена нет:
// пустая строка и нулевое время; Task 7 заменяет только тело.
func (s *Service) issueAccessToken(_ context.Context, _ store.User, _ store.Session) (token string, expiresAt time.Time, err error) {
	return "", time.Time{}, nil
}

// Authenticate — чтение: по токену сессии возвращает пользователя, сессию и внутренний
// токен. Неверный формат, неизвестный, отозванный, истёкший (срок или простой) токен и
// заблокированный пользователь дают одно и то же: Unauthenticated / session_invalid.
func (s *Service) Authenticate(ctx context.Context, req *identityv1.AuthenticateRequest) (*identityv1.AuthenticateResponse, error) {
	if err := requireCaller(ctx, webCaller); err != nil {
		return nil, err
	}
	q := store.New(s.pool)
	sess, ok, err := sessionByToken(ctx, q, req.GetSessionToken(), false)
	if err != nil {
		s.log.ErrorContext(ctx, "authenticate: поиск сессии", "err", err)
		return nil, internalError()
	}
	if !ok {
		return nil, sessionInvalid()
	}
	user, err := q.GetUserByID(ctx, sess.UserID)
	if err != nil {
		s.log.ErrorContext(ctx, "authenticate: поиск пользователя", "err", err)
		return nil, internalError()
	}
	now := s.now()
	if !sessionUsable(sess, user, now) {
		return nil, sessionInvalid()
	}
	touched, err := q.TouchSession(ctx, store.TouchSessionParams{Now: ts(now), ID: sess.ID, Before: ts(now.Add(-lastSeenThrottle))})
	if err != nil {
		s.log.ErrorContext(ctx, "authenticate: last_seen_at", "err", err)
		return nil, internalError()
	}
	if touched == 1 {
		sess.LastSeenAt = ts(now)
	}
	access, accessExp, err := s.issueAccessToken(ctx, user, sess)
	if err != nil {
		s.log.ErrorContext(ctx, "authenticate: внутренний токен", "err", err)
		return nil, internalError()
	}
	resp := &identityv1.AuthenticateResponse{User: userProto(user), Session: sessionView(sess, user), AccessToken: access}
	if access != "" {
		resp.AccessExpiresAt = timestamppb.New(accessExp)
	}
	return resp, nil
}

// idempotent выполняет изменяющий вызов по схеме VerifyOtp: повтор по ключу (Lookup ждёт
// идущий вызов с тем же ключом) и затем транзакция с idem.Do. Lookup — до транзакции:
// внутри Do его звать нельзя. Отказ по делу (connect.Error из fn) уходит как есть,
// транзакция откатывается вместе с заявкой ключа. resp заполняется и при повторе.
func (s *Service) idempotent(ctx context.Context, op, method, key string, req, resp proto.Message, fn func(tx pgx.Tx) error) error {
	found, err := idem.Lookup(ctx, s.pool, method, key, req, resp)
	if errors.Is(err, idem.ErrKeyReused) {
		return rpcError(connect.CodeInvalidArgument, "idempotency_key_reused", nil)
	}
	if err != nil {
		// Побочных эффектов ещё нет: «повторите» — правда.
		s.log.ErrorContext(ctx, op+": проверка ключа идемпотентности", "err", err)
		return connect.NewError(connect.CodeUnavailable, "unavailable")
	}
	if found {
		return nil
	}
	err = dbx.InTx(ctx, s.pool, func(tx pgx.Tx) error {
		_, err := idem.Do(ctx, tx, method, key, req, resp, func() error { return fn(tx) })
		return err
	})
	if errors.Is(err, idem.ErrKeyReused) {
		return rpcError(connect.CodeInvalidArgument, "idempotency_key_reused", nil)
	}
	var ce *connect.Error
	if errors.As(err, &ce) {
		return err
	}
	if err != nil {
		s.log.ErrorContext(ctx, op, "err", err)
		return internalError()
	}
	return nil
}

func validIdempotencyKey(key string) bool { return key != "" && len(key) <= maxIdempotencyKey }

// SignOut отзывает эту сессию. Неизвестный, кривой или уже отозванный токен — успех без
// изменений: выход идемпотентен, человеку нечего показывать.
func (s *Service) SignOut(ctx context.Context, req *identityv1.SignOutRequest) (*identityv1.SignOutResponse, error) {
	if err := requireCaller(ctx, webCaller); err != nil {
		return nil, err
	}
	if !validIdempotencyKey(req.GetIdempotencyKey()) {
		return nil, rpcError(connect.CodeInvalidArgument, "invalid_request", nil)
	}
	resp := &identityv1.SignOutResponse{}
	err := s.idempotent(ctx, "sign_out", identityv1connect.IdentityServiceSignOutProcedure, req.GetIdempotencyKey(), req, resp, func(tx pgx.Tx) error {
		if !validSessionToken(req.GetSessionToken()) {
			return nil
		}
		sum := sha256.Sum256([]byte(req.GetSessionToken()))
		_, err := store.New(tx).RevokeSessionByTokenHash(ctx, store.RevokeSessionByTokenHashParams{TokenHash: sum[:], RevokedAt: ts(s.now())})
		return err
	})
	if err != nil {
		return nil, err
	}
	return resp, nil
}

// SignOutEverywhere отзывает все сессии пользователя этого токена. Токен, по которому
// нельзя доказать вход (кривой, неизвестный, отозванный, истёкший), — успех без изменений.
func (s *Service) SignOutEverywhere(ctx context.Context, req *identityv1.SignOutEverywhereRequest) (*identityv1.SignOutEverywhereResponse, error) {
	if err := requireCaller(ctx, webCaller); err != nil {
		return nil, err
	}
	if !validIdempotencyKey(req.GetIdempotencyKey()) {
		return nil, rpcError(connect.CodeInvalidArgument, "invalid_request", nil)
	}
	resp := &identityv1.SignOutEverywhereResponse{}
	err := s.idempotent(ctx, "sign_out_everywhere", identityv1connect.IdentityServiceSignOutEverywhereProcedure, req.GetIdempotencyKey(), req, resp, func(tx pgx.Tx) error {
		q := store.New(tx)
		now := s.now()
		sess, ok, err := sessionByToken(ctx, q, req.GetSessionToken(), false)
		if err != nil || !ok || !sessionLive(sess, now) {
			return err
		}
		_, err = q.RevokeUserSessions(ctx, store.RevokeUserSessionsParams{UserID: sess.UserID, RevokedAt: ts(now)})
		return err
	})
	if err != nil {
		return nil, err
	}
	return resp, nil
}
