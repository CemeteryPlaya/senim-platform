package internal

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"math/rand/v2"
	"strings"
	"sync"
	"testing"

	"connectrpc.com/connect/v2"
	"github.com/google/uuid"
	"google.golang.org/protobuf/encoding/prototext"

	eventsv1 "github.com/CemeteryPlaya/senim-platform/gen/go/senim/events/v1"
	identityv1 "github.com/CemeteryPlaya/senim-platform/gen/go/senim/identity/v1"
	"github.com/CemeteryPlaya/senim-platform/gen/go/senim/identity/v1/identityv1connect"
	"github.com/CemeteryPlaya/senim-platform/pkg/pii"
	"github.com/CemeteryPlaya/senim-platform/services/identity/internal/store"
)

const (
	formSelf = identityv1.LegalForm_LEGAL_FORM_SELF_EMPLOYED
	formIP   = identityv1.LegalForm_LEGAL_FORM_IP
	formTOO  = identityv1.LegalForm_LEGAL_FORM_TOO

	ownerName    = "Жумабаев Ерлан"
	directorName = "Тулегенов Бауыржан"
)

// freshBIN — случайный верный БИН (ГГММ + тип 4–6 + признак 0–3 + номер + контроль): база
// общая для тестов пакета, номер не повторяется.
func freshBIN(t *testing.T) string {
	t.Helper()
	for range 1000 {
		first11 := fmt.Sprintf("%02d%02d%d%d%05d", rand.IntN(100), 1+rand.IntN(12), 4+rand.IntN(3), rand.IntN(4), rand.IntN(100000)) //nolint:gosec // тестовые номера, не секрет
		if d := kzCheckDigit(first11); d >= 0 {
			bin := fmt.Sprintf("%s%d", first11, d)
			if !validBIN(bin) {
				t.Fatalf("freshBIN: %s не прошёл проверку", bin)
			}
			return bin
		}
	}
	t.Fatal("freshBIN: не нашлось номера")
	return ""
}

func (h *harness) registerParty(req *identityv1.RegisterPartyRequest) (*identityv1.RegisterPartyResponse, error) {
	h.t.Helper()
	if req.IdempotencyKey == "" {
		req.IdempotencyKey = h.key()
	}
	return idc(h, "web", func(ctx context.Context, c identityv1connect.IdentityServiceClient) (*identityv1.RegisterPartyResponse, error) {
		return c.RegisterParty(ctx, req)
	})
}

func (h *harness) mustRegisterParty(req *identityv1.RegisterPartyRequest) *identityv1.Party {
	h.t.Helper()
	res, err := h.registerParty(req)
	if err != nil {
		h.t.Fatalf("RegisterParty: %v", err)
	}
	return res.GetParty()
}

func (h *harness) provision(req *identityv1.ProvisionExecutorRequest) (*identityv1.ProvisionExecutorResponse, error) {
	h.t.Helper()
	if req.IdempotencyKey == "" {
		req.IdempotencyKey = h.key()
	}
	return idc(h, "web", func(ctx context.Context, c identityv1connect.IdentityServiceClient) (*identityv1.ProvisionExecutorResponse, error) {
		return c.ProvisionExecutor(ctx, req)
	})
}

func (h *harness) setPayoutIban(token, iban, key string) (*identityv1.SetPayoutIbanResponse, error) {
	h.t.Helper()
	return idc(h, "web", func(ctx context.Context, c identityv1connect.IdentityServiceClient) (*identityv1.SetPayoutIbanResponse, error) {
		return c.SetPayoutIban(ctx, &identityv1.SetPayoutIbanRequest{SessionToken: token, Iban: iban, IdempotencyKey: key})
	})
}

const (
	sideClient   = identityv1.SigningSide_SIGNING_SIDE_CLIENT
	sideExecutor = identityv1.SigningSide_SIGNING_SIDE_EXECUTOR
)

func (h *harness) verifySigner(userID, iin string, side identityv1.SigningSide) (*identityv1.VerifySignerIinResponse, error) {
	h.t.Helper()
	return idc(h, "web", func(ctx context.Context, c identityv1connect.IdentityServiceClient) (*identityv1.VerifySignerIinResponse, error) {
		return c.VerifySignerIin(ctx, &identityv1.VerifySignerIinRequest{UserId: userID, Iin: iin, Side: side})
	})
}

// executor — исполнитель (роль выдана и активна) и его сессия.
func (h *harness) executor() (store.User, string) {
	h.t.Helper()
	u := h.user([]string{"EXECUTOR"}, "EXECUTOR")
	return u, h.session(u)
}

// tooParty — исполнитель-ТОО с реквизитами; возвращает пользователя, сессию, БИН и ИИН
// директора.
func (h *harness) tooParty() (store.User, string, string, string) {
	h.t.Helper()
	u, token := h.executor()
	bin, director := freshBIN(h.t), freshIIN(h.t)
	h.mustRegisterParty(&identityv1.RegisterPartyRequest{
		SessionToken: token, LegalForm: formTOO, LegalName: "ТОО «Дала Мебель»", BinIin: bin,
		SignerFullName: directorName, SignerIin: director,
	})
	return u, token, bin, director
}

// mfaOperator — оператор, прошедший в этой сессии второй фактор.
func (h *harness) mfaOperator() (store.User, string) {
	h.t.Helper()
	u, token := h.operator()
	h.markMfa(token)
	return u, token
}

func (h *harness) markMfa(token string) {
	h.t.Helper()
	if _, err := h.q.SetSessionMfaVerified(context.Background(), store.SetSessionMfaVerifiedParams{At: ts(h.clock.now()), ID: h.sessionRow(token).ID}); err != nil {
		h.t.Fatal(err)
	}
}

func (h *harness) partyRow(userID uuid.UUID) (store.Party, bool) {
	h.t.Helper()
	p, err := h.q.GetParty(context.Background(), userID)
	if err != nil {
		return p, false
	}
	return p, true
}

