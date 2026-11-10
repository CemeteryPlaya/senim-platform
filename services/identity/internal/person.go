package internal

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"strconv"
	"time"

	"connectrpc.com/connect/v2"
	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgconn"
	"github.com/jackc/pgx/v5/pgtype"
	"google.golang.org/protobuf/proto"
	"google.golang.org/protobuf/types/known/timestamppb"

	eventsv1 "github.com/CemeteryPlaya/senim-platform/gen/go/senim/events/v1"
	identityv1 "github.com/CemeteryPlaya/senim-platform/gen/go/senim/identity/v1"
	"github.com/CemeteryPlaya/senim-platform/gen/go/senim/identity/v1/identityv1connect"
	"github.com/CemeteryPlaya/senim-platform/pkg/idem"
	"github.com/CemeteryPlaya/senim-platform/pkg/outbox"
	"github.com/CemeteryPlaya/senim-platform/pkg/pii"
	"github.com/CemeteryPlaya/senim-platform/services/identity/internal/store"
)

const (
	// Попыток указать ИИН (ответ «ИИН занят» говорит, что у человека с этим ИИН есть
	// аккаунт): не больше 5 в час на пользователя (limitIdentityAttempts в
	// apps/web/src/modules/identity/person-identity.ts). Считается, только если ИИН в
	// аккаунте ещё нет.
	personMaxAttempts   = 5
	personAttemptWindow = time.Hour
	// personIINConstraint — уникальный индекс persons.iin_hash (имя по умолчанию).
	personIINConstraint = "persons_iin_hash_key"
)

// personIINAAD — AAD шифртекста ИИН: привязка к таблице, полю и пользователю.
func personIINAAD(userID uuid.UUID) string { return "identity.persons.iin:" + userID.String() }

func personLimitKey(userID uuid.UUID) string { return "identity:iin:user:" + userID.String() }

func iinInvalid() error { return rpcError(connect.CodeInvalidArgument, "iin_invalid", nil) }

func iinTaken() error { return rpcError(connect.CodeAlreadyExists, "iin_taken", nil) }

func fullNameInvalid() error { return rpcError(connect.CodeInvalidArgument, "full_name_invalid", nil) }

func emailInvalid() error { return rpcError(connect.CodeInvalidArgument, "email_invalid", nil) }

// instagramInvalid — неверное имя Instagram; params.max — предел длины, если имя длиннее
// (в web — отдельный текст «не длиннее N»).
func instagramInvalid(tooLong bool) error {
	var params map[string]string
	if tooLong {
		params = map[string]string{"max": strconv.Itoa(instagramMax)}
	}
	return rpcError(connect.CodeInvalidArgument, "instagram_invalid", params)
}

func personAlreadyRecorded() error {
	return rpcError(connect.CodeFailedPrecondition, "person_already_recorded", nil)
}

// isUniqueViolation — ошибка Postgres 23505 на ограничении constraint.
func isUniqueViolation(err error, constraint string) bool {
	var pgErr *pgconn.PgError
	return errors.As(err, &pgErr) && pgErr.Code == "23505" && pgErr.ConstraintName == constraint
}

// text — необязательное поле: пустая строка — NULL.
func text(s string) pgtype.Text { return pgtype.Text{String: s, Valid: s != ""} }

// personProto — личность в ответах: ИИН только последними 4 символами.
func personProto(p store.Person) *identityv1.Person {
	return &identityv1.Person{
		UserId:    p.UserID.String(),
		FullName:  p.FullName.String,
		IinLast4:  p.IinLast4.String,
		Instagram: p.Instagram.String,
		Email:     p.Email.String,
	}
}

// personOf читает личность пользователя; строки нет — пустая личность с user_id.
func personOf(ctx context.Context, q *store.Queries, userID uuid.UUID) (store.Person, error) {
	p, err := q.GetPerson(ctx, userID)
	if errors.Is(err, pgx.ErrNoRows) {
		return store.Person{UserID: userID}, nil
	}
	return p, err
}

