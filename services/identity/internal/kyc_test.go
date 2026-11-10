package internal

import (
	"context"
	"strings"
	"sync"
	"testing"
	"time"

	"connectrpc.com/connect/v2"
	"github.com/google/uuid"
	"google.golang.org/protobuf/encoding/prototext"

	eventsv1 "github.com/CemeteryPlaya/senim-platform/gen/go/senim/events/v1"
	identityv1 "github.com/CemeteryPlaya/senim-platform/gen/go/senim/identity/v1"
	"github.com/CemeteryPlaya/senim-platform/gen/go/senim/identity/v1/identityv1connect"
	"github.com/CemeteryPlaya/senim-platform/services/identity/internal/store"
)

func fileIDs(n int) []string {
	out := make([]string, n)
	for i := range out {
		out[i] = uuid.NewString()
	}
	return out
}

func (h *harness) submitKyc(token string, idFiles, regFiles []string, key string) (*identityv1.SubmitKycResponse, error) {
	h.t.Helper()
	return idc(h, "web", func(ctx context.Context, c identityv1connect.IdentityServiceClient) (*identityv1.SubmitKycResponse, error) {
		return c.SubmitKyc(ctx, &identityv1.SubmitKycRequest{SessionToken: token, IdFileIds: idFiles, RegistrationFileIds: regFiles, IdempotencyKey: key})
	})
}

func (h *harness) reviewKyc(token, userID string, verify bool, reason, key string) (*identityv1.ReviewKycResponse, error) {
	h.t.Helper()
	return idc(h, "web", func(ctx context.Context, c identityv1connect.IdentityServiceClient) (*identityv1.ReviewKycResponse, error) {
		return c.ReviewKyc(ctx, &identityv1.ReviewKycRequest{SessionToken: token, UserId: userID, Verify: verify, Reason: reason, IdempotencyKey: key})
	})
}

func (h *harness) kycQueue(token string) (*identityv1.ListKycQueueResponse, error) {
	h.t.Helper()
	return idc(h, "web", func(ctx context.Context, c identityv1connect.IdentityServiceClient) (*identityv1.ListKycQueueResponse, error) {
		return c.ListKycQueue(ctx, &identityv1.ListKycQueueRequest{SessionToken: token})
	})
}

// setKyc выставляет состояние проверки напрямую в базе: статус, файлы (оба вида или никаких)
// и время подачи.
func (h *harness) setKyc(userID uuid.UUID, status string, docs bool, submittedAt time.Time) {
	h.t.Helper()
	idFiles, regFiles := []string{}, []string{}
	if docs {
		idFiles, regFiles = fileIDs(1), fileIDs(1)
	}
	_, err := h.pool.Exec(context.Background(),
		`UPDATE parties SET kyc_status = $2, kyc_reject_reason = NULL, kyc_reviewed_at = NULL,
		        kyc_submitted_at = $3, kyc_id_file_ids = $4, kyc_registration_file_ids = $5
		 WHERE user_id = $1`, userID, status, submittedAt, idFiles, regFiles)
	if err != nil {
		h.t.Fatal(err)
	}
}

func (h *harness) kycStatus(userID uuid.UUID) store.Party {
	h.t.Helper()
	p, ok := h.partyRow(userID)
	if !ok {
		h.t.Fatalf("нет стороны %s", userID)
	}
	return p
}

func (h *harness) kycEvents(userID string) []*eventsv1.KycReviewed {
	h.t.Helper()
	var out []*eventsv1.KycReviewed
	for _, e := range outboxEvents(h, subjectKycReviewed, func() *eventsv1.KycReviewed { return &eventsv1.KycReviewed{} }) {
		if e.GetUserId() == userID {
			out = append(out, e)
		}
	}
	return out
}

// expectedKyc — разрешённые переходы, записанные руками: действие и исходный статус дают
// целевой. Всё остальное запрещено.
var expectedKyc = map[[2]string]string{
	{kycActionSubmit, kycNotSubmitted}: kycPending,
	{kycActionSubmit, kycPending}:      kycPending,
	{kycActionSubmit, kycRejected}:     kycPending,
	{kycActionVerify, kycPending}:      kycVerified,
	{kycActionReject, kycPending}:      kycRejected,
}

