package internal

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"errors"
	"slices"
	"strings"
	"sync"
	"testing"
	"time"

	"connectrpc.com/connect/v2"
	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgconn"
	"google.golang.org/protobuf/proto"

	eventsv1 "github.com/CemeteryPlaya/senim-platform/gen/go/senim/events/v1"
	identityv1 "github.com/CemeteryPlaya/senim-platform/gen/go/senim/identity/v1"
	"github.com/CemeteryPlaya/senim-platform/gen/go/senim/identity/v1/identityv1connect"
	"github.com/CemeteryPlaya/senim-platform/services/identity/internal/store"
)

const (
	kindPD   = identityv1.ConsentKind_CONSENT_KIND_PD_PROCESSING
	kindBank = identityv1.ConsentKind_CONSENT_KIND_BANK_TRANSFER
)

// textSum — hex SHA-256 текста согласия, как его считает web.
func textSum(s string) string {
	sum := sha256.Sum256([]byte(s))
	return hex.EncodeToString(sum[:])
}

var pdPurposes = []string{"account", "deal", "money", "dispute", "notifications", "law"}

func pdGrant(token, version string) *identityv1.GrantConsentRequest {
	return &identityv1.GrantConsentRequest{
		SessionToken: token, Kind: kindPD, Version: version, TextSha256: textSum("ПДн " + version),
		Purposes: pdPurposes,
	}
}

func bankGrant(token, dealID string) *identityv1.GrantConsentRequest {
	return &identityv1.GrantConsentRequest{
		SessionToken: token, Kind: kindBank, Version: "2026-11-01", TextSha256: textSum("банк-партнёр"),
		Purposes: []string{"escrow_account", "bank_kyc"}, ReferenceId: dealID,
	}
}

func (h *harness) grantConsent(req *identityv1.GrantConsentRequest, key string) (*identityv1.GrantConsentResponse, error) {
	h.t.Helper()
	req = proto.CloneOf(req)
	req.IdempotencyKey = key
	return idc(h, "web", func(ctx context.Context, c identityv1connect.IdentityServiceClient) (*identityv1.GrantConsentResponse, error) {
		return c.GrantConsent(ctx, req)
	})
}

func (h *harness) mustGrant(req *identityv1.GrantConsentRequest) *identityv1.Consent {
	h.t.Helper()
	res, err := h.grantConsent(req, h.key())
	if err != nil {
		h.t.Fatalf("GrantConsent: %v", err)
	}
	return res.GetConsent()
}

func (h *harness) revokeConsent(token string, kind identityv1.ConsentKind, key string) (*identityv1.RevokeConsentResponse, error) {
	h.t.Helper()
	return idc(h, "web", func(ctx context.Context, c identityv1connect.IdentityServiceClient) (*identityv1.RevokeConsentResponse, error) {
		return c.RevokeConsent(ctx, &identityv1.RevokeConsentRequest{SessionToken: token, Kind: kind, IdempotencyKey: key})
	})
}

func (h *harness) mustRevoke(token string) *identityv1.ConsentRevocation {
	h.t.Helper()
	res, err := h.revokeConsent(token, kindPD, h.key())
	if err != nil {
		h.t.Fatalf("RevokeConsent: %v", err)
	}
	return res.GetRevocation()
}

func (h *harness) myConsents(token string) (*identityv1.ListMyConsentsResponse, error) {
	h.t.Helper()
	return idc(h, "web", func(ctx context.Context, c identityv1connect.IdentityServiceClient) (*identityv1.ListMyConsentsResponse, error) {
		return c.ListMyConsents(ctx, &identityv1.ListMyConsentsRequest{SessionToken: token})
	})
}

func (h *harness) hasConsents(userIDs []string, kind identityv1.ConsentKind, ref string) (*identityv1.HasConsentsResponse, error) {
	h.t.Helper()
	return idc(h, "web", func(ctx context.Context, c identityv1connect.IdentityServiceClient) (*identityv1.HasConsentsResponse, error) {
		return c.HasConsents(ctx, &identityv1.HasConsentsRequest{UserIds: userIDs, Kind: kind, ReferenceId: ref})
	})
}

func (h *harness) revocationQueue(token string) (*identityv1.ListConsentRevocationsResponse, error) {
	h.t.Helper()
	return idc(h, "web", func(ctx context.Context, c identityv1connect.IdentityServiceClient) (*identityv1.ListConsentRevocationsResponse, error) {
		return c.ListConsentRevocations(ctx, &identityv1.ListConsentRevocationsRequest{SessionToken: token})
	})
}

func (h *harness) resolveRevocation(token, id string, completed bool, reason, key string) (*identityv1.ResolveConsentRevocationResponse, error) {
	h.t.Helper()
	return idc(h, "web", func(ctx context.Context, c identityv1connect.IdentityServiceClient) (*identityv1.ResolveConsentRevocationResponse, error) {
		return c.ResolveConsentRevocation(ctx, &identityv1.ResolveConsentRevocationRequest{
			SessionToken: token, RevocationId: id, Completed: completed, Reason: reason, IdempotencyKey: key,
		})
	})
}