func (h *harness) open(blob, aad string) string {
	h.t.Helper()
	plain, err := h.svc.cfg.PII.Open(blob, aad)
	if err != nil {
		h.t.Fatalf("расшифровка %s: %v", aad, err)
	}
	return string(plain)
}

// noValues — в строках аудита нет открытых значений.
func noValues(t *testing.T, e *eventsv1.AuditEvent, values ...string) {
	t.Helper()
	for _, s := range []string{e.GetBeforeJson(), e.GetAfterJson()} {
		for _, v := range values {
			if v != "" && strings.Contains(s, v) {
				t.Fatalf("в аудите %s значение %q: %s", e.GetAction(), v, s)
			}
		}
	}
}

func TestRegisterPartyIPUsesPersonIIN(t *testing.T) {
	h := newHarness(t, nil)
	u, token := h.executor()
	iin := freshIIN(t)
	h.mustRecordPerson(token, testFullName, iin)

	// bin_iin запроса для ИП не используется: даже чужой верный номер.
	other := freshIIN(t)
	req := &identityv1.RegisterPartyRequest{
		SessionToken: token, LegalForm: formIP, LegalName: "  ИП «Дала Мебель» ", BinIin: other,
		SignerFullName: "  Жумабаев  Ерлан ", SignerIin: freshIIN(t),
	}
	party := h.mustRegisterParty(req)
	if party.GetBinIinLast4() != iin[8:] || party.GetLegalForm() != formIP || party.GetLegalName() != "ИП «Дала Мебель»" ||
		party.GetSignerFullName() != ownerName || party.GetSignerIinLast4() != "" || party.GetKycStatus() != identityv1.KycStatus_KYC_STATUS_NOT_SUBMITTED {
		t.Fatalf("party = %v", party)
	}
	if strings.Contains(prototext.Format(party), iin) {
		t.Fatal("в ответе открытый ИИН")
	}
	row, ok := h.partyRow(u.ID)
	if !ok {
		t.Fatal("строки parties нет")
	}
	if got := h.open(row.BinIinEnc, "identity.parties.bin_iin:"+u.ID.String()); got != iin {
		t.Fatalf("bin_iin = %q, want ИИН личности", got)
	}
	if !bytes.Equal(row.BinIinHash, pii.NewIndex(testIndexKey).Of(pii.DomainBINIIN, iin)) {
		t.Fatal("bin_iin_hash — не слепой индекс домена bin_iin")
	}
	if row.SignerIinEnc.Valid || row.SignerIinHash != nil {
		t.Fatal("у ИП ИИН подписанта записан")
	}

	events := h.auditOf(u.ID.String(), "party.registered")
	if len(events) != 1 {
		t.Fatalf("аудит party.registered: %d, want 1", len(events))
	}
	noValues(t, events[0], iin, iin[8:], "Жумабаев", "Дала")

	// Повтор с теми же данными (новый ключ) — тот же ответ, без нового аудита.
	req.IdempotencyKey = ""
	again := h.mustRegisterParty(req)
	if prototext.Format(again) != prototext.Format(party) {
		t.Fatalf("повтор: %v, want %v", again, party)
	}
	if n := len(h.auditOf(u.ID.String(), "party.registered")); n != 1 {
		t.Fatalf("аудит после повтора: %d", n)
	}
	// Другие данные при существующей стороне, пока KYC не подана, — перезапись
	// (TestRegisterPartyReplace).
	req.IdempotencyKey, req.LegalName = "", "ИП «Другое»"
	if got := h.mustRegisterParty(req); got.GetLegalName() != "ИП «Другое»" {
		t.Fatalf("перезапись: %v", got)
	}

	// Самозанятый тоже работает по ИИН личности; ФИО подписанта — наименование.
	u2, token2 := h.executor()
	iin2 := freshIIN(t)
	h.mustRecordPerson(token2, testFullName, iin2)
	self := h.mustRegisterParty(&identityv1.RegisterPartyRequest{SessionToken: token2, LegalForm: formSelf, LegalName: " Жумабаев  Ерлан Серикович "})
	if self.GetBinIinLast4() != iin2[8:] || self.GetSignerFullName() != "Жумабаев Ерлан Серикович" || self.GetUserId() != u2.ID.String() {
		t.Fatalf("самозанятый: %v", self)
	}

	// Личности нет — person_missing (ИИН вводится при знакомстве, второй раз не вводится).
	_, token3 := h.executor()
	_, err := h.registerParty(&identityv1.RegisterPartyRequest{SessionToken: token3, LegalForm: formIP, LegalName: "ИП «Дала»", BinIin: freshIIN(t), SignerFullName: ownerName})
	h.wantRefusal(err, connect.CodeFailedPrecondition, "person_missing")
}