// TestKycTransitionTable — таблица в коде совпадает с записанной руками: ни лишних, ни
// недостающих переходов.
func TestKycTransitionTable(t *testing.T) {
	got := map[[2]string]string{}
	for _, tr := range kycTransitions {
		for _, from := range tr.from {
			got[[2]string{tr.action, from}] = tr.to
		}
	}
	if len(got) != len(expectedKyc) {
		t.Fatalf("переходов %d, want %d: %v", len(got), len(expectedKyc), got)
	}
	for k, to := range expectedKyc {
		if got[k] != to {
			t.Fatalf("переход %v: %q, want %q", k, got[k], to)
		}
	}
	if !kycRule(kycActionReject).needsReason || kycRule(kycActionVerify).needsReason || kycRule(kycActionSubmit).needsReason {
		t.Fatal("причина нужна только при отказе")
	}
}

// TestKycTransitions — каждое действие из каждого статуса под каждой ролью на реальной
// базе: разрешённый переход меняет статус, запрещённый — отказ без изменений.
func TestKycTransitions(t *testing.T) {
	h := newHarness(t, nil)
	exec, execToken, _, _ := h.tooParty()
	_, opToken := h.mfaOperator()
	_, clientToken := h.client()
	statuses := []string{kycNotSubmitted, kycPending, kycVerified, kycRejected}
	roles := []struct {
		name  string
		token string
	}{{executorRole, execToken}, {mfaRole, opToken}, {"CLIENT", clientToken}}

	for _, action := range []string{kycActionSubmit, kycActionVerify, kycActionReject} {
		for _, status := range statuses {
			for _, role := range roles {
				name := action + "/" + status + "/" + role.name
				h.setKyc(exec.ID, status, true, h.clock.now())
				before := h.kycStatus(exec.ID)
				var err error
				var after store.Party
				switch action {
				case kycActionSubmit:
					_, err = h.submitKyc(role.token, fileIDs(2), fileIDs(1), h.key())
				case kycActionVerify:
					_, err = h.reviewKyc(role.token, exec.ID.String(), true, "", h.key())
				case kycActionReject:
					_, err = h.reviewKyc(role.token, exec.ID.String(), false, "Фото нечитаемо", h.key())
				}
				after = h.kycStatus(exec.ID)
				to, allowed := expectedKyc[[2]string{action, status}]
				switch {
				case role.name != kycRule(action).by:
					h.wantRefusal(err, connect.CodePermissionDenied, "role_forbidden")
					if after.KycStatus != status {
						t.Fatalf("%s: статус изменился на %s", name, after.KycStatus)
					}
				case !allowed:
					h.wantRefusal(err, connect.CodeFailedPrecondition, "kyc_transition_forbidden")
					if after.KycStatus != status || after.KycSubmittedAt != before.KycSubmittedAt || after.KycReviewedAt != before.KycReviewedAt {
						t.Fatalf("%s: строка изменилась: %+v -> %+v", name, before, after)
					}
				default:
					if err != nil {
						t.Fatalf("%s: %v", name, err)
					}
					if after.KycStatus != to {
						t.Fatalf("%s: статус %s, want %s", name, after.KycStatus, to)
					}
					switch action {
					case kycActionSubmit:
						if !after.KycSubmittedAt.Valid || len(after.KycIDFileIds) != 2 || len(after.KycRegistrationFileIds) != 1 || after.KycRejectReason.Valid {
							t.Fatalf("%s: подача записана неверно: %+v", name, after)
						}
					case kycActionVerify:
						if !after.KycReviewedAt.Valid || after.KycRejectReason.Valid {
							t.Fatalf("%s: %+v", name, after)
						}
					case kycActionReject:
						if !after.KycReviewedAt.Valid || after.KycRejectReason.String != "Фото нечитаемо" {
							t.Fatalf("%s: %+v", name, after)
						}
					}
				}
			}
		}
	}
}