// consentRows — все записи согласий пользователя (с отозванными), старые первыми.
func (h *harness) consentRows(userID uuid.UUID) []store.Consent {
	h.t.Helper()
	rows, err := h.q.ListUserConsents(context.Background(), userID)
	if err != nil {
		h.t.Fatal(err)
	}
	return rows
}

func (h *harness) revocationRow(id string) store.ConsentRevocation {
	h.t.Helper()
	r, err := h.q.GetRevocation(context.Background(), uuid.MustParse(id))
	if err != nil {
		h.t.Fatal(err)
	}
	return r
}

func eventsFor[T interface {
	proto.Message
	GetUserId() string
}](h *harness, subject, userID string, fresh func() T) []T {
	h.t.Helper()
	var out []T
	for _, e := range outboxEvents(h, subject, fresh) {
		if e.GetUserId() == userID {
			out = append(out, e)
		}
	}
	return out
}

func (h *harness) grantedEvents(userID string) []*eventsv1.ConsentGranted {
	return eventsFor(h, subjectConsentGranted, userID, func() *eventsv1.ConsentGranted { return &eventsv1.ConsentGranted{} })
}

func (h *harness) revocationRequestedEvents(userID string) []*eventsv1.ConsentRevocationRequested {
	return eventsFor(h, subjectConsentRevocationRequested, userID, func() *eventsv1.ConsentRevocationRequested { return &eventsv1.ConsentRevocationRequested{} })
}

func (h *harness) revocationResolvedEvents(userID string) []*eventsv1.ConsentRevocationResolved {
	return eventsFor(h, subjectConsentRevocationResolved, userID, func() *eventsv1.ConsentRevocationResolved { return &eventsv1.ConsentRevocationResolved{} })
}

// ownerConn — соединение ролью владельца базы (миграции): у него есть DELETE, поэтому
// запрет удаления проверяется триггером, а не только правами.
func ownerConn(t *testing.T) *pgx.Conn {
	t.Helper()
	conn, err := pgx.Connect(context.Background(), pgEnv.OwnerDSN("identity"))
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = conn.Close(context.Background()) })
	return conn
}

func pgCode(err error) (string, string) {
	var pgErr *pgconn.PgError
	if !errors.As(err, &pgErr) {
		return "", ""
	}
	return pgErr.Code, pgErr.Message
}

// wantImmutable — ошибка триггера неизменности записи согласия.
func wantImmutable(t *testing.T, err error, what string) {
	t.Helper()
	code, msg := pgCode(err)
	if code != "P0001" || !strings.Contains(msg, "consent_immutable") {
		t.Fatalf("%s: want ошибку триггера consent_immutable, got %v", what, err)
	}
}