// recordAudit пишет в outbox событие аудита о пользователе (actor — он сам). before или
// after == nil — поля нет. Значений ПДн в before/after не кладут.
func recordAudit(ctx context.Context, tx pgx.Tx, user store.User, actorRole, action string, before, after any, now time.Time) error {
	return writeAudit(ctx, tx, userActor(user, actorRole), user.ID.String(), action, before, after, now)
}

// auditActor — кто действует: пользователь (kind "user", id, активная роль) или сервис
// (kind "service", id — имя вызывающего).
type auditActor struct {
	kind, id, role string
}

func userActor(user store.User, role string) auditActor {
	return auditActor{kind: "user", id: user.ID.String(), role: role}
}

// writeAudit пишет в outbox событие аудита о пользователе entityID. before или after ==
// nil — поля нет. Значений ПДн в before/after не кладут.
func writeAudit(ctx context.Context, tx pgx.Tx, actor auditActor, entityID, action string, before, after any, now time.Time) error {
	audit := &eventsv1.AuditEvent{
		ActorKind:  actor.kind,
		ActorId:    actor.id,
		ActorRole:  actor.role,
		Action:     action,
		EntityType: "user",
		EntityId:   entityID,
		At:         timestamppb.New(now),
	}
	if before != nil {
		b, err := json.Marshal(before)
		if err != nil {
			return err
		}
		audit.BeforeJson = string(b)
	}
	if after != nil {
		a, err := json.Marshal(after)
		if err != nil {
			return err
		}
		audit.AfterJson = string(a)
	}
	_, err := outbox.Add(ctx, tx, ServiceID, subjectAudit, "senim.events.v1.AuditEvent", audit)
	return err
}

// liveSession — чтение до ключа идемпотентности: сессия действует, пользователь не
// заблокирован. Ошибки — уже ответы клиенту.
func (s *Service) liveSession(ctx context.Context, op, token string) (store.Session, store.User, error) {
	q := store.New(s.pool)
	sess, ok, err := sessionByToken(ctx, q, token, false)
	if err != nil {
		s.log.ErrorContext(ctx, op+": поиск сессии", "err", err)
		return sess, store.User{}, internalError()
	}
	if !ok {
		return sess, store.User{}, sessionInvalid()
	}
	user, err := q.GetUserByID(ctx, sess.UserID)
	if err != nil {
		s.log.ErrorContext(ctx, op+": поиск пользователя", "err", err)
		return sess, user, internalError()
	}
	if !sessionUsable(sess, user, s.now()) {
		return sess, user, sessionInvalid()
	}
	return sess, user, nil
}

// lookup — повтор по ключу до лимитов (схема secondFactor): потерянный ответ
// возвращается как есть и попытку не тратит.
func (s *Service) lookup(ctx context.Context, op, method, key string, req, resp proto.Message) (bool, error) {
	found, err := idem.Lookup(ctx, s.pool, method, key, req, resp)
	if errors.Is(err, idem.ErrKeyReused) {
		return false, rpcError(connect.CodeInvalidArgument, "idempotency_key_reused", nil)
	}
	if err != nil {
		s.log.ErrorContext(ctx, op+": проверка ключа идемпотентности", "err", err)
		return false, connect.NewError(connect.CodeUnavailable, "unavailable")
	}
	return found, nil
}