func TestSubmitKycWritesAuditAndReplays(t *testing.T) {
	h := newHarness(t, nil)
	exec, token, bin, _ := h.tooParty()
	idFiles, regFiles := fileIDs(2), fileIDs(1)
	// Повторы и верхний регистр: файлы без повторов, идентификаторы канонические.
	upper := strings.ToUpper(idFiles[0])
	key := h.key()
	first, err := h.submitKyc(token, append([]string{upper}, idFiles...), regFiles, key)
	if err != nil {
		t.Fatalf("SubmitKyc: %v", err)
	}
	p := first.GetParty()
	if p.GetKycStatus() != identityv1.KycStatus_KYC_STATUS_PENDING || len(p.GetKycIdFileIds()) != 2 || p.GetKycIdFileIds()[0] != idFiles[0] ||
		len(p.GetKycRegistrationFileIds()) != 1 || p.GetBinIinLast4() != bin[8:] || p.GetKycSubmittedAt() == nil {
		t.Fatalf("party = %v", p)
	}
	second, err := h.submitKyc(token, append([]string{upper}, idFiles...), regFiles, key)
	if err != nil || prototext.Format(first) != prototext.Format(second) {
		t.Fatalf("повтор по ключу: %v, %v", second, err)
	}
	events := h.auditOf(exec.ID.String(), "executor.kyc_submitted")
	if len(events) != 1 || events[0].GetActorId() != exec.ID.String() || events[0].GetActorRole() != executorRole ||
		!strings.Contains(events[0].GetBeforeJson(), kycNotSubmitted) || !strings.Contains(events[0].GetAfterJson(), kycPending) {
		t.Fatalf("аудит: %v", events)
	}
	// Тот же ключ с другими файлами — idempotency_key_reused.
	_, err = h.submitKyc(token, fileIDs(1), regFiles, key)
	h.wantRefusal(err, connect.CodeInvalidArgument, "idempotency_key_reused")
	// Новая подача при PENDING заменяет файлы и пишет второй аудит.
	if _, err := h.submitKyc(token, fileIDs(1), fileIDs(1), h.key()); err != nil {
		t.Fatalf("повторная подача: %v", err)
	}
	if got := h.auditOf(exec.ID.String(), "executor.kyc_submitted"); len(got) != 2 {
		t.Fatalf("аудитов %d, want 2", len(got))
	}
}

func TestSubmitKycValidation(t *testing.T) {
	h := newHarness(t, nil)
	exec, token, _, _ := h.tooParty()
	one := func() []string { return fileIDs(1) }
	cases := []struct {
		name         string
		idFiles, reg []string
		key          string
		code         connect.Code
		reason       string
	}{
		{"нет удостоверения", nil, one(), h.key(), connect.CodeFailedPrecondition, "kyc_documents_missing"},
		{"нет регистрации", one(), []string{}, h.key(), connect.CodeFailedPrecondition, "kyc_documents_missing"},
		{"пятый файл", fileIDs(5), one(), h.key(), connect.CodeInvalidArgument, "invalid_request"},
		{"пятый файл регистрации", one(), fileIDs(5), h.key(), connect.CodeInvalidArgument, "invalid_request"},
		{"не UUID", []string{"file-1"}, one(), h.key(), connect.CodeInvalidArgument, "invalid_request"},
		{"UUID в скобках", []string{"{" + uuid.NewString() + "}"}, one(), h.key(), connect.CodeInvalidArgument, "invalid_request"},
		{"пустой ключ", one(), one(), "", connect.CodeInvalidArgument, "invalid_request"},
	}
	for _, c := range cases {
		_, err := h.submitKyc(token, c.idFiles, c.reg, c.key)
		h.wantRefusal(err, c.code, c.reason)
		if st := h.kycStatus(exec.ID).KycStatus; st != kycNotSubmitted {
			t.Fatalf("%s: статус %s", c.name, st)
		}
	}
	// Ровно четыре файла каждого вида — можно; повторы не считаются лишними после убирания.
	if _, err := h.submitKyc(token, fileIDs(4), fileIDs(4), h.key()); err != nil {
		t.Fatalf("четыре файла: %v", err)
	}
	// Исполнитель без стороны.
	_, bare := h.executor()
	_, err := h.submitKyc(bare, one(), one(), h.key())
	h.wantRefusal(err, connect.CodeFailedPrecondition, "party_missing")
	// Недействительная сессия.
	_, err = h.submitKyc("no-such-token", one(), one(), h.key())
	h.wantRefusal(err, connect.CodeUnauthenticated, "session_invalid")
}