func TestGrantConsentRecordsProof(t *testing.T) {
	h := newHarness(t, nil)
	u, token := h.client()
	req := pdGrant(token, "2026-11-01")
	c := h.mustGrant(req)

	if c.GetKind() != kindPD || c.GetVersion() != "2026-11-01" || c.GetTextSha256() != req.GetTextSha256() ||
		!slices.Equal(c.GetPurposes(), pdPurposes) || c.GetReferenceId() != "" || c.GetChannel() != "otp_session" ||
		c.GetRevokedAt() != nil || !c.GetGrantedAt().AsTime().Equal(h.clock.now()) {
		t.Fatalf("ответ: %v", c)
	}
	rows := h.consentRows(u.ID)
	if len(rows) != 1 {
		t.Fatalf("записей %d, want 1", len(rows))
	}
	r := rows[0]
	sum, _ := hex.DecodeString(req.GetTextSha256())
	if r.ID.String() != c.GetId() || r.Kind != "PD_PROCESSING" || r.Version != "2026-11-01" ||
		string(r.TextSha256) != string(sum) || !slices.Equal(r.Purposes, pdPurposes) || r.ReferenceID != "" ||
		r.Channel != "otp_session" || !r.SessionID.Valid || r.SessionID.UUID != h.sessionRow(token).ID ||
		!r.GrantedAt.Time.Equal(h.clock.now()) || r.RevokedAt.Valid {
		t.Fatalf("запись: %+v", r)
	}

	ev := h.grantedEvents(u.ID.String())
	if len(ev) != 1 || ev[0].GetKind() != kindPD || ev[0].GetVersion() != "2026-11-01" || ev[0].GetReferenceId() != "" {
		t.Fatalf("ConsentGranted: %v", ev)
	}
	audit := h.auditOf(u.ID.String(), "consent.granted")
	if len(audit) != 1 || audit[0].GetActorId() != u.ID.String() || !strings.Contains(audit[0].GetAfterJson(), "2026-11-01") {
		t.Fatalf("аудит: %v", audit)
	}

	// Передача банку — к сделке.
	deal := uuid.NewString()
	b := h.mustGrant(bankGrant(token, deal))
	if b.GetKind() != kindBank || b.GetReferenceId() != deal {
		t.Fatalf("банк: %v", b)
	}
	if ev := h.grantedEvents(u.ID.String()); len(ev) != 2 || ev[1].GetReferenceId() != deal {
		t.Fatalf("ConsentGranted банка: %v", ev)
	}

	// Проверки запроса.
	bad := []struct {
		name   string
		mutate func(r *identityv1.GrantConsentRequest)
		code   connect.Code
		reason string
	}{
		{"пустая версия", func(r *identityv1.GrantConsentRequest) { r.Version = "" }, connect.CodeInvalidArgument, "consent_version_invalid"},
		{"версия с пробелом", func(r *identityv1.GrantConsentRequest) { r.Version = "v 1" }, connect.CodeInvalidArgument, "consent_version_invalid"},
		{"версия длиннее 32", func(r *identityv1.GrantConsentRequest) { r.Version = strings.Repeat("1", 33) }, connect.CodeInvalidArgument, "consent_version_invalid"},
		{"хеш короче", func(r *identityv1.GrantConsentRequest) { r.TextSha256 = r.TextSha256[:62] }, connect.CodeInvalidArgument, "consent_version_invalid"},
		{"хеш не hex", func(r *identityv1.GrantConsentRequest) { r.TextSha256 = strings.Repeat("z", 64) }, connect.CodeInvalidArgument, "consent_version_invalid"},
		{"вид не указан", func(r *identityv1.GrantConsentRequest) { r.Kind = identityv1.ConsentKind_CONSENT_KIND_UNSPECIFIED }, connect.CodeInvalidArgument, "invalid_request"},
		{"ПДн к сделке", func(r *identityv1.GrantConsentRequest) { r.ReferenceId = deal }, connect.CodeInvalidArgument, "invalid_request"},
		{"банк без сделки", func(r *identityv1.GrantConsentRequest) { r.Kind = kindBank }, connect.CodeInvalidArgument, "invalid_request"},
		{"без целей", func(r *identityv1.GrantConsentRequest) { r.Purposes = nil }, connect.CodeInvalidArgument, "invalid_request"},
		{"пустая цель", func(r *identityv1.GrantConsentRequest) { r.Purposes = []string{"account", " "} }, connect.CodeInvalidArgument, "invalid_request"},
		{"чужая сессия", func(r *identityv1.GrantConsentRequest) { r.SessionToken = newToken(t) }, connect.CodeUnauthenticated, "session_invalid"},
	}
	for _, b := range bad {
		r := pdGrant(token, "2026-12-01")
		b.mutate(r)
		_, err := h.grantConsent(r, h.key())
		h.wantRefusal(err, b.code, b.reason)
	}
	_, err := h.grantConsent(pdGrant(token, "2026-12-01"), "")
	h.wantRefusal(err, connect.CodeInvalidArgument, "invalid_request")
	if n := len(h.consentRows(u.ID)); n != 2 {
		t.Fatalf("после отказов записей %d, want 2", n)
	}
}

func TestGrantConsentIdempotent(t *testing.T) {
	h := newHarness(t, nil)
	u, token := h.client()
	req := pdGrant(token, "2026-11-01")
	key := h.key()
	first, err := h.grantConsent(req, key)
	if err != nil {
		t.Fatal(err)
	}
	h.clock.advance(time.Minute)
	// Тот же ключ — тот же ответ.
	again, err := h.grantConsent(req, key)
	if err != nil || !proto.Equal(first, again) {
		t.Fatalf("повтор по ключу: %v, %v", again, err)
	}
	// Новый ключ, то же действующее согласие той же версии — тот же ответ, без новой записи.
	other, err := h.grantConsent(req, h.key())
	if err != nil || !proto.Equal(first, other) {
		t.Fatalf("повтор с новым ключом: %v, %v", other, err)
	}
	if n := len(h.consentRows(u.ID)); n != 1 {
		t.Fatalf("записей %d, want 1", n)
	}
	if n := len(h.grantedEvents(u.ID.String())); n != 1 {
		t.Fatalf("событий %d, want 1", n)
	}
	if n := len(h.auditOf(u.ID.String(), "consent.granted")); n != 1 {
		t.Fatalf("аудита %d, want 1", n)
	}
	// Тот же ключ с другим запросом — idempotency_key_reused.
	_, err = h.grantConsent(pdGrant(token, "2026-11-02"), key)
	h.wantRefusal(err, connect.CodeInvalidArgument, "idempotency_key_reused")
	// Та же версия, другой текст — версия не соответствует тексту.
	changed := pdGrant(token, "2026-11-01")
	changed.TextSha256 = textSum("другой текст")
	_, err = h.grantConsent(changed, h.key())
	h.wantRefusal(err, connect.CodeInvalidArgument, "consent_version_invalid")

	// Новая версия — новая запись; прежняя остаётся действующей.
	h.mustGrant(pdGrant(token, "2026-12-01"))
	if n := len(h.consentRows(u.ID)); n != 2 {
		t.Fatalf("записей %d, want 2", n)
	}

	// Параллельные согласия одной версии с разными ключами — одна запись.
	u2, token2 := h.client()
	var wg sync.WaitGroup
	errs := make([]error, 5)
	keys := make([]string, len(errs))
	for i := range keys {
		keys[i] = h.key() // h.key не для параллельных вызовов
	}
	for i := range errs {
		wg.Go(func() { _, errs[i] = h.grantConsent(pdGrant(token2, "2026-11-01"), keys[i]) })
	}
	wg.Wait()
	for _, err := range errs {
		if err != nil {
			t.Fatalf("параллельное согласие: %v", err)
		}
	}
	if n := len(h.consentRows(u2.ID)); n != 1 {
		t.Fatalf("параллельно: записей %d, want 1", n)
	}
}