// RecordPerson записывает ФИО и ИИН своего аккаунта (знакомство, сторона договора;
// recordOwnIdentity в apps/web). ИИН — только шифртекстом, со слепым индексом и
// последними 4 цифрами. Уже записанный ИИН не меняется: тот же ИИН ещё раз — тот же
// ответ, другой — person_already_recorded. Уже указанное ФИО не меняется — только
// дополняется ИИН. Один ИИН — один аккаунт: занятый — iin_taken (и при гонке: уникальный
// iin_hash, 23505). Перебор «ИИН занят» ограничен: 5 попыток в час —
// person_too_many_attempts.
//
// Порядок: формат запроса, сессия (чтение), повтор по ключу, личность (чтение), лимит
// попыток (вне транзакции — остаётся и при откате), затем транзакция: пользователь и
// сессия под блокировкой, личность заново, запись, аудит user.identity.recorded без
// значений.
func (s *Service) RecordPerson(ctx context.Context, req *identityv1.RecordPersonRequest) (*identityv1.RecordPersonResponse, error) {
	if err := requireCaller(ctx, webCaller); err != nil {
		return nil, err
	}
	const op, method = "record_person", identityv1connect.IdentityServiceRecordPersonProcedure
	if !validIdempotencyKey(req.GetIdempotencyKey()) {
		return nil, invalidRequest()
	}
	fullName := normalizeFullName(req.GetFullName())
	if !validFullName(fullName) {
		return nil, fullNameInvalid()
	}
	iin := req.GetIin()
	if !validIIN(iin) {
		return nil, iinInvalid()
	}
	_, user, err := s.liveSession(ctx, op, req.GetSessionToken())
	if err != nil {
		return nil, err
	}
	resp := &identityv1.RecordPersonResponse{}
	found, err := s.lookup(ctx, op, method, req.GetIdempotencyKey(), req, resp)
	if err != nil {
		return nil, err
	}
	if found {
		return resp, nil
	}

	hash := s.cfg.PIIIndex.Of(pii.DomainIIN, iin)
	current, err := personOf(ctx, store.New(s.pool), user.ID)
	if err != nil {
		s.log.ErrorContext(ctx, op+": поиск личности", "err", err)
		return nil, internalError()
	}
	if current.IinHash != nil {
		if !bytes.Equal(current.IinHash, hash) {
			return nil, personAlreadyRecorded()
		}
		return &identityv1.RecordPersonResponse{Person: personProto(current)}, nil
	}
	allowed, err := limiter{now: s.now}.hit(ctx, s.pool, personLimitKey(user.ID), personMaxAttempts, personAttemptWindow)
	if err != nil {
		s.log.ErrorContext(ctx, op+": счётчик попыток", "err", err)
		return nil, internalError()
	}
	if !allowed {
		return nil, rpcError(connect.CodeResourceExhausted, "person_too_many_attempts", nil)
	}

	err = s.idempotent(ctx, op, method, req.GetIdempotencyKey(), req, resp, func(tx pgx.Tx) error {
		now := s.now()
		sess, locked, err := lockedSession(ctx, tx, req.GetSessionToken(), now)
		if err != nil {
			return err
		}
		if locked.ID != user.ID {
			return sessionInvalid()
		}
		q := store.New(tx)
		p, err := personOf(ctx, q, user.ID)
		if err != nil {
			return err
		}
		if p.IinHash != nil {
			if !bytes.Equal(p.IinHash, hash) {
				return personAlreadyRecorded()
			}
			resp.Person = personProto(p)
			return nil
		}
		enc, err := s.cfg.PII.Seal([]byte(iin), personIINAAD(user.ID))
		if err != nil {
			return fmt.Errorf("шифрование ИИН: %w", err)
		}
		p, err = q.RecordPersonIIN(ctx, store.RecordPersonIINParams{
			UserID: user.ID, FullName: text(fullName), IinEnc: text(enc), IinHash: hash,
			IinLast4: text(pii.Last4(iin)), Now: ts(now),
		})
		if isUniqueViolation(err, personIINConstraint) {
			return iinTaken()
		}
		if err != nil {
			// ErrNoRows — ИИН записан между чтением и вставкой; под блокировкой строки
			// пользователя так не бывает.
			return fmt.Errorf("запись ИИН: %w", err)
		}
		role := activeRole(locked.Roles, locked.DefaultRole, &sess.ActiveRole)
		if err := recordAudit(ctx, tx, locked, role, "user.identity.recorded", nil, nil, now); err != nil {
			return err
		}
		resp.Person = personProto(p)
		return nil
	})
	if err != nil {
		return nil, err
	}
	return resp, nil
}