// Ruling T: повторная анкета перезаписывает реквизиты, пока KYC не подана или отклонена;
// на проверке или пройдена — party_exists. Счёт выплаты и KYC остаются, аудит — без значений.
func TestRegisterPartyReplace(t *testing.T) {
	h := newHarness(t, nil)
	u, token, oldBin, oldDirector := h.tooParty()
	const iban = "KZ86125KZT5004100100"
	if _, err := h.setPayoutIban(token, iban, h.key()); err != nil {
		t.Fatal(err)
	}
	register := func(bin, director, name string) (*identityv1.RegisterPartyResponse, error) {
		return h.registerParty(&identityv1.RegisterPartyRequest{
			SessionToken: token, LegalForm: formTOO, LegalName: name, BinIin: bin, SignerFullName: directorName, SignerIin: director,
		})
	}

	// KYC не подана: новые БИН, наименование и директор принимаются.
	bin, director := freshBIN(t), freshIIN(t)
	res, err := register(bin, director, "ТОО «Шебер»")
	if err != nil {
		t.Fatalf("перезапись при NOT_SUBMITTED: %v", err)
	}
	p := res.GetParty()
	if p.GetBinIinLast4() != bin[8:] || p.GetLegalName() != "ТОО «Шебер»" || p.GetSignerIinLast4() != director[8:] ||
		p.GetPayoutIbanLast4() != iban[16:] || p.GetKycStatus() != identityv1.KycStatus_KYC_STATUS_NOT_SUBMITTED {
		t.Fatalf("party = %v", p)
	}
	row, _ := h.partyRow(u.ID)
	if h.open(row.BinIinEnc, "identity.parties.bin_iin:"+u.ID.String()) != bin ||
		h.open(row.SignerIinEnc.String, "identity.parties.signer_iin:"+u.ID.String()) != director {
		t.Fatal("номера не перезаписаны")
	}
	events := h.auditOf(u.ID.String(), "party.replaced")
	if len(events) != 1 {
		t.Fatalf("аудит party.replaced: %d, want 1", len(events))
	}
	noValues(t, events[0], bin, director, oldBin, oldDirector, bin[8:], "Шебер")
	// Прежний БИН освободился: его может взять другая сторона.
	_, other := h.executor()
	h.mustRegisterParty(&identityv1.RegisterPartyRequest{SessionToken: other, LegalForm: formTOO, LegalName: "ТОО «Дала»", BinIin: oldBin, SignerFullName: directorName, SignerIin: freshIIN(t)})

	// БИН другой стороны — iin_taken, реквизиты не меняются.
	_, err = register(oldBin, director, "ТОО «Шебер»")
	h.wantRefusal(err, connect.CodeAlreadyExists, "iin_taken")
	if row, _ := h.partyRow(u.ID); row.BinIinLast4 != bin[8:] {
		t.Fatal("реквизиты изменены при отказе")
	}

	// KYC отклонена — снова можно; на проверке и пройдена — party_exists.
	h.setKyc(u.ID, "REJECTED", true, h.clock.now())
	bin2 := freshBIN(t)
	if _, err := register(bin2, director, "ТОО «Шебер»"); err != nil {
		t.Fatalf("перезапись при REJECTED: %v", err)
	}
	if row, _ := h.partyRow(u.ID); row.KycStatus != "REJECTED" || row.BinIinLast4 != bin2[8:] {
		t.Fatalf("после перезаписи: kyc %s, bin %s", row.KycStatus, row.BinIinLast4)
	}
	for _, status := range []string{"PENDING", "VERIFIED"} {
		h.setKyc(u.ID, status, true, h.clock.now())
		_, err := register(freshBIN(t), director, "ТОО «Шебер»")
		h.wantRefusal(err, connect.CodeFailedPrecondition, "party_exists")
		// Те же реквизиты ещё раз — тот же ответ и при KYC на проверке.
		if _, err := register(bin2, director, "ТОО «Шебер»"); err != nil {
			t.Fatalf("%s: повтор тех же реквизитов: %v", status, err)
		}
	}
	if n := len(h.auditOf(u.ID.String(), "party.replaced")); n != 2 {
		t.Fatalf("аудит party.replaced: %d, want 2", n)
	}
}

func TestRegisterPartyTOORequiresSigner(t *testing.T) {
	h := newHarness(t, nil)
	u, token := h.executor()
	bin, director := freshBIN(t), freshIIN(t)
	base := func() *identityv1.RegisterPartyRequest {
		return &identityv1.RegisterPartyRequest{SessionToken: token, LegalForm: formTOO, LegalName: "ТОО «Дала»", BinIin: bin}
	}

	_, err := h.registerParty(base())
	h.wantRefusal(err, connect.CodeInvalidArgument, "signer_required")
	r := base()
	r.SignerFullName = directorName
	_, err = h.registerParty(r)
	h.wantRefusal(err, connect.CodeInvalidArgument, "signer_required")
	r = base()
	r.SignerIin = director
	_, err = h.registerParty(r)
	h.wantRefusal(err, connect.CodeInvalidArgument, "signer_required")
	r = base()
	r.SignerFullName, r.SignerIin = "Тулегенов", director
	_, err = h.registerParty(r)
	h.wantRefusal(err, connect.CodeInvalidArgument, "full_name_invalid")
	broken := director[:11] + fmt.Sprint((int(director[11]-'0')+1)%10)
	r = base()
	r.SignerFullName, r.SignerIin = directorName, broken
	_, err = h.registerParty(r)
	h.wantRefusal(err, connect.CodeInvalidArgument, "iin_invalid")
	r = base()
	r.SignerFullName, r.SignerIin = directorName, bin
	_, err = h.registerParty(r)
	h.wantRefusal(err, connect.CodeInvalidArgument, "iin_invalid")
	if _, ok := h.partyRow(u.ID); ok {
		t.Fatal("сторона записана при отказе")
	}

	// Пробелы в номерах, как вводят в форме, допустимы; ФИО нормализуется.
	r = base()
	r.BinIin = bin[:4] + " " + bin[4:8] + " " + bin[8:]
	r.SignerFullName, r.SignerIin = "  Тулегенов   Бауыржан ", director[:6]+" "+director[6:]
	party := h.mustRegisterParty(r)
	if party.GetSignerFullName() != directorName || party.GetSignerIinLast4() != director[8:] || party.GetBinIinLast4() != bin[8:] {
		t.Fatalf("party = %v", party)
	}
	row, _ := h.partyRow(u.ID)
	if got := h.open(row.SignerIinEnc.String, "identity.parties.signer_iin:"+u.ID.String()); got != director {
		t.Fatalf("signer_iin = %q", got)
	}
	if !bytes.Equal(row.SignerIinHash, pii.NewIndex(testIndexKey).Of(pii.DomainIIN, director)) {
		t.Fatal("signer_iin_hash — не слепой индекс домена iin")
	}
	if got := h.open(row.BinIinEnc, "identity.parties.bin_iin:"+u.ID.String()); got != bin {
		t.Fatalf("bin_iin = %q", got)
	}
}