func TestConsentRowImmutable(t *testing.T) {
	h := newHarness(t, nil)
	u, token := h.client()
	c := h.mustGrant(pdGrant(token, "2026-11-01"))
	ctx := context.Background()

	_, err := h.pool.Exec(ctx, `UPDATE consents SET version = 'подмена' WHERE id = $1`, c.GetId())
	wantImmutable(t, err, "UPDATE version")
	_, err = h.pool.Exec(ctx, `UPDATE consents SET text_sha256 = $2 WHERE id = $1`, c.GetId(), make([]byte, 32))
	wantImmutable(t, err, "UPDATE text_sha256")
	_, err = h.pool.Exec(ctx, `UPDATE consents SET granted_at = granted_at - interval '1 day' WHERE id = $1`, c.GetId())
	wantImmutable(t, err, "UPDATE granted_at")
	_, err = h.pool.Exec(ctx, `UPDATE consents SET revoked_at = granted_at, version = 'x' WHERE id = $1`, c.GetId())
	wantImmutable(t, err, "отзыв вместе с правкой")

	// Рабочая роль удалять не может вовсе.
	_, err = h.pool.Exec(ctx, `DELETE FROM consents WHERE id = $1`, c.GetId())
	if code, _ := pgCode(err); code != "42501" {
		t.Fatalf("DELETE рабочей ролью: %v, want 42501", err)
	}
	// Владелец базы — тоже: удаление запрещено триггером.
	owner := ownerConn(t)
	_, err = owner.Exec(ctx, `DELETE FROM consents WHERE id = $1`, c.GetId())
	wantImmutable(t, err, "DELETE владельцем")
	_, err = owner.Exec(ctx, `UPDATE consents SET purposes = '{}' WHERE id = $1`, c.GetId())
	wantImmutable(t, err, "UPDATE владельцем")

	// Разрешено одно: отметить отзыв, один раз.
	if _, err := h.pool.Exec(ctx, `UPDATE consents SET revoked_at = granted_at WHERE id = $1`, c.GetId()); err != nil {
		t.Fatalf("отметка отзыва: %v", err)
	}
	_, err = h.pool.Exec(ctx, `UPDATE consents SET revoked_at = granted_at + interval '1 hour' WHERE id = $1`, c.GetId())
	wantImmutable(t, err, "повторная отметка отзыва")
	_, err = h.pool.Exec(ctx, `UPDATE consents SET revoked_at = NULL WHERE id = $1`, c.GetId())
	wantImmutable(t, err, "снятие отзыва")
	rows := h.consentRows(u.ID)
	if len(rows) != 1 || rows[0].Version != "2026-11-01" || !rows[0].RevokedAt.Valid {
		t.Fatalf("запись: %+v", rows)
	}
}