func TestReviewKycValidation(t *testing.T) {
	h := newHarness(t, nil)
	exec, _, _, _ := h.tooParty()
	_, opToken := h.mfaOperator()
	pending := func() { h.setKyc(exec.ID, kycPending, true, h.clock.now()) }
	id := exec.ID.String()

	reasons := []struct {
		reason string
		ok     bool
	}{
		{"", false}, {"  ab  ", false}, {"  \t", false}, {strings.Repeat("я", 501), false},
		{strings.Repeat("я", 3), true}, {"  " + strings.Repeat("я", 500) + "  ", true},
	}
	for _, c := range reasons {
		pending()
		res, err := h.reviewKyc(opToken, id, false, c.reason, h.key())
		if !c.ok {
			h.wantRefusal(err, connect.CodeInvalidArgument, "kyc_reason_invalid")
			if h.kycStatus(exec.ID).KycStatus != kycPending {
				t.Fatalf("причина %q: статус изменился", c.reason)
			}
			continue
		}
		if err != nil {
			t.Fatalf("причина %q: %v", c.reason, err)
		}
		if got := res.GetParty().GetKycRejectReason(); got != strings.TrimSpace(c.reason) {
			t.Fatalf("причина записана как %q", got)
		}
	}

	// Подтверждение причину не пишет и не проверяет.
	pending()
	res, err := h.reviewKyc(opToken, id, true, "x", h.key())
	if err != nil || res.GetParty().GetKycStatus() != identityv1.KycStatus_KYC_STATUS_VERIFIED || res.GetParty().GetKycRejectReason() != "" {
		t.Fatalf("verify: %v, %v", res, err)
	}

	// PENDING без файлов (демо-сид) решить нельзя.
	h.setKyc(exec.ID, kycPending, false, h.clock.now())
	_, err = h.reviewKyc(opToken, id, true, "", h.key())
	h.wantRefusal(err, connect.CodeFailedPrecondition, "kyc_documents_missing")

	// Нет стороны, неверный идентификатор, пустой ключ.
	_, err = h.reviewKyc(opToken, uuid.NewString(), true, "", h.key())
	h.wantRefusal(err, connect.CodeFailedPrecondition, "party_missing")
	_, err = h.reviewKyc(opToken, "not-a-uuid", true, "", h.key())
	h.wantRefusal(err, connect.CodeInvalidArgument, "invalid_request")
	_, err = h.reviewKyc(opToken, id, true, "", "")
	h.wantRefusal(err, connect.CodeInvalidArgument, "invalid_request")
}

// TestReviewKycAuditAndEvent — решение пишет аудит (с причиной в after_json) и событие
// KycReviewed; открытых данных в аудите нет.
func TestReviewKycAuditAndEvent(t *testing.T) {
	h := newHarness(t, nil)
	exec, _, bin, director := h.tooParty()
	op, opToken := h.mfaOperator()
	h.setKyc(exec.ID, kycPending, true, h.clock.now())
	if _, err := h.reviewKyc(opToken, exec.ID.String(), false, "Удостоверение просрочено", h.key()); err != nil {
		t.Fatal(err)
	}
	rejected := h.auditOf(exec.ID.String(), "executor.kyc_rejected")
	if len(rejected) != 1 || rejected[0].GetActorId() != op.ID.String() || rejected[0].GetActorRole() != mfaRole ||
		!strings.Contains(rejected[0].GetAfterJson(), "Удостоверение просрочено") || !strings.Contains(rejected[0].GetBeforeJson(), kycPending) {
		t.Fatalf("аудит отказа: %v", rejected)
	}
	noValues(t, rejected[0], bin, director)
	ev := h.kycEvents(exec.ID.String())
	if len(ev) != 1 || ev[0].GetStatus() != identityv1.KycStatus_KYC_STATUS_REJECTED {
		t.Fatalf("события: %v", ev)
	}

	// Повторная подача и подтверждение.
	h.setKyc(exec.ID, kycPending, true, h.clock.now())
	if _, err := h.reviewKyc(opToken, exec.ID.String(), true, "", h.key()); err != nil {
		t.Fatal(err)
	}
	verified := h.auditOf(exec.ID.String(), "executor.kyc_verified")
	if len(verified) != 1 || strings.Contains(verified[0].GetAfterJson(), "reason") {
		t.Fatalf("аудит подтверждения: %v", verified)
	}
	ev = h.kycEvents(exec.ID.String())
	if len(ev) != 2 || ev[1].GetStatus() != identityv1.KycStatus_KYC_STATUS_VERIFIED {
		t.Fatalf("события: %v", ev)
	}
}