// Те же правила, что в registration-schema.test.ts (без адреса и опыта — они в web).
func TestRegisterPartyValidation(t *testing.T) {
	h := newHarness(t, nil)
	_, token := h.executor()
	h.mustRecordPerson(token, testFullName, freshIIN(t))
	bin, iin := freshBIN(t), freshIIN(t)
	cases := []struct {
		name   string
		req    *identityv1.RegisterPartyRequest
		reason string
	}{
		{"ТОО — по БИН, ИИН не подходит", &identityv1.RegisterPartyRequest{LegalForm: formTOO, LegalName: "ТОО «Дала»", BinIin: iin, SignerFullName: directorName, SignerIin: freshIIN(t)}, "bin_iin_invalid"},
		{"ТОО — пустой БИН", &identityv1.RegisterPartyRequest{LegalForm: formTOO, LegalName: "ТОО «Дала»", BinIin: "  ", SignerFullName: directorName, SignerIin: freshIIN(t)}, "bin_iin_invalid"},
		{"ИП — ФИО владельца обязательно", &identityv1.RegisterPartyRequest{LegalForm: formIP, LegalName: "ИП «Дала»"}, "signer_required"},
		{"ИП — ФИО владельца полностью", &identityv1.RegisterPartyRequest{LegalForm: formIP, LegalName: "ИП «Дала»", SignerFullName: "Жумабаев"}, "full_name_invalid"},
		{"самозанятый — наименование и есть ФИО", &identityv1.RegisterPartyRequest{LegalForm: formSelf, LegalName: "Ерлан"}, "full_name_invalid"},
		{"наименование короче 2", &identityv1.RegisterPartyRequest{LegalForm: formIP, LegalName: " А ", SignerFullName: ownerName}, "invalid_request"},
		{"наименование длиннее 200", &identityv1.RegisterPartyRequest{LegalForm: formIP, LegalName: strings.Repeat("я", 201), SignerFullName: ownerName}, "invalid_request"},
		{"форма не указана", &identityv1.RegisterPartyRequest{LegalName: "ТОО «Дала»", BinIin: bin}, "invalid_request"},
		{"неизвестная форма", &identityv1.RegisterPartyRequest{LegalForm: 42, LegalName: "ТОО «Дала»", BinIin: bin}, "invalid_request"},
	}
	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			c.req.SessionToken = token
			_, err := h.registerParty(c.req)
			if code, reason := refusal(t, err); code != connect.CodeInvalidArgument || reason != c.reason {
				t.Fatalf("отказ %v/%q, want %q", code, reason, c.reason)
			}
		})
	}
	_, err := h.registerParty(&identityv1.RegisterPartyRequest{SessionToken: token, LegalForm: formIP, LegalName: "ИП «Дала»", SignerFullName: ownerName, IdempotencyKey: strings.Repeat("k", 129)})
	h.wantRefusal(err, connect.CodeInvalidArgument, "invalid_request")
	_, err = h.registerParty(&identityv1.RegisterPartyRequest{SessionToken: newToken(t), LegalForm: formIP, LegalName: "ИП «Дала»", SignerFullName: ownerName})
	h.wantRefusal(err, connect.CodeUnauthenticated, "session_invalid")
}

func TestRegisterPartyNotExecutor(t *testing.T) {
	h := newHarness(t, nil)
	u, token := h.client()
	h.mustRecordPerson(token, testFullName, freshIIN(t))
	_, err := h.registerParty(&identityv1.RegisterPartyRequest{SessionToken: token, LegalForm: formIP, LegalName: "ИП «Дала»", SignerFullName: ownerName})
	h.wantRefusal(err, connect.CodePermissionDenied, "role_not_granted")
	_, opToken := h.operator()
	_, err = h.registerParty(&identityv1.RegisterPartyRequest{SessionToken: opToken, LegalForm: formTOO, LegalName: "ТОО «Дала»", BinIin: freshBIN(t), SignerFullName: directorName, SignerIin: freshIIN(t)})
	h.wantRefusal(err, connect.CodePermissionDenied, "role_not_granted")
	if _, ok := h.partyRow(u.ID); ok {
		t.Fatal("сторона записана без роли исполнителя")
	}

	// Роль выдана, активна роль заказчика (web выдаёт роль, затем регистрирует) — можно.
	dual := h.user([]string{"CLIENT", "EXECUTOR"}, "CLIENT")
	dualToken := h.session(dual)
	h.mustRegisterParty(&identityv1.RegisterPartyRequest{SessionToken: dualToken, LegalForm: formTOO, LegalName: "ТОО «Дала»", BinIin: freshBIN(t), SignerFullName: directorName, SignerIin: freshIIN(t)})
}

func TestRegisterPartyBinTakenRace(t *testing.T) {
	h := newHarness(t, nil)
	for round := range 3 {
		bin := freshBIN(t)
		const n = 4
		tokens, signers := make([]string, n), make([]string, n)
		for i := range tokens {
			_, tokens[i] = h.executor()
			signers[i] = freshIIN(t)
		}
		errs := make([]error, n)
		var wg sync.WaitGroup
		for i := range n {
			wg.Go(func() {
				_, errs[i] = h.registerParty(&identityv1.RegisterPartyRequest{
					SessionToken: tokens[i], LegalForm: formTOO, LegalName: "ТОО «Гонка»", BinIin: bin,
					SignerFullName: directorName, SignerIin: signers[i],
				})
			})
		}
		wg.Wait()
		ok := 0
		for _, err := range errs {
			if err == nil {
				ok++
				continue
			}
			h.wantRefusal(err, connect.CodeAlreadyExists, "iin_taken")
		}
		if ok != 1 {
			t.Fatalf("раунд %d: успешных %d, want 1 (%v)", round, ok, errs)
		}
		if got := h.count(`SELECT count(*) FROM parties WHERE bin_iin_hash = $1`, pii.NewIndex(testIndexKey).Of(pii.DomainBINIIN, bin)); got != 1 {
			t.Fatalf("сторон с БИН: %d", got)
		}
	}
	// Тот же ИИН у ИП второго человека (ИИН личности — у каждого свой, но реквизиты
	// ИП уже заняты оператором) — тоже iin_taken, а не Internal.
	_, opToken := h.mfaOperator()
	iin := freshIIN(t)
	if _, err := h.provision(&identityv1.ProvisionExecutorRequest{SessionToken: opToken, Phone: newPhone(), LegalForm: formIP, LegalName: "ИП «Первый»", BinIin: iin, SignerFullName: ownerName}); err != nil {
		t.Fatalf("ProvisionExecutor: %v", err)
	}
	_, err := h.provision(&identityv1.ProvisionExecutorRequest{SessionToken: opToken, Phone: newPhone(), LegalForm: formIP, LegalName: "ИП «Второй»", BinIin: iin, SignerFullName: ownerName})
	h.wantRefusal(err, connect.CodeAlreadyExists, "iin_taken")
}