func TestRevokeCreatesRequestWithDueDate(t *testing.T) {
	h := newHarness(t, nil)
	// Пятница 23:30 по Алматы: срок — 15 рабочих дней от неё.
	h.clock.t = time.Date(2026, 11, 13, 23, 30, 0, 0, almaty)
	u, token := h.client()
	h.mustGrant(pdGrant(token, "2026-10-01"))
	h.mustGrant(pdGrant(token, "2026-11-01"))
	h.mustGrant(bankGrant(token, uuid.NewString()))
	h.clock.advance(time.Minute)
	now := h.clock.now()

	// Без ключа — отказ.
	_, err := h.revokeConsent(token, kindPD, "")
	h.wantRefusal(err, connect.CodeInvalidArgument, "invalid_request")
	_, err = h.revokeConsent(token, identityv1.ConsentKind_CONSENT_KIND_UNSPECIFIED, h.key())
	h.wantRefusal(err, connect.CodeInvalidArgument, "invalid_request")

	key := h.key()
	res, err := h.revokeConsent(token, kindPD, key)
	if err != nil {
		t.Fatal(err)
	}
	rev := res.GetRevocation()
	wantDue := time.Date(2026, 12, 4, 23, 31, 0, 0, almaty) // пятница + 15 рабочих дней — третья пятница
	if rev.GetStatus() != identityv1.RevocationStatus_REVOCATION_STATUS_REQUESTED || rev.GetUserId() != u.ID.String() ||
		rev.GetKind() != kindPD || !rev.GetRequestedAt().AsTime().Equal(now) || !rev.GetDueAt().AsTime().Equal(wantDue) ||
		rev.GetDecidedAt() != nil || rev.GetReason() != "" {
		t.Fatalf("заявка: %v (срок %s)", rev, rev.GetDueAt().AsTime().In(almaty))
	}
	row := h.revocationRow(rev.GetId())
	if row.Status != "REQUESTED" || !row.DueAt.Time.Equal(wantDue) || row.DecidedBy.Valid {
		t.Fatalf("строка заявки: %+v", row)
	}

	// Все действующие ПДн отозваны; передача банку не тронута.
	for _, c := range h.consentRows(u.ID) {
		switch c.Kind {
		case "PD_PROCESSING":
			if !c.RevokedAt.Valid || !c.RevokedAt.Time.Equal(now) {
				t.Fatalf("ПДн не отозвано: %+v", c)
			}
		case "BANK_TRANSFER":
			if c.RevokedAt.Valid {
				t.Fatalf("банк отозван: %+v", c)
			}
		}
	}
	ev := h.revocationRequestedEvents(u.ID.String())
	if len(ev) != 1 || ev[0].GetRevocationId() != rev.GetId() || ev[0].GetKind() != kindPD || !ev[0].GetDueAt().AsTime().Equal(wantDue) {
		t.Fatalf("ConsentRevocationRequested: %v", ev)
	}
	if n := len(h.auditOf(u.ID.String(), "consent.revocation_requested")); n != 1 {
		t.Fatalf("аудит %d, want 1", n)
	}

	// Повтор по ключу — тот же ответ; без действующего согласия — consent_missing.
	again, err := h.revokeConsent(token, kindPD, key)
	if err != nil || !proto.Equal(res, again) {
		t.Fatalf("повтор: %v, %v", again, err)
	}
	_, err = h.revokeConsent(token, kindPD, h.key())
	h.wantRefusal(err, connect.CodeFailedPrecondition, "consent_missing")

	// Согласие дано снова и снова отозвано, пока прежняя заявка открыта: заявка та же.
	h.mustGrant(pdGrant(token, "2026-11-01"))
	second := h.mustRevoke(token)
	if second.GetId() != rev.GetId() {
		t.Fatalf("вторая заявка %s, want прежнюю %s", second.GetId(), rev.GetId())
	}
	if n := h.count(`SELECT count(*) FROM consent_revocations WHERE user_id = $1`, u.ID); n != 1 {
		t.Fatalf("заявок %d, want 1", n)
	}
	if n := h.count(`SELECT count(*) FROM consents WHERE user_id = $1 AND kind = 'PD_PROCESSING' AND revoked_at IS NULL`, u.ID); n != 0 {
		t.Fatalf("действующих ПДн %d, want 0", n)
	}

	// ListMyConsents — все записи с отозванными и заявки.
	mine, err := h.myConsents(token)
	if err != nil {
		t.Fatal(err)
	}
	if len(mine.GetConsents()) != 4 || len(mine.GetRevocations()) != 1 || mine.GetRevocations()[0].GetId() != rev.GetId() {
		t.Fatalf("ListMyConsents: %v", mine)
	}
	_, err = h.myConsents(newToken(t))
	h.wantRefusal(err, connect.CodeUnauthenticated, "session_invalid")
}

func TestRevokeBankTransfer(t *testing.T) {
	h := newHarness(t, nil)
	u, token := h.client()
	h.mustGrant(bankGrant(token, uuid.NewString()))
	_, err := h.revokeConsent(token, kindBank, h.key())
	h.wantRefusal(err, connect.CodeFailedPrecondition, "consent_not_revocable")
	if n := h.count(`SELECT count(*) FROM consents WHERE user_id = $1 AND revoked_at IS NULL`, u.ID); n != 1 {
		t.Fatalf("действующих %d, want 1", n)
	}
	if n := h.count(`SELECT count(*) FROM consent_revocations WHERE user_id = $1`, u.ID); n != 0 {
		t.Fatalf("заявок %d, want 0", n)
	}
	// Отзывать нечего — consent_missing.
	_, err = h.revokeConsent(token, kindPD, h.key())
	h.wantRefusal(err, connect.CodeFailedPrecondition, "consent_missing")
}

// expectedRevocation — разрешённые переходы заявки на отзыв, записанные руками.
var expectedRevocation = map[[2]string]string{
	{revocationActionComplete, revocationRequested}: revocationCompleted,
	{revocationActionRefuse, revocationRequested}:   revocationRefused,
}

