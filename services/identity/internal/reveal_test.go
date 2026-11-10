package internal

import (
	"context"
	"encoding/json"
	"slices"
	"strings"
	"testing"

	"connectrpc.com/connect/v2"
	"github.com/google/uuid"

	eventsv1 "github.com/CemeteryPlaya/senim-platform/gen/go/senim/events/v1"
	identityv1 "github.com/CemeteryPlaya/senim-platform/gen/go/senim/identity/v1"
	"github.com/CemeteryPlaya/senim-platform/gen/go/senim/identity/v1/identityv1connect"
)

func (h *harness) reveal(actorToken string, userIDs []string, purpose identityv1.RevealPurpose, ref string) (*identityv1.RevealPartyDetailsResponse, error) {
	h.t.Helper()
	return idc(h, "web", func(ctx context.Context, c identityv1connect.IdentityServiceClient) (*identityv1.RevealPartyDetailsResponse, error) {
		return c.RevealPartyDetails(ctx, &identityv1.RevealPartyDetailsRequest{ActorSessionToken: actorToken, UserIds: userIDs, Purpose: purpose, ReferenceId: ref})
	})
}

// revealMeta — after_json события pii.revealed.
type revealMeta struct {
	Purpose     string   `json:"purpose"`
	ReferenceID string   `json:"reference_id"`
	Fields      []string `json:"fields"`
	Found       bool     `json:"found"`
}

func revealedOf(t *testing.T, h *harness, userID, ref string) []revealMeta {
	t.Helper()
	var out []revealMeta
	for _, e := range h.auditOf(userID, "pii.revealed") {
		var m revealMeta
		if err := json.Unmarshal([]byte(e.GetAfterJson()), &m); err != nil {
			t.Fatalf("after_json: %v", err)
		}
		if m.ReferenceID == ref {
			out = append(out, m)
		}
	}
	return out
}