func TestProvisionExecutorRequiresMfa(t *testing.T) {
	h := newHarness(t, nil)
	_, opToken := h.operator()
	phone := newPhone()
	req := func() *identityv1.ProvisionExecutorRequest {
		return &identityv1.ProvisionExecutorRequest{SessionToken: opToken, Phone: phone, LegalForm: formTOO, LegalName: "ТОО «Дала»", BinIin: freshBIN(t), SignerFullName: directorName, SignerIin: freshIIN(t)}
	}
	_, err := h.provision(req())
	h.wantRefusal(err, connect.CodePermissionDenied, "mfa_required")
	if h.count(`SELECT count(*) FROM users WHERE phone = $1`, phone) != 0 {
		t.Fatal("пользователь создан без второго фактора")
	}

	// Не оператор — role_forbidden.
	_, clientToken := h.client()
	r := req()
	r.SessionToken = clientToken
	_, err = h.provision(r)
	h.wantRefusal(err, connect.CodePermissionDenied, "role_forbidden")

	op := h.sessionRow(opToken)
	h.markMfa(opToken)
	r = req()
	res, err := h.provision(r)
	if err != nil {
		t.Fatalf("ProvisionExecutor: %v", err)
	}
	user := res.GetUser()
	if user.GetPhone() != phone || len(user.GetRoles()) != 1 || user.GetRoles()[0] != roleExecutor || user.GetDefaultRole() != roleExecutor {
		t.Fatalf("user = %v", user)
	}
	if res.GetParty().GetUserId() != user.GetId() || res.GetParty().GetBinIinLast4() != r.GetBinIin()[8:] || res.GetParty().GetSignerIinLast4() != r.GetSignerIin()[8:] {
		t.Fatalf("party = %v", res.GetParty())
	}
	regs := 0
	for _, e := range outboxEvents(h, subjectUserRegistered, func() *eventsv1.UserRegistered { return &eventsv1.UserRegistered{} }) {
		if e.GetUserId() == user.GetId() && e.GetRole() == roleExecutor {
			regs++
		}
	}
	if regs != 1 {
		t.Fatalf("UserRegistered: %d, want 1", regs)
	}
	events := h.auditOf(user.GetId(), "party.registered")
	if len(events) != 1 || events[0].GetActorId() != op.UserID.String() || events[0].GetActorRole() != "OPERATOR" {
		t.Fatalf("аудит: %v", events)
	}
	noValues(t, events[0], r.GetBinIin(), r.GetSignerIin(), "Тулегенов")

	// Повтор по ключу — тот же ответ; второй вызов с тем же телефоном и теми же данными —
	// тот же ответ; с другими — party_exists.
	r.IdempotencyKey = h.key()
	first, err := h.provision(r)
	if err != nil {
		t.Fatal(err)
	}
	second, err := h.provision(r)
	if err != nil || prototext.Format(first) != prototext.Format(second) {
		t.Fatalf("повтор по ключу: %v, %v", second, err)
	}
	r.IdempotencyKey, r.LegalName = "", "ТОО «Другое»"
	_, err = h.provision(r)
	h.wantRefusal(err, connect.CodeFailedPrecondition, "party_exists")

	// Существующий заказчик по телефону: роль исполнителя добавляется (RoleGranted), id тот же.
	client := h.user([]string{"CLIENT"}, "CLIENT")
	res, err = h.provision(&identityv1.ProvisionExecutorRequest{SessionToken: opToken, Phone: client.Phone, LegalForm: formIP, LegalName: "ИП «Заказчик»", BinIin: freshIIN(t), SignerFullName: ownerName})
	if err != nil {
		t.Fatalf("ProvisionExecutor для заказчика: %v", err)
	}
	if res.GetUser().GetId() != client.ID.String() || len(res.GetUser().GetRoles()) != 2 || res.GetUser().GetDefaultRole() != roleClient {
		t.Fatalf("user = %v", res.GetUser())
	}
	granted := 0
	for _, g := range h.grants(client.ID.String()) {
		if g.GetRole() == roleExecutor {
			granted++
		}
	}
	if granted != 1 {
		t.Fatalf("RoleGranted: %d", granted)
	}

	// Неверный телефон и реквизиты — коды проверки.
	_, err = h.provision(&identityv1.ProvisionExecutorRequest{SessionToken: opToken, Phone: "123", LegalForm: formIP, LegalName: "ИП «Дала»", BinIin: freshIIN(t), SignerFullName: ownerName})
	h.wantRefusal(err, connect.CodeInvalidArgument, "invalid_phone")
	_, err = h.provision(&identityv1.ProvisionExecutorRequest{SessionToken: opToken, Phone: newPhone(), LegalForm: formIP, LegalName: "ИП «Дала»", BinIin: freshBIN(t), SignerFullName: ownerName})
	h.wantRefusal(err, connect.CodeInvalidArgument, "bin_iin_invalid")
}