func TestRevocationTransitionTable(t *testing.T) {
	got := map[[2]string]string{}
	for _, tr := range revocationTransitions {
		for _, from := range tr.from {
			got[[2]string{tr.action, from}] = tr.to
		}
		if tr.by != mfaRole {
			t.Fatalf("переход %s: решает %s, want оператор", tr.action, tr.by)
		}
	}
	if len(got) != len(expectedRevocation) {
		t.Fatalf("переходов %d, want %d: %v", len(got), len(expectedRevocation), got)
	}
	for k, to := range expectedRevocation {
		if got[k] != to {
			t.Fatalf("переход %v: %q, want %q", k, got[k], to)
		}
	}
	if !revocationRule(revocationActionRefuse).needsReason || revocationRule(revocationActionComplete).needsReason {
		t.Fatal("причина нужна только при отказе")
	}
}

// setRevocation выставляет состояние заявки напрямую в базе (решённая — с датой и автором).
func (h *harness) setRevocation(id, status string, decidedBy uuid.UUID) {
	h.t.Helper()
	var err error
	switch status {
	case revocationRequested:
		_, err = h.pool.Exec(context.Background(),
			`UPDATE consent_revocations SET status = $2, decided_at = NULL, decided_by = NULL, reason = NULL WHERE id = $1`, id, status)
	default:
		reason := pgxText(status == revocationRefused, "Неисполненная сделка")
		_, err = h.pool.Exec(context.Background(),
			`UPDATE consent_revocations SET status = $2, decided_at = requested_at, decided_by = $3, reason = $4 WHERE id = $1`,
			id, status, decidedBy, reason)
	}
	if err != nil {
		h.t.Fatal(err)
	}
}

func pgxText(valid bool, s string) any {
	if !valid {
		return nil
	}
	return s
}

// TestRevocationTransitions — каждое решение из каждого статуса на реальной базе.
func TestRevocationTransitions(t *testing.T) {
	h := newHarness(t, nil)
	op, opToken := h.mfaOperator()
	_, token := h.client()
	h.mustGrant(pdGrant(token, "2026-11-01"))
	rev := h.mustRevoke(token)
	for _, action := range []string{revocationActionComplete, revocationActionRefuse} {
		for _, status := range []string{revocationRequested, revocationCompleted, revocationRefused} {
			name := action + "/" + status
			h.setRevocation(rev.GetId(), status, op.ID)
			_, err := h.resolveRevocation(opToken, rev.GetId(), action == revocationActionComplete, "Неисполненная сделка", h.key())
			after := h.revocationRow(rev.GetId())
			to, allowed := expectedRevocation[[2]string{action, status}]
			if !allowed {
				h.wantRefusal(err, connect.CodeFailedPrecondition, "revocation_closed")
				if after.Status != status {
					t.Fatalf("%s: статус %s", name, after.Status)
				}
				continue
			}
			if err != nil {
				t.Fatalf("%s: %v", name, err)
			}
			if after.Status != to || !after.DecidedAt.Valid || after.DecidedBy.UUID != op.ID {
				t.Fatalf("%s: %+v", name, after)
			}
			if wantReason := to == revocationRefused; after.Reason.Valid != wantReason {
				t.Fatalf("%s: причина %+v", name, after.Reason)
			}
		}
	}
}