// TestReviewKycConcurrent — два оператора одновременно подтверждают и отклоняют: ровно
// один успех, второй kyc_transition_forbidden, одно событие и один аудит.
func TestReviewKycConcurrent(t *testing.T) {
	h := newHarness(t, nil)
	_, tokenA := h.mfaOperator()
	_, tokenB := h.mfaOperator()
	for round := range 5 {
		exec, _, _, _ := h.tooParty()
		h.setKyc(exec.ID, kycPending, true, h.clock.now())
		keys := []string{h.key(), h.key()}
		errs := make([]error, 2)
		var wg sync.WaitGroup
		start := make(chan struct{})
		call := func(i int, token string, verify bool, reason string) {
			defer wg.Done()
			<-start
			_, errs[i] = h.reviewKyc(token, exec.ID.String(), verify, reason, keys[i])
		}
		wg.Add(2)
		go call(0, tokenA, true, "")
		go call(1, tokenB, false, "Не видно печати")
		close(start)
		wg.Wait()

		ok, lost := 0, 0
		for _, err := range errs {
			switch {
			case err == nil:
				ok++
			case connect.CodeOf(err) == connect.CodeFailedPrecondition && strings.Contains(err.Error(), "kyc_transition_forbidden"):
				lost++
			default:
				t.Fatalf("раунд %d: неожиданная ошибка %v", round, err)
			}
		}
		if ok != 1 || lost != 1 {
			t.Fatalf("раунд %d: успехов %d, отказов %d", round, ok, lost)
		}
		final := h.kycStatus(exec.ID).KycStatus
		winnerVerify := errs[0] == nil
		if winnerVerify != (final == kycVerified) || (!winnerVerify && final != kycRejected) {
			t.Fatalf("раунд %d: победил verify=%v, статус %s", round, winnerVerify, final)
		}
		if ev := h.kycEvents(exec.ID.String()); len(ev) != 1 {
			t.Fatalf("раунд %d: событий %d", round, len(ev))
		}
		audits := len(h.auditOf(exec.ID.String(), "executor.kyc_verified")) + len(h.auditOf(exec.ID.String(), "executor.kyc_rejected"))
		if audits != 1 {
			t.Fatalf("раунд %d: аудитов %d", round, audits)
		}
	}
}

func TestReviewKycReplay(t *testing.T) {
	h := newHarness(t, nil)
	exec, _, _, _ := h.tooParty()
	_, opToken := h.mfaOperator()
	h.setKyc(exec.ID, kycPending, true, h.clock.now())
	id, key := exec.ID.String(), h.key()
	first, err := h.reviewKyc(opToken, id, true, "", key)
	if err != nil {
		t.Fatal(err)
	}
	second, err := h.reviewKyc(opToken, id, true, "", key)
	if err != nil || prototext.Format(first) != prototext.Format(second) {
		t.Fatalf("повтор по ключу: %v, %v", second, err)
	}
	if ev := h.kycEvents(id); len(ev) != 1 {
		t.Fatalf("событий %d, want 1", len(ev))
	}
	if got := h.auditOf(id, "executor.kyc_verified"); len(got) != 1 {
		t.Fatalf("аудитов %d, want 1", len(got))
	}
	// Тот же ключ с другим решением — отказ; новый ключ после решения — запрещённый переход.
	_, err = h.reviewKyc(opToken, id, false, "Нет печати", key)
	h.wantRefusal(err, connect.CodeInvalidArgument, "idempotency_key_reused")
	_, err = h.reviewKyc(opToken, id, true, "", h.key())
	h.wantRefusal(err, connect.CodeFailedPrecondition, "kyc_transition_forbidden")
}