func TestProvisionExecutorBlockedUser(t *testing.T) {
	h := newHarness(t, nil)
	_, opToken := h.mfaOperator()
	blocked := h.user([]string{"CLIENT"}, "CLIENT")
	h.block(blocked)
	_, err := h.provision(&identityv1.ProvisionExecutorRequest{SessionToken: opToken, Phone: blocked.Phone, LegalForm: formIP, LegalName: "ИП «Дала»", BinIin: freshIIN(t), SignerFullName: ownerName})
	h.wantRefusal(err, connect.CodePermissionDenied, "user_blocked")
	if _, ok := h.partyRow(blocked.ID); ok {
		t.Fatal("заблокированному записана сторона")
	}
	if n := len(h.grants(blocked.ID.String())); n != 0 {
		t.Fatalf("заблокированному выдана роль: %d", n)
	}
}

func TestProvisionExecutorStaffPhone(t *testing.T) {
	h := newHarness(t, nil)
	_, opToken := h.mfaOperator()
	for _, roles := range [][]string{{"OPERATOR"}, {"MEASURER"}} {
		staff := h.user(roles, roles[0])
		_, err := h.provision(&identityv1.ProvisionExecutorRequest{SessionToken: opToken, Phone: staff.Phone, LegalForm: formTOO, LegalName: "ТОО «Дала»", BinIin: freshBIN(t), SignerFullName: directorName, SignerIin: freshIIN(t)})
		h.wantRefusal(err, connect.CodePermissionDenied, "role_forbidden")
		if _, ok := h.partyRow(staff.ID); ok {
			t.Fatal("сотруднику записана сторона")
		}
	}
}

// Случаи iban.test.ts.
func TestSetPayoutIbanValidation(t *testing.T) {
	h := newHarness(t, nil)
	u, token, _, _ := h.tooParty()

	valid := []string{"KZ86125KZT5004100100", "KZ75125KZT2069100100", "KZ18722S000012345678", "KZ14998CTB0000123456", "KZ86601A861000000001"}
	for _, iban := range valid {
		res, err := h.setPayoutIban(token, iban, h.key())
		if err != nil {
			t.Fatalf("%s: %v", iban, err)
		}
		if res.GetParty().GetPayoutIbanLast4() != iban[16:] || !res.GetChanged() || strings.Contains(prototext.Format(res), iban) {
			t.Fatalf("%s: changed = %v, party = %v", iban, res.GetChanged(), res.GetParty())
		}
		row, _ := h.partyRow(u.ID)
		if got := h.open(row.PayoutIbanEnc.String, "identity.parties.payout_iban:"+u.ID.String()); got != iban {
			t.Fatalf("payout_iban = %q, want %q", got, iban)
		}
	}
	// Первый вариант записи — смена (до него был последний из valid), дальше тот же счёт:
	// changed=false.
	for i, raw := range []string{" kz86 125k zt50 0410 0100 ", "KZ86 125K ZT50 0410 0100", "kz86 125k zt50 0410 0100"} {
		res, err := h.setPayoutIban(token, raw, h.key())
		if err != nil {
			t.Fatalf("%q: %v", raw, err)
		}
		if res.GetChanged() != (i == 0) {
			t.Fatalf("%q: changed = %v", raw, res.GetChanged())
		}
		row, _ := h.partyRow(u.ID)
		if got := h.open(row.PayoutIbanEnc.String, "identity.parties.payout_iban:"+u.ID.String()); got != "KZ86125KZT5004100100" {
			t.Fatalf("%q: нормализация %q", raw, got)
		}
	}

	refusals := []struct{ name, iban, reason string }{
		{"одна цифра изменена", "KZ86125KZT5004100101", "checksum"},
		{"переставлены соседние цифры", "KZ86125KZT5004101000", "checksum"},
		{"неверные контрольные цифры", "KZ87125KZT5004100100", "checksum"},
		{"пусто", "", "format"},
		{"короче 20", "KZ86125KZT500410010", "format"},
		{"длиннее 20", "KZ86125KZT50041001000", "format"},
		{"чужая страна", "DE89370400440532013000", "format"},
		{"буквы вместо контрольных цифр", "KZAB125KZT5004100100", "format"},
		{"недопустимый символ", "KZ86125KZT50041001-0", "format"},
		{"кириллица", "КZ86125KZT5004100100", "format"},
		{"лишний символ перед KZ", "XKZ86125KZT5004100100", "format"},
	}
	for _, c := range refusals {
		t.Run(c.name, func(t *testing.T) {
			_, err := h.setPayoutIban(token, c.iban, h.key())
			if code, reason := refusal(t, err); code != connect.CodeInvalidArgument || reason != "iban_invalid" {
				t.Fatalf("отказ %v/%q, want iban_invalid", code, reason)
			}
			if got := errorParams(t, err)["reason"]; got != c.reason {
				t.Fatalf("reason = %q, want %q", got, c.reason)
			}
		})
	}

	// Аудит: первый счёт {set:false}→{set:true}, смена {set:true}→{set:true}; тот же счёт
	// ещё раз журнал не пишет. Значений в аудите нет.
	events := h.auditOf(u.ID.String(), "executor.payout_iban_changed")
	if len(events) != len(valid)+1 {
		t.Fatalf("аудит: %d, want %d", len(events), len(valid)+1)
	}
	var before, after map[string]bool
	if err := json.Unmarshal([]byte(events[0].GetBeforeJson()), &before); err != nil || before["set"] {
		t.Fatalf("первый: before = %s", events[0].GetBeforeJson())
	}
	if err := json.Unmarshal([]byte(events[1].GetBeforeJson()), &before); err != nil || !before["set"] {
		t.Fatalf("смена: before = %s", events[1].GetBeforeJson())
	}
	for _, e := range events {
		if err := json.Unmarshal([]byte(e.GetAfterJson()), &after); err != nil || !after["set"] {
			t.Fatalf("after = %s", e.GetAfterJson())
		}
		noValues(t, e, valid...)
		noValues(t, e, "0100", "0001")
	}

	// Нет стороны — party_missing; активна не роль исполнителя — role_forbidden.
	_, noParty := h.executor()
	_, err := h.setPayoutIban(noParty, valid[0], h.key())
	h.wantRefusal(err, connect.CodeFailedPrecondition, "party_missing")
	_, clientToken := h.client()
	_, err = h.setPayoutIban(clientToken, valid[0], h.key())
	h.wantRefusal(err, connect.CodePermissionDenied, "role_forbidden")
}