// contactSet — значение аудита контактов: только «указан / не указан».
type contactSet struct {
	Set bool `json:"set"`
}

// UpdateContacts сохраняет Instagram и e-mail своего профиля (updateContacts в
// contacts-profile.ts): контакты — у сторон сделки (заказчик, мастер), у остальных
// ролей — role_forbidden. Пустое поле — не указан. Аудит user.instagram_changed /
// user.email_changed — только «указан / не указан»; то же значение ещё раз журнал не
// пишет.
func (s *Service) UpdateContacts(ctx context.Context, req *identityv1.UpdateContactsRequest) (*identityv1.UpdateContactsResponse, error) {
	if err := requireCaller(ctx, webCaller); err != nil {
		return nil, err
	}
	if !validIdempotencyKey(req.GetIdempotencyKey()) {
		return nil, invalidRequest()
	}
	instagram, tooLong, ok := checkInstagram(req.GetInstagram())
	if !ok {
		return nil, instagramInvalid(tooLong)
	}
	email, ok := normalizeEmail(req.GetEmail())
	if !ok {
		return nil, emailInvalid()
	}
	resp := &identityv1.UpdateContactsResponse{}
	err := s.idempotent(ctx, "update_contacts", identityv1connect.IdentityServiceUpdateContactsProcedure, req.GetIdempotencyKey(), req, resp, func(tx pgx.Tx) error {
		now := s.now()
		sess, user, err := lockedSession(ctx, tx, req.GetSessionToken(), now)
		if err != nil {
			return err
		}
		role := activeRole(user.Roles, user.DefaultRole, &sess.ActiveRole)
		if role != "CLIENT" && role != "EXECUTOR" {
			return rpcError(connect.CodePermissionDenied, "role_forbidden", nil)
		}
		q := store.New(tx)
		before, err := personOf(ctx, q, user.ID)
		if err != nil {
			return err
		}
		after, err := q.UpsertContacts(ctx, store.UpsertContactsParams{UserID: user.ID, Instagram: text(instagram), Email: text(email), Now: ts(now)})
		if err != nil {
			return err
		}
		changes := []struct {
			before, after pgtype.Text
			action        string
		}{
			{before.Instagram, after.Instagram, "user.instagram_changed"},
			{before.Email, after.Email, "user.email_changed"},
		}
		for _, c := range changes {
			if c.before == c.after {
				continue
			}
			if err := recordAudit(ctx, tx, user, role, c.action, contactSet{c.before.Valid}, contactSet{c.after.Valid}, now); err != nil {
				return err
			}
		}
		resp.Person = personProto(after)
		return nil
	})
	if err != nil {
		return nil, err
	}
	return resp, nil
}

// GetProfile — чтение: личность своего аккаунта (ИИН — последними 4 символами) и сторона
// сделки, если она есть (реквизиты — последними 4 символами). Личности нет — пустая с
// user_id; стороны нет — party пуст.
func (s *Service) GetProfile(ctx context.Context, req *identityv1.GetProfileRequest) (*identityv1.GetProfileResponse, error) {
	if err := requireCaller(ctx, webCaller); err != nil {
		return nil, err
	}
	const op = "get_profile"
	_, user, err := s.liveSession(ctx, op, req.GetSessionToken())
	if err != nil {
		return nil, err
	}
	q := store.New(s.pool)
	p, err := personOf(ctx, q, user.ID)
	if err != nil {
		s.log.ErrorContext(ctx, op+": поиск личности", "err", err)
		return nil, internalError()
	}
	resp := &identityv1.GetProfileResponse{Person: personProto(p)}
	party, err := q.GetParty(ctx, user.ID)
	switch {
	case err == nil:
		resp.Party = partyProto(party)
	case !errors.Is(err, pgx.ErrNoRows):
		s.log.ErrorContext(ctx, op+": поиск стороны", "err", err)
		return nil, internalError()
	}
	return resp, nil
}