func TestKycQueueOrderAndFilter(t *testing.T) {
	h := newHarness(t, nil)
	_, opToken := h.mfaOperator()
	now := h.clock.now()
	mk := func(status string, docs bool, age time.Duration) store.User {
		u, _, _, _ := h.tooParty()
		h.setKyc(u.ID, status, docs, now.Add(-age))
		return u
	}
	newer := mk(kycPending, true, time.Hour)
	older := mk(kycPending, true, 48*time.Hour)
	mk(kycVerified, true, 72*time.Hour)
	mk(kycRejected, true, 72*time.Hour)
	mk(kycNotSubmitted, false, 72*time.Hour)
	noDocs := mk(kycPending, false, 96*time.Hour)
	// Только удостоверение, без регистрации.
	half := mk(kycPending, true, 96*time.Hour)
	if _, err := h.pool.Exec(context.Background(), `UPDATE parties SET kyc_registration_file_ids = '{}' WHERE user_id = $1`, half.ID); err != nil {
		t.Fatal(err)
	}
	// ФИО и ИИН у старшей заявки: в ответе только имя и последние 4 цифры.
	olderToken := h.session(older)
	iin := freshIIN(t)
	h.mustRecordPerson(olderToken, "Жумабаев Ерлан", iin)

	res, err := h.kycQueue(opToken)
	if err != nil {
		t.Fatalf("ListKycQueue: %v", err)
	}
	if len(res.GetParties()) != len(res.GetPeople()) {
		t.Fatalf("parties %d, people %d", len(res.GetParties()), len(res.GetPeople()))
	}
	mine := map[string]int{older.ID.String(): 0, newer.ID.String(): 1}
	order := []string{}
	for i, p := range res.GetParties() {
		id := p.GetUserId()
		if res.GetPeople()[i].GetUserId() != id {
			t.Fatalf("people[%d] — %s, want %s", i, res.GetPeople()[i].GetUserId(), id)
		}
		if p.GetKycStatus() != identityv1.KycStatus_KYC_STATUS_PENDING || len(p.GetKycIdFileIds()) == 0 || len(p.GetKycRegistrationFileIds()) == 0 {
			t.Fatalf("в очереди лишний: %v", p)
		}
		if id == noDocs.ID.String() || id == half.ID.String() {
			t.Fatalf("в очереди заявка без обоих видов файлов: %v", p)
		}
		if _, ok := mine[id]; ok {
			order = append(order, id)
		}
		if id == older.ID.String() {
			person := res.GetPeople()[i]
			if person.GetFullName() != "Жумабаев Ерлан" || person.GetIinLast4() != iin[8:] || strings.Contains(prototext.Format(person), iin) {
				t.Fatalf("person = %v", person)
			}
		}
	}
	if len(order) != 2 || order[0] != older.ID.String() || order[1] != newer.ID.String() {
		t.Fatalf("порядок %v, want [старая новая]", order)
	}
	for i := 1; i < len(res.GetParties()); i++ {
		if res.GetParties()[i-1].GetKycSubmittedAt().AsTime().After(res.GetParties()[i].GetKycSubmittedAt().AsTime()) {
			t.Fatalf("очередь не по возрастанию времени подачи на позиции %d", i)
		}
	}
}

// TestKycRequiresMfa — очередь и решение: оператор без второго фактора — mfa_required, не
// оператор — role_forbidden; состояние не меняется.
func TestKycRequiresMfa(t *testing.T) {
	h := newHarness(t, nil)
	exec, execToken, _, _ := h.tooParty()
	_, opToken := h.operator()
	_, clientToken := h.client()
	h.setKyc(exec.ID, kycPending, true, h.clock.now())
	id := exec.ID.String()

	_, err := h.kycQueue(opToken)
	h.wantRefusal(err, connect.CodePermissionDenied, "mfa_required")
	_, err = h.reviewKyc(opToken, id, true, "", h.key())
	h.wantRefusal(err, connect.CodePermissionDenied, "mfa_required")
	if h.kycStatus(exec.ID).KycStatus != kycPending || len(h.kycEvents(id)) != 0 {
		t.Fatal("решение принято без второго фактора")
	}
	for _, token := range []string{execToken, clientToken} {
		_, err = h.kycQueue(token)
		h.wantRefusal(err, connect.CodePermissionDenied, "role_forbidden")
	}
	_, err = h.kycQueue("no-such-token")
	h.wantRefusal(err, connect.CodeUnauthenticated, "session_invalid")

	h.markMfa(opToken)
	if _, err := h.kycQueue(opToken); err != nil {
		t.Fatalf("очередь после второго фактора: %v", err)
	}
	if _, err := h.reviewKyc(opToken, id, true, "", h.key()); err != nil {
		t.Fatalf("решение после второго фактора: %v", err)
	}
}