// Прежний счёт не расшифровывается (повреждён или перенесён из чужой строки): считается
// неизвестным, новый записывается; в логе — только kid и user_id.
func TestSetPayoutIbanDamagedPrevious(t *testing.T) {
	h := newHarness(t, nil)
	a, tokenA, _, _ := h.tooParty()
	b, tokenB, _, _ := h.tooParty()
	const ibanA, ibanB, ibanNew = "KZ86125KZT5004100100", "KZ75125KZT2069100100", "KZ18722S000012345678"
	for _, c := range []struct{ token, iban string }{{tokenA, ibanA}, {tokenB, ibanB}} {
		if _, err := h.setPayoutIban(c.token, c.iban, h.key()); err != nil {
			t.Fatal(err)
		}
	}
	rowB, _ := h.partyRow(b.ID)
	if _, err := h.pool.Exec(context.Background(), `UPDATE parties SET payout_iban_enc = $2 WHERE user_id = $1`, a.ID, rowB.PayoutIbanEnc.String); err != nil {
		t.Fatal(err)
	}

	res, err := h.setPayoutIban(tokenA, ibanNew, h.key())
	if err != nil {
		t.Fatalf("SetPayoutIban поверх повреждённого: %v", err)
	}
	if res.GetParty().GetPayoutIbanLast4() != ibanNew[16:] || !res.GetChanged() {
		t.Fatalf("changed = %v, party = %v", res.GetChanged(), res.GetParty())
	}
	row, _ := h.partyRow(a.ID)
	if got := h.open(row.PayoutIbanEnc.String, "identity.parties.payout_iban:"+a.ID.String()); got != ibanNew {
		t.Fatalf("payout_iban = %q", got)
	}
	logs := h.logs.String()
	if !strings.Contains(logs, a.ID.String()) || !strings.Contains(logs, "test-1") {
		t.Fatalf("в логе нет kid и user_id:\n%s", logs)
	}
	for _, v := range []string{ibanA, ibanB, ibanNew} {
		if strings.Contains(logs, v) {
			t.Fatalf("в логе значение счёта %s", v)
		}
	}
	if n := len(h.auditOf(a.ID.String(), "executor.payout_iban_changed")); n != 2 {
		t.Fatalf("аудит: %d, want 2", n)
	}
}

func TestVerifySignerIin(t *testing.T) {
	h := newHarness(t, nil)
	match := func(userID uuid.UUID, iin string, side identityv1.SigningSide) bool {
		t.Helper()
		res, err := h.verifySigner(userID.String(), iin, side)
		if err != nil {
			t.Fatalf("VerifySignerIin: %v", err)
		}
		return res.GetMatches()
	}

	// Исполнитель-ТОО — директор своим ИИН; БИН и чужой ИИН не совпадают.
	too, _, bin, director := h.tooParty()
	if !match(too.ID, director, sideExecutor) || match(too.ID, freshIIN(t), sideExecutor) || match(too.ID, bin, sideExecutor) {
		t.Fatal("ТОО: сверка ИИН директора")
	}

	// Исполнитель-ИП — по своему ИИН (ИИН личности, он же ИИН/БИН стороны).
	ip, ipToken := h.executor()
	own := freshIIN(t)
	h.mustRecordPerson(ipToken, testFullName, own)
	h.mustRegisterParty(&identityv1.RegisterPartyRequest{SessionToken: ipToken, LegalForm: formIP, LegalName: "ИП «Дала»", SignerFullName: ownerName})
	if !match(ip.ID, own, sideExecutor) || match(ip.ID, freshIIN(t), sideExecutor) {
		t.Fatal("ИП: сверка своего ИИН")
	}

	// Заказчик — ИИН личности; как исполнитель без стороны — не совпало.
	client, clientToken := h.client()
	clientIIN := freshIIN(t)
	h.mustRecordPerson(clientToken, testFullName, clientIIN)
	if !match(client.ID, clientIIN, sideClient) || match(client.ID, own, sideClient) || match(client.ID, clientIIN, sideExecutor) {
		t.Fatal("заказчик: сверка ИИН личности")
	}

	// Две роли: заказчик со своим ТОО подписывает как заказчик — своим ИИН, а не ИИН
	// директора; как исполнитель — ИИН директора.
	dual := h.user([]string{"CLIENT", "EXECUTOR"}, "CLIENT")
	dualToken := h.session(dual)
	dualIIN, dualDirector := freshIIN(t), freshIIN(t)
	h.mustRecordPerson(dualToken, testFullName, dualIIN)
	h.mustRegisterParty(&identityv1.RegisterPartyRequest{
		SessionToken: dualToken, LegalForm: formTOO, LegalName: "ТОО «Своё»", BinIin: freshBIN(t),
		SignerFullName: directorName, SignerIin: dualDirector,
	})
	if !match(dual.ID, dualIIN, sideClient) || match(dual.ID, dualDirector, sideClient) {
		t.Fatal("две роли, заказчик: сверка по ИИН личности")
	}
	if !match(dual.ID, dualDirector, sideExecutor) || match(dual.ID, dualIIN, sideExecutor) {
		t.Fatal("две роли, исполнитель: сверка по ИИН директора")
	}

	// Нет ни стороны, ни ИИН, неизвестный пользователь, неверный формат — не совпало.
	bare, _ := h.client()
	if match(bare.ID, clientIIN, sideClient) || match(uuid.New(), clientIIN, sideClient) || match(uuid.New(), director, sideExecutor) ||
		match(client.ID, "12345", sideClient) {
		t.Fatal("совпадение без данных")
	}
	_, err := h.verifySigner("not-a-uuid", clientIIN, sideClient)
	h.wantRefusal(err, connect.CodeInvalidArgument, "invalid_request")
	for _, side := range []identityv1.SigningSide{identityv1.SigningSide_SIGNING_SIDE_UNSPECIFIED, 99} {
		_, err = h.verifySigner(client.ID.String(), clientIIN, side)
		h.wantRefusal(err, connect.CodeInvalidArgument, "invalid_request")
	}

	// Без раскрытия и без аудита.
	for _, id := range []uuid.UUID{too.ID, ip.ID, client.ID, dual.ID} {
		for _, e := range outboxEvents(h, subjectAudit, func() *eventsv1.AuditEvent { return &eventsv1.AuditEvent{} }) {
			if e.GetEntityId() == id.String() && strings.Contains(e.GetAction(), "signer") {
				t.Fatalf("аудит сверки: %v", e)
			}
		}
	}
}