func TestResolveRevocation(t *testing.T) {
	h := newHarness(t, nil)
	op, opToken := h.mfaOperator()
	_, noMfaToken := h.operator()
	u, token := h.client()
	h.mustGrant(pdGrant(token, "2026-11-01"))
	rev := h.mustRevoke(token)

	// Очередь: только оператор со вторым фактором.
	_, err := h.revocationQueue(noMfaToken)
	h.wantRefusal(err, connect.CodePermissionDenied, "mfa_required")
	_, err = h.revocationQueue(token)
	h.wantRefusal(err, connect.CodePermissionDenied, "role_forbidden")
	h.mustRecordPerson(token, "Иванов Иван Иванович", freshIIN(t))
	queue, err := h.revocationQueue(opToken)
	if err != nil {
		t.Fatal(err)
	}
	idx := slices.IndexFunc(queue.GetRevocations(), func(r *identityv1.ConsentRevocation) bool { return r.GetId() == rev.GetId() })
	if idx < 0 || len(queue.GetPeople()) != len(queue.GetRevocations()) || queue.GetPeople()[idx].GetFullName() != "Иванов Иван Иванович" ||
		queue.GetPeople()[idx].GetUserId() != u.ID.String() {
		t.Fatalf("очередь: %v", queue)
	}
	for i := 1; i < len(queue.GetRevocations()); i++ {
		if queue.GetRevocations()[i].GetDueAt().AsTime().Before(queue.GetRevocations()[i-1].GetDueAt().AsTime()) {
			t.Fatal("очередь не по сроку")
		}
	}

	// Проверки: сессия без второго фактора, не оператор, причина отказа, кривой id.
	_, err = h.resolveRevocation(noMfaToken, rev.GetId(), true, "", h.key())
	h.wantRefusal(err, connect.CodePermissionDenied, "mfa_required")
	_, err = h.resolveRevocation(token, rev.GetId(), true, "", h.key())
	h.wantRefusal(err, connect.CodePermissionDenied, "role_forbidden")
	for _, reason := range []string{"", "  a ", strings.Repeat("я", 501)} {
		_, err = h.resolveRevocation(opToken, rev.GetId(), false, reason, h.key())
		h.wantRefusal(err, connect.CodeInvalidArgument, "invalid_request")
	}
	_, err = h.resolveRevocation(opToken, "не-uuid", true, "", h.key())
	h.wantRefusal(err, connect.CodeInvalidArgument, "invalid_request")
	_, err = h.resolveRevocation(opToken, uuid.NewString(), true, "", h.key())
	h.wantRefusal(err, connect.CodeFailedPrecondition, "revocation_closed")
	_, err = h.resolveRevocation(opToken, rev.GetId(), true, "", "")
	h.wantRefusal(err, connect.CodeInvalidArgument, "invalid_request")

	// Отказ с причиной: событие, аудит от оператора.
	h.clock.advance(time.Minute)
	key := h.key()
	res, err := h.resolveRevocation(opToken, rev.GetId(), false, "  Есть неисполненная сделка  ", key)
	if err != nil {
		t.Fatal(err)
	}
	got := res.GetRevocation()
	if got.GetStatus() != identityv1.RevocationStatus_REVOCATION_STATUS_REFUSED || got.GetReason() != "Есть неисполненная сделка" ||
		!got.GetDecidedAt().AsTime().Equal(h.clock.now()) {
		t.Fatalf("решение: %v", got)
	}
	again, err := h.resolveRevocation(opToken, rev.GetId(), false, "  Есть неисполненная сделка  ", key)
	if err != nil || !proto.Equal(res, again) {
		t.Fatalf("повтор: %v, %v", again, err)
	}
	ev := h.revocationResolvedEvents(u.ID.String())
	if len(ev) != 1 || ev[0].GetRevocationId() != rev.GetId() || ev[0].GetStatus() != identityv1.RevocationStatus_REVOCATION_STATUS_REFUSED {
		t.Fatalf("ConsentRevocationResolved: %v", ev)
	}
	audit := h.auditOf(u.ID.String(), "consent.revocation_refused")
	if len(audit) != 1 || audit[0].GetActorId() != op.ID.String() || audit[0].GetActorRole() != mfaRole {
		t.Fatalf("аудит: %v", audit)
	}
	// Закрытая заявка в очереди не видна.
	queue, err = h.revocationQueue(opToken)
	if err != nil {
		t.Fatal(err)
	}
	if slices.ContainsFunc(queue.GetRevocations(), func(r *identityv1.ConsentRevocation) bool { return r.GetId() == rev.GetId() }) {
		t.Fatal("закрытая заявка в очереди")
	}
	mine, err := h.myConsents(token)
	if err != nil || len(mine.GetRevocations()) != 1 || mine.GetRevocations()[0].GetReason() != "Есть неисполненная сделка" {
		t.Fatalf("ListMyConsents: %v, %v", mine, err)
	}
}

func TestResolveRevocationConcurrent(t *testing.T) {
	h := newHarness(t, nil)
	_, op1 := h.mfaOperator()
	_, op2 := h.mfaOperator()
	u, token := h.client()
	h.mustGrant(pdGrant(token, "2026-11-01"))
	rev := h.mustRevoke(token)

	const n = 6
	var wg sync.WaitGroup
	errs := make([]error, n)
	keys := make([]string, n)
	for i := range keys {
		keys[i] = h.key() // h.key не для параллельных вызовов
	}
	for i := range n {
		wg.Go(func() {
			tok := op1
			if i%2 == 1 {
				tok = op2
			}
			_, errs[i] = h.resolveRevocation(tok, rev.GetId(), i%3 != 0, "Неисполненная сделка", keys[i])
		})
	}
	wg.Wait()
	ok := 0
	for _, err := range errs {
		if err == nil {
			ok++
			continue
		}
		h.wantRefusal(err, connect.CodeFailedPrecondition, "revocation_closed")
	}
	if ok != 1 {
		t.Fatalf("успешных решений %d, want 1: %v", ok, errs)
	}
	if n := len(h.revocationResolvedEvents(u.ID.String())); n != 1 {
		t.Fatalf("событий %d, want 1", n)
	}
	if st := h.revocationRow(rev.GetId()).Status; st == revocationRequested {
		t.Fatal("заявка не закрыта")
	}
}