func TestRevealWritesAuditPerSubject(t *testing.T) {
	h := newHarness(t, nil)
	// Мастер-ТОО со счётом и заказчик с ИИН.
	master, masterToken, bin, director := h.tooParty()
	const iban = "KZ86125KZT5004100100"
	if _, err := h.setPayoutIban(masterToken, iban, h.key()); err != nil {
		t.Fatal(err)
	}
	client, clientToken := h.client()
	clientIIN := freshIIN(t)
	h.mustRecordPerson(clientToken, testFullName, clientIIN)
	unknown := uuid.New()
	ref := "deal-" + uuid.NewString()

	res, err := h.reveal(clientToken, []string{master.ID.String(), client.ID.String(), unknown.String()}, identityv1.RevealPurpose_REVEAL_PURPOSE_CONTRACT, ref)
	if err != nil {
		t.Fatalf("RevealPartyDetails: %v", err)
	}
	if len(res.GetParties()) != 2 {
		t.Fatalf("реквизитов %d, want 2 (неизвестный пропускается)", len(res.GetParties()))
	}
	byID := map[string]*identityv1.PartyDetails{}
	for _, p := range res.GetParties() {
		byID[p.GetUserId()] = p
	}
	m := byID[master.ID.String()]
	if m.GetLegalForm() != formTOO || m.GetBinIin() != bin || m.GetSignerIin() != director || m.GetSignerFullName() != directorName ||
		m.GetPayoutIban() != iban || m.GetLegalName() != "ТОО «Дала Мебель»" || m.GetIin() != "" {
		t.Fatalf("мастер: %v", m)
	}
	c := byID[client.ID.String()]
	if c.GetIin() != clientIIN || c.GetFullName() != testFullName || c.GetLegalForm() != identityv1.LegalForm_LEGAL_FORM_UNSPECIFIED || c.GetBinIin() != "" {
		t.Fatalf("заказчик: %v", c)
	}

	// По событию pii.revealed на каждого субъекта: действующее лицо — пользователь сессии,
	// цель и ссылка — в after_json, значений нет.
	for _, id := range []uuid.UUID{master.ID, client.ID, unknown} {
		events := h.auditOf(id.String(), "pii.revealed")
		var mine []*eventsv1.AuditEvent
		for _, e := range events {
			if strings.Contains(e.GetAfterJson(), ref) {
				mine = append(mine, e)
			}
		}
		if len(mine) != 1 {
			t.Fatalf("%s: событий pii.revealed %d, want 1", id, len(mine))
		}
		e := mine[0]
		if e.GetActorKind() != "user" || e.GetActorId() != client.ID.String() || e.GetActorRole() != "CLIENT" || e.GetEntityType() != "user" {
			t.Fatalf("действующее лицо: %v", e)
		}
		noValues(t, e, bin, director, iban, clientIIN, bin[8:], clientIIN[8:], "Сапаров", "Тулегенов")
	}
	if got := revealedOf(t, h, master.ID.String(), ref); len(got) != 1 || got[0].Purpose != "CONTRACT" || !got[0].Found ||
		!slices.Equal(got[0].Fields, []string{"legal_name", "bin_iin", "signer_full_name", "signer_iin", "payout_iban"}) {
		t.Fatalf("мастер: %+v", got)
	}
	if got := revealedOf(t, h, client.ID.String(), ref); len(got) != 1 || !got[0].Found || !slices.Equal(got[0].Fields, []string{"full_name", "iin"}) {
		t.Fatalf("заказчик: %+v", got)
	}
	if got := revealedOf(t, h, unknown.String(), ref); len(got) != 1 || got[0].Found || len(got[0].Fields) != 0 {
		t.Fatalf("неизвестный: %+v", got)
	}

	// Без сессии действующего лица (фоновая выплата) — действующее лицо — сервис web.
	ref2 := "payout-" + uuid.NewString()
	res, err = h.reveal("", []string{master.ID.String(), master.ID.String()}, identityv1.RevealPurpose_REVEAL_PURPOSE_PAYOUT, ref2)
	if err != nil || len(res.GetParties()) != 1 || res.GetParties()[0].GetPayoutIban() != iban {
		t.Fatalf("выплата: %v, %v", res, err)
	}
	var svc []*eventsv1.AuditEvent
	for _, e := range h.auditOf(master.ID.String(), "pii.revealed") {
		if strings.Contains(e.GetAfterJson(), ref2) {
			svc = append(svc, e)
		}
	}
	if len(svc) != 1 || svc[0].GetActorKind() != "service" || svc[0].GetActorId() != "web" || !strings.Contains(svc[0].GetAfterJson(), `"PAYOUT"`) {
		t.Fatalf("сервис: %v", svc)
	}

	// Оператор — только с пройденным вторым фактором (в обход экранов web — тоже).
	_, opToken := h.operator()
	_, err = h.reveal(opToken, []string{master.ID.String()}, identityv1.RevealPurpose_REVEAL_PURPOSE_CONTRACT, "deal-op")
	h.wantRefusal(err, connect.CodePermissionDenied, "mfa_required")
	h.markMfa(opToken)
	if _, err := h.reveal(opToken, []string{master.ID.String()}, identityv1.RevealPurpose_REVEAL_PURPOSE_CONTRACT, "deal-op"); err != nil {
		t.Fatalf("оператор со вторым фактором: %v", err)
	}
	if got := revealedOf(t, h, master.ID.String(), "deal-op"); len(got) != 1 {
		t.Fatalf("аудит оператора: %+v", got)
	}

	// Недействующая сессия действующего лица — отказ, без раскрытия и аудита.
	ref3 := "deal-" + uuid.NewString()
	_, err = h.reveal(newToken(t), []string{master.ID.String()}, identityv1.RevealPurpose_REVEAL_PURPOSE_CONTRACT, ref3)
	h.wantRefusal(err, connect.CodeUnauthenticated, "session_invalid")
	if got := revealedOf(t, h, master.ID.String(), ref3); len(got) != 0 {
		t.Fatalf("аудит при отказе: %+v", got)
	}
	if strings.Contains(h.logs.String(), bin) || strings.Contains(h.logs.String(), iban) || strings.Contains(h.logs.String(), clientIIN) {
		t.Fatal("открытые значения в логе")
	}
}

func TestRevealUnknownPurpose(t *testing.T) {
	h := newHarness(t, nil)
	master, _, _, _ := h.tooParty()
	ids := []string{master.ID.String()}
	for _, p := range []identityv1.RevealPurpose{identityv1.RevealPurpose_REVEAL_PURPOSE_UNSPECIFIED, 99} {
		_, err := h.reveal("", ids, p, "deal-1")
		h.wantRefusal(err, connect.CodeInvalidArgument, "reveal_purpose_invalid")
	}
	// reference_id и список пользователей обязательны; id — UUID.
	for _, c := range []struct {
		ids []string
		ref string
	}{
		{ids, ""},
		{ids, strings.Repeat("r", 129)},
		{nil, "deal-1"},
		{[]string{"not-a-uuid"}, "deal-1"},
	} {
		_, err := h.reveal("", c.ids, identityv1.RevealPurpose_REVEAL_PURPOSE_CONTRACT, c.ref)
		h.wantRefusal(err, connect.CodeInvalidArgument, "invalid_request")
	}
	if n := len(h.auditOf(master.ID.String(), "pii.revealed")); n != 0 {
		t.Fatalf("аудит при отказе: %d", n)
	}
}