func TestGetProfileReturnsParty(t *testing.T) {
	h := newHarness(t, nil)
	_, token, bin, director := h.tooParty()
	res, err := h.getProfile(token)
	if err != nil {
		t.Fatal(err)
	}
	p := res.GetParty()
	if p == nil || p.GetLegalForm() != formTOO || p.GetBinIinLast4() != bin[8:] || p.GetSignerIinLast4() != director[8:] {
		t.Fatalf("party = %v", p)
	}
	if strings.Contains(prototext.Format(res), bin) || strings.Contains(prototext.Format(res), director) {
		t.Fatal("в профиле открытые номера")
	}
	_, clientToken := h.client()
	res, err = h.getProfile(clientToken)
	if err != nil || res.GetParty() != nil {
		t.Fatalf("у заказчика сторона: %v, %v", res.GetParty(), err)
	}
}

func TestSeedUsersWritesParty(t *testing.T) {
	h := newHarness(t, nil)
	bin, director, iin := freshBIN(t), freshIIN(t), freshIIN(t)
	too := seedUser(newPhone(), roleExecutor, true, roleExecutor)
	too.Party = &identityv1.SeedParty{
		LegalForm: formTOO, LegalName: "ТОО «Демо»", BinIin: bin, SignerFullName: directorName, SignerIin: director,
		PayoutIban: "KZ86125KZT5004100100", KycStatus: identityv1.KycStatus_KYC_STATUS_VERIFIED,
	}
	ip := seedUser(newPhone(), roleExecutor, true, roleExecutor, roleClient)
	ip.FullName, ip.Iin = testFullName, iin
	ip.Party = &identityv1.SeedParty{LegalForm: formIP, LegalName: "ИП «Демо»", SignerFullName: ownerName}
	res, err := h.seed(too, ip)
	if err != nil {
		t.Fatalf("SeedUsers: %v", err)
	}
	tooID, ipID := uuid.MustParse(res.GetUsers()[0].GetId()), uuid.MustParse(res.GetUsers()[1].GetId())
	row, ok := h.partyRow(tooID)
	if !ok || row.KycStatus != "VERIFIED" || row.PayoutIbanLast4.String != "0100" || row.SignerIinLast4.String != director[8:] {
		t.Fatalf("ТОО: %+v", row)
	}
	if h.open(row.PayoutIbanEnc.String, "identity.parties.payout_iban:"+tooID.String()) != "KZ86125KZT5004100100" ||
		h.open(row.BinIinEnc, "identity.parties.bin_iin:"+tooID.String()) != bin {
		t.Fatal("ТОО: шифртексты")
	}
	row, ok = h.partyRow(ipID)
	if !ok || row.KycStatus != "NOT_SUBMITTED" || h.open(row.BinIinEnc, "identity.parties.bin_iin:"+ipID.String()) != iin {
		t.Fatalf("ИП — ИИН личности сида: %+v", row)
	}

	// Повтор сида перезаписывает сторону; сторона без роли исполнителя и неверные
	// реквизиты отклоняются.
	too.Party.KycStatus = identityv1.KycStatus_KYC_STATUS_PENDING
	if _, err := h.seed(too); err != nil {
		t.Fatalf("повтор сида: %v", err)
	}
	if row, _ = h.partyRow(tooID); row.KycStatus != "PENDING" {
		t.Fatalf("повтор сида: kyc_status = %s", row.KycStatus)
	}
	client := seedUser(newPhone(), roleClient, true, roleClient)
	client.Party = &identityv1.SeedParty{LegalForm: formTOO, LegalName: "ТОО «Демо»", BinIin: freshBIN(t), SignerFullName: directorName, SignerIin: director}
	_, err = h.seed(client)
	h.wantRefusal(err, connect.CodeInvalidArgument, "invalid_request")
	bad := seedUser(newPhone(), roleExecutor, true, roleExecutor)
	bad.Party = &identityv1.SeedParty{LegalForm: formTOO, LegalName: "ТОО «Демо»", BinIin: freshBIN(t), SignerFullName: directorName, SignerIin: director, PayoutIban: "KZ86125KZT5004100101"}
	_, err = h.seed(bad)
	h.wantRefusal(err, connect.CodeInvalidArgument, "iban_invalid")
	taken := seedUser(newPhone(), roleExecutor, true, roleExecutor)
	taken.Party = &identityv1.SeedParty{LegalForm: formTOO, LegalName: "ТОО «Демо»", BinIin: bin, SignerFullName: directorName, SignerIin: director}
	_, err = h.seed(taken)
	h.wantRefusal(err, connect.CodeAlreadyExists, "iin_taken")
}