func TestHasConsentsPerDeal(t *testing.T) {
	h := newHarness(t, nil)
	clientU, clientToken := h.client()
	execU, execToken := h.executor()
	other, _ := h.client()
	dealA, dealB := uuid.NewString(), uuid.NewString()
	h.mustGrant(bankGrant(clientToken, dealA))
	h.mustGrant(bankGrant(execToken, dealB))
	h.mustGrant(pdGrant(clientToken, "2026-11-01"))

	ids := []string{clientU.ID.String(), execU.ID.String(), other.ID.String(), clientU.ID.String()}
	check := func(kind identityv1.ConsentKind, ref string, want ...string) {
		t.Helper()
		res, err := h.hasConsents(ids, kind, ref)
		if err != nil {
			t.Fatal(err)
		}
		if !slices.Equal(res.GetGrantedUserIds(), want) {
			t.Fatalf("%s/%s: %v, want %v", kind, ref, res.GetGrantedUserIds(), want)
		}
	}
	check(kindBank, dealA, clientU.ID.String())
	check(kindBank, dealB, execU.ID.String())
	check(kindBank, uuid.NewString())
	check(kindPD, "", clientU.ID.String())

	// Отозванное ПДн не действует.
	h.mustRevoke(clientToken)
	check(kindPD, "")

	for _, bad := range []struct {
		ids  []string
		kind identityv1.ConsentKind
		ref  string
	}{
		{[]string{"не-uuid"}, kindBank, dealA},
		{ids, identityv1.ConsentKind_CONSENT_KIND_UNSPECIFIED, dealA},
		{ids, kindBank, ""},
		{ids, kindPD, dealA},
		{nil, kindBank, dealA},
	} {
		_, err := h.hasConsents(bad.ids, bad.kind, bad.ref)
		h.wantRefusal(err, connect.CodeInvalidArgument, "invalid_request")
	}
}

func TestAuthenticateReturnsActiveConsents(t *testing.T) {
	h := newHarness(t, nil)
	_, token := h.client()
	if c := h.mustAuth(token).GetConsents(); len(c) != 0 {
		t.Fatalf("согласий %d, want 0", len(c))
	}
	deal := uuid.NewString()
	pd := h.mustGrant(pdGrant(token, "2026-11-01"))
	h.clock.advance(time.Second) // порядок — по времени согласия
	bank := h.mustGrant(bankGrant(token, deal))
	got := h.mustAuth(token).GetConsents()
	if len(got) != 2 || !proto.Equal(got[0], pd) || !proto.Equal(got[1], bank) {
		t.Fatalf("согласия: %v", got)
	}
	h.mustRevoke(token)
	got = h.mustAuth(token).GetConsents()
	if len(got) != 1 || !proto.Equal(got[0], bank) {
		t.Fatalf("после отзыва: %v", got)
	}
}

func TestSeedUsersConsent(t *testing.T) {
	h := newHarness(t, nil)
	phone := newPhone()
	sum := textSum("ПДн 2026-11-01")
	withConsent := func() *identityv1.SeedUser {
		u := seedUser(phone, roleClient, true, roleClient)
		u.ConsentVersion, u.ConsentTextSha256 = "2026-11-01", sum
		return u
	}
	res, err := h.seed(withConsent())
	if err != nil {
		t.Fatal(err)
	}
	id := uuid.MustParse(res.GetUsers()[0].GetId())
	rows := h.consentRows(id)
	if len(rows) != 1 || rows[0].Kind != "PD_PROCESSING" || rows[0].Version != "2026-11-01" || hex.EncodeToString(rows[0].TextSha256) != sum ||
		rows[0].Channel != "seed" || rows[0].SessionID.Valid || rows[0].RevokedAt.Valid {
		t.Fatalf("согласие сида: %+v", rows)
	}
	// Повтор сида — без второй записи.
	if _, err := h.seed(withConsent()); err != nil {
		t.Fatal(err)
	}
	if n := len(h.consentRows(id)); n != 1 {
		t.Fatalf("после повтора записей %d, want 1", n)
	}
	// Демо-персона входит с действующим согласием.
	demo := &identityv1.StartDemoSessionRequest{UserId: id.String()}
	if _, err := h.startDemo(demo); err != nil {
		t.Fatal(err)
	}
	if got := h.mustAuth(demo.GetSessionToken()).GetConsents(); len(got) != 1 || got[0].GetChannel() != "seed" || got[0].GetKind() != kindPD {
		t.Fatalf("согласия демо-персоны: %v", got)
	}
	// Без согласия — записи нет.
	plain, err := h.seed(seedUser(newPhone(), roleClient, true, roleClient))
	if err != nil {
		t.Fatal(err)
	}
	if n := len(h.consentRows(uuid.MustParse(plain.GetUsers()[0].GetId()))); n != 0 {
		t.Fatalf("без согласия записей %d", n)
	}

	for _, bad := range []struct {
		version, sum, reason string
	}{
		{"2026-11-01", "", "invalid_request"},
		{"", sum, "invalid_request"},
		{"v 1", sum, "consent_version_invalid"},
		{"2026-11-01", "abc", "consent_version_invalid"},
	} {
		u := seedUser(newPhone(), roleClient, true, roleClient)
		u.ConsentVersion, u.ConsentTextSha256 = bad.version, bad.sum
		_, err := h.seed(u)
		h.wantRefusal(err, connect.CodeInvalidArgument, bad.reason)
	}
}
