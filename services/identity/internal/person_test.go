package internal

import (
	"bytes"
	"context"
	"errors"
	"fmt"
	"math/rand/v2"
	"strings"
	"sync"
	"testing"
	"time"

	"connectrpc.com/connect/v2"
	"github.com/google/uuid"
	"google.golang.org/protobuf/encoding/prototext"
	"google.golang.org/protobuf/proto"

	identityv1 "github.com/CemeteryPlaya/senim-platform/gen/go/senim/identity/v1"
	"github.com/CemeteryPlaya/senim-platform/gen/go/senim/identity/v1/identityv1connect"
	"github.com/CemeteryPlaya/senim-platform/pkg/pii"
	"github.com/CemeteryPlaya/senim-platform/services/identity/internal/store"
)

const testFullName = "Сапаров Ерлан"

// freshIIN — случайный верный ИИН: база общая для тестов пакета и переживает -count=2,
// поэтому номер не повторяется между тестами и прогонами.
func freshIIN(t *testing.T) string {
	t.Helper()
	for range 1000 {
		first11 := fmt.Sprintf("%02d%02d%02d%d%04d", rand.IntN(100), 1+rand.IntN(12), 1+rand.IntN(28), 3+rand.IntN(4), rand.IntN(10000)) //nolint:gosec // тестовые номера, не секрет
		if d := kzCheckDigit(first11); d >= 0 {
			iin := fmt.Sprintf("%s%d", first11, d)
			if !validIIN(iin) {
				t.Fatalf("freshIIN: %s не прошёл проверку", iin)
			}
			return iin
		}
	}
	t.Fatal("freshIIN: не нашлось номера")
	return ""
}

func (h *harness) recordPerson(token, fullName, iin, key string) (*identityv1.RecordPersonResponse, error) {
	h.t.Helper()
	return idc(h, "web", func(ctx context.Context, c identityv1connect.IdentityServiceClient) (*identityv1.RecordPersonResponse, error) {
		return c.RecordPerson(ctx, &identityv1.RecordPersonRequest{SessionToken: token, FullName: fullName, Iin: iin, IdempotencyKey: key})
	})
}

func (h *harness) mustRecordPerson(token, fullName, iin string) *identityv1.Person {
	h.t.Helper()
	res, err := h.recordPerson(token, fullName, iin, h.key())
	if err != nil {
		h.t.Fatalf("RecordPerson: %v", err)
	}
	return res.GetPerson()
}

func (h *harness) updateContacts(token, instagram, email, key string) (*identityv1.UpdateContactsResponse, error) {
	h.t.Helper()
	return idc(h, "web", func(ctx context.Context, c identityv1connect.IdentityServiceClient) (*identityv1.UpdateContactsResponse, error) {
		return c.UpdateContacts(ctx, &identityv1.UpdateContactsRequest{SessionToken: token, Instagram: instagram, Email: email, IdempotencyKey: key})
	})
}

func (h *harness) getProfile(token string) (*identityv1.GetProfileResponse, error) {
	h.t.Helper()
	return idc(h, "web", func(ctx context.Context, c identityv1connect.IdentityServiceClient) (*identityv1.GetProfileResponse, error) {
		return c.GetProfile(ctx, &identityv1.GetProfileRequest{SessionToken: token})
	})
}

// client — заказчик и его сессия.
func (h *harness) client() (store.User, string) {
	h.t.Helper()
	u := h.user([]string{"CLIENT"}, "CLIENT")
	return u, h.session(u)
}

// personRow — строка persons; ok=false, если строки нет.
func (h *harness) personRow(userID uuid.UUID) (store.Person, bool) {
	h.t.Helper()
	p, err := h.q.GetPerson(context.Background(), userID)
	if err != nil {
		return p, false
	}
	return p, true
}

func TestRecordPerson(t *testing.T) {
	h := newHarness(t, nil)
	u, token := h.client()
	iin := freshIIN(t)

	res, err := h.recordPerson(token, "  Сапаров  Ерлан ", iin, h.key())
	if err != nil {
		t.Fatalf("RecordPerson: %v", err)
	}
	want := &identityv1.Person{UserId: u.ID.String(), FullName: testFullName, IinLast4: iin[8:]}
	if !proto.Equal(res.GetPerson(), want) {
		t.Fatalf("person = %v, want %v", res.GetPerson(), want)
	}
	if strings.Contains(prototext.Format(res), iin) {
		t.Fatal("в ответе открытый ИИН")
	}

	row, ok := h.personRow(u.ID)
	if !ok {
		t.Fatal("строки persons нет")
	}
	if !strings.HasPrefix(row.IinEnc.String, "v2.") || strings.Contains(row.IinEnc.String, iin) {
		t.Fatalf("iin_enc = %q: ожидался шифртекст v2.", row.IinEnc.String)
	}
	if row.IinLast4.String != iin[8:] || row.FullName.String != testFullName {
		t.Fatalf("iin_last4 = %q, full_name = %q", row.IinLast4.String, row.FullName.String)
	}
	if !bytes.Equal(row.IinHash, pii.NewIndex(testIndexKey).Of(pii.DomainIIN, iin)) {
		t.Fatal("iin_hash — не слепой индекс домена iin")
	}
	plain, err := h.svc.cfg.PII.Open(row.IinEnc.String, "identity.persons.iin:"+u.ID.String())
	if err != nil || string(plain) != iin {
		t.Fatalf("расшифровка: %q, %v", plain, err)
	}

	events := h.auditOf(u.ID.String(), "user.identity.recorded")
	if len(events) != 1 {
		t.Fatalf("событий аудита %d, want 1", len(events))
	}
	e := events[0]
	if e.GetActorId() != u.ID.String() || e.GetActorRole() != "CLIENT" || e.GetEntityType() != "user" {
		t.Fatalf("аудит: %v", e)
	}
	for _, s := range []string{e.GetBeforeJson(), e.GetAfterJson()} {
		if strings.Contains(s, iin) || strings.Contains(s, iin[8:]) || strings.Contains(s, "Сапаров") {
			t.Fatalf("в аудите значения: %q", s)
		}
	}

	prof, err := h.getProfile(token)
	if err != nil {
		t.Fatalf("GetProfile: %v", err)
	}
	if !proto.Equal(prof.GetPerson(), want) || prof.GetParty() != nil {
		t.Fatalf("GetProfile = %v", prof)
	}
}

func TestRecordPersonSameIINIdempotent(t *testing.T) {
	h := newHarness(t, nil)
	u, token := h.client()
	iin := freshIIN(t)
	key := h.key()
	first, err := h.recordPerson(token, testFullName, iin, key)
	if err != nil {
		t.Fatalf("RecordPerson: %v", err)
	}
	// Повтор по тому же ключу — тот же ответ.
	again, err := h.recordPerson(token, testFullName, iin, key)
	if err != nil || !proto.Equal(again, first) {
		t.Fatalf("повтор по ключу: %v, %v", again, err)
	}
	// Тот же ИИН с новым ключом (повторная отправка формы) — тот же ответ, ФИО не меняется.
	same, err := h.recordPerson(token, "Другой Человек", iin, h.key())
	if err != nil || !proto.Equal(same, first) {
		t.Fatalf("тот же ИИН: %v, %v; want %v", same, err, first)
	}
	if n := len(h.auditOf(u.ID.String(), "user.identity.recorded")); n != 1 {
		t.Fatalf("событий аудита %d, want 1", n)
	}
	// Тот же ключ с другим запросом — idempotency_key_reused.
	_, err = h.recordPerson(token, testFullName, freshIIN(t), key)
	h.wantRefusal(err, connect.CodeInvalidArgument, "idempotency_key_reused")
}

func TestRecordPersonOtherIIN(t *testing.T) {
	h := newHarness(t, nil)
	u, token := h.client()
	iin := freshIIN(t)
	h.mustRecordPerson(token, testFullName, iin)
	before, _ := h.personRow(u.ID)

	_, err := h.recordPerson(token, "Другой Человек", freshIIN(t), h.key())
	h.wantRefusal(err, connect.CodeFailedPrecondition, "person_already_recorded")

	after, _ := h.personRow(u.ID)
	if after.IinEnc != before.IinEnc || after.FullName != before.FullName || !bytes.Equal(after.IinHash, before.IinHash) {
		t.Fatal("личность изменилась")
	}
	if n := len(h.auditOf(u.ID.String(), "user.identity.recorded")); n != 1 {
		t.Fatalf("событий аудита %d, want 1", n)
	}
}

func TestRecordPersonValidation(t *testing.T) {
	h := newHarness(t, nil)
	u, token := h.client()
	iin := freshIIN(t)
	d := int(iin[11] - '0')
	broken := iin[:11] + fmt.Sprint((d+1)%10)

	_, err := h.recordPerson(token, testFullName, broken, h.key())
	h.wantRefusal(err, connect.CodeInvalidArgument, "iin_invalid")
	_, err = h.recordPerson(token, "Ерлан", iin, h.key())
	h.wantRefusal(err, connect.CodeInvalidArgument, "full_name_invalid")
	_, err = h.recordPerson(token, testFullName, iin, "")
	h.wantRefusal(err, connect.CodeInvalidArgument, "invalid_request")
	_, err = h.recordPerson(newToken(t), testFullName, iin, h.key())
	h.wantRefusal(err, connect.CodeUnauthenticated, "session_invalid")
	if _, ok := h.personRow(u.ID); ok {
		t.Fatal("строка persons появилась после отказов")
	}
}

// ИИН другого аккаунта — iin_taken; перебор ограничен пятью попытками в час
// (limitIdentityAttempts): шестая — person_too_many_attempts.
func TestRecordPersonIINTakenAndLimit(t *testing.T) {
	h := newHarness(t, nil)
	_, ownerToken := h.client()
	iin := freshIIN(t)
	h.mustRecordPerson(ownerToken, testFullName, iin)

	prober, proberToken := h.client()
	for i := range personMaxAttempts {
		_, err := h.recordPerson(proberToken, testFullName, iin, h.key())
		if code, reason := refusal(t, err); code != connect.CodeAlreadyExists || reason != "iin_taken" {
			t.Fatalf("попытка %d: %v/%q, want iin_taken", i+1, code, reason)
		}
	}
	_, err := h.recordPerson(proberToken, testFullName, iin, h.key())
	h.wantRefusal(err, connect.CodeResourceExhausted, "person_too_many_attempts")
	// И свободный ИИН — тоже: лимит на пользователя, а не на номер.
	_, err = h.recordPerson(proberToken, testFullName, freshIIN(t), h.key())
	h.wantRefusal(err, connect.CodeResourceExhausted, "person_too_many_attempts")

	// Через час окно сбрасывается.
	h.clock.advance(personAttemptWindow + time.Second)
	token := h.session(prober) // часы ушли вперёд: прежняя сессия истекла по простою
	if _, err := h.recordPerson(token, testFullName, freshIIN(t), h.key()); err != nil {
		t.Fatalf("после окна: %v", err)
	}
}

// Неверный формат не тратит попытки: номер не проверяется по базе, перебора нет.
func TestRecordPersonInvalidFormatNotCounted(t *testing.T) {
	h := newHarness(t, nil)
	_, token := h.client()
	for range personMaxAttempts + 2 {
		_, err := h.recordPerson(token, testFullName, "123", h.key())
		h.wantRefusal(err, connect.CodeInvalidArgument, "iin_invalid")
	}
	h.mustRecordPerson(token, testFullName, freshIIN(t))
}

// Два человека одновременно записывают один ИИН: ровно один успех и один iin_taken, не
// Internal (уникальный iin_hash, конфликт 23505).
func TestRecordPersonIINTakenRace(t *testing.T) {
	h := newHarness(t, nil)
	for round := range 5 {
		iin := freshIIN(t)
		_, tokenA := h.client()
		_, tokenB := h.client()
		start := make(chan struct{})
		errs := make([]error, 2)
		var wg sync.WaitGroup
		for i, token := range []string{tokenA, tokenB} {
			key := h.key()
			wg.Add(1)
			go func() {
				defer wg.Done()
				<-start
				_, errs[i] = h.recordPerson(token, testFullName, iin, key)
			}()
		}
		close(start)
		wg.Wait()
		ok, taken := 0, 0
		for _, err := range errs {
			if err == nil {
				ok++
				continue
			}
			code, reason := callerRefusal(err)
			if code == connect.CodeAlreadyExists && reason == "iin_taken" {
				taken++
			} else {
				t.Errorf("раунд %d: %v", round, err)
			}
		}
		if ok != 1 || taken != 1 {
			t.Fatalf("раунд %d: успехов %d, iin_taken %d; want 1 и 1", round, ok, taken)
		}
		if n := h.count(`SELECT count(*) FROM persons WHERE iin_hash = $1`, pii.NewIndex(testIndexKey).Of(pii.DomainIIN, iin)); n != 1 {
			t.Fatalf("раунд %d: строк с этим ИИН %d", round, n)
		}
	}
}

// Шифртекст ИИН пользователя A, перенесённый в строку B, для B не расшифровывается (AAD
// с user_id).
func TestRecordPersonSwappedCiphertext(t *testing.T) {
	h := newHarness(t, nil)
	a, tokenA := h.client()
	b, tokenB := h.client()
	h.mustRecordPerson(tokenA, testFullName, freshIIN(t))
	h.mustRecordPerson(tokenB, "Иван Петров", freshIIN(t))
	rowA, _ := h.personRow(a.ID)
	if _, err := h.pool.Exec(context.Background(), `UPDATE persons SET iin_enc = $2 WHERE user_id = $1`, b.ID, rowA.IinEnc.String); err != nil {
		t.Fatal(err)
	}
	rowB, _ := h.personRow(b.ID)
	_, err := h.svc.cfg.PII.Open(rowB.IinEnc.String, personIINAAD(b.ID))
	if !errors.Is(err, pii.ErrAuth) {
		t.Fatalf("расшифровка чужого шифртекста: %v, want ErrAuth", err)
	}
}

// Instagram — те же случаи, что в apps/web/src/modules/identity/instagram.test.ts; e-mail —
// правила contacts-profile.ts.
func TestUpdateContactsValidation(t *testing.T) {
	h := newHarness(t, nil)
	u, token := h.client()

	for _, c := range []struct{ raw, want string }{
		{"dala_mebel", "dala_mebel"},
		{"@dala.mebel", "dala.mebel"},
		{"  @Aigerim.Home_2  ", "Aigerim.Home_2"},
		{"a", "a"},
		{strings.Repeat("x", instagramMax), strings.Repeat("x", instagramMax)},
		{"", ""},
		{"   ", ""},
		{"@", ""},
	} {
		res, err := h.updateContacts(token, c.raw, "", h.key())
		if err != nil {
			t.Fatalf("instagram %q: %v", c.raw, err)
		}
		if res.GetPerson().GetInstagram() != c.want || res.GetPerson().GetUserId() != u.ID.String() {
			t.Fatalf("instagram %q → %v, want %q", c.raw, res.GetPerson(), c.want)
		}
	}
	h.mustUpdateContacts(token, "dala", "")
	for _, raw := range []string{
		"дала_мебель", "dala mebel", "dala-mebel", "https://instagram.com/dala", "@@dala", "dala@mebel",
	} {
		_, err := h.updateContacts(token, raw, "", h.key())
		h.wantRefusal(err, connect.CodeInvalidArgument, "instagram_invalid")
	}
	_, err := h.updateContacts(token, strings.Repeat("x", instagramMax+1), "", h.key())
	h.wantRefusal(err, connect.CodeInvalidArgument, "instagram_invalid")
	if p := errorParams(t, err); p["max"] != "30" {
		t.Fatalf("params = %v, want max=30", p)
	}
	if row, _ := h.personRow(u.ID); row.Instagram.String != "dala" {
		t.Fatalf("после отказов instagram = %q", row.Instagram.String)
	}

	// E-mail: без пробелов по краям и в нижнем регистре; пусто — не указан.
	res := h.mustUpdateContacts(token, "dala", "  Aigerim@Example.KZ ")
	if res.GetEmail() != "aigerim@example.kz" || res.GetInstagram() != "dala" {
		t.Fatalf("e-mail: %v", res)
	}
	_, err = h.updateContacts(token, "dala", "не почта", h.key())
	h.wantRefusal(err, connect.CodeInvalidArgument, "email_invalid")
	if row, _ := h.personRow(u.ID); row.Email.String != "aigerim@example.kz" {
		t.Fatalf("после отказа email = %q", row.Email.String)
	}
	res = h.mustUpdateContacts(token, "dala", "")
	if res.GetEmail() != "" {
		t.Fatalf("пустой e-mail: %v", res)
	}
	if row, _ := h.personRow(u.ID); row.Email.Valid || !row.Instagram.Valid {
		t.Fatalf("строка: email %v, instagram %v", row.Email, row.Instagram)
	}
}

func (h *harness) mustUpdateContacts(token, instagram, email string) *identityv1.Person {
	h.t.Helper()
	res, err := h.updateContacts(token, instagram, email, h.key())
	if err != nil {
		h.t.Fatalf("UpdateContacts: %v", err)
	}
	return res.GetPerson()
}

// Аудит контактов — без значений (только «указан / не указан»); то же значение ещё раз
// журнал не пишет; ФИО и ИИН контакты не трогают.
func TestUpdateContactsAudit(t *testing.T) {
	h := newHarness(t, nil)
	u, token := h.client()
	iin := freshIIN(t)
	h.mustRecordPerson(token, testFullName, iin)

	p := h.mustUpdateContacts(token, "Dala.Mebel", "master@example.kz")
	if p.GetFullName() != testFullName || p.GetIinLast4() != iin[8:] {
		t.Fatalf("контакты стёрли личность: %v", p)
	}
	h.mustUpdateContacts(token, "Dala.Mebel", "master@example.kz")
	h.mustUpdateContacts(token, "", "master@example.kz")

	ig := h.auditOf(u.ID.String(), "user.instagram_changed")
	em := h.auditOf(u.ID.String(), "user.email_changed")
	if len(ig) != 2 || len(em) != 1 {
		t.Fatalf("аудит instagram %d (want 2), email %d (want 1)", len(ig), len(em))
	}
	if ig[0].GetBeforeJson() != `{"set":false}` || ig[0].GetAfterJson() != `{"set":true}` ||
		ig[1].GetBeforeJson() != `{"set":true}` || ig[1].GetAfterJson() != `{"set":false}` {
		t.Fatalf("instagram: %v", ig)
	}
	if em[0].GetBeforeJson() != `{"set":false}` || em[0].GetAfterJson() != `{"set":true}` {
		t.Fatalf("email: %v", em)
	}
	for _, e := range append(ig, em...) {
		if e.GetActorId() != u.ID.String() || e.GetActorRole() != "CLIENT" {
			t.Fatalf("аудит: %v", e)
		}
	}
}

// Контакты — у сторон сделки (заказчик, мастер); оператору поле не нужно — role_forbidden.
func TestUpdateContactsOperatorForbidden(t *testing.T) {
	h := newHarness(t, nil)
	u, token := h.operator()
	_, err := h.updateContacts(token, "dala", "", h.key())
	h.wantRefusal(err, connect.CodePermissionDenied, "role_forbidden")
	if _, ok := h.personRow(u.ID); ok {
		t.Fatal("строка persons появилась")
	}
}

func TestGetProfileWithoutPerson(t *testing.T) {
	h := newHarness(t, nil)
	u, token := h.client()
	res, err := h.getProfile(token)
	if err != nil {
		t.Fatalf("GetProfile: %v", err)
	}
	if !proto.Equal(res.GetPerson(), &identityv1.Person{UserId: u.ID.String()}) || res.GetParty() != nil {
		t.Fatalf("GetProfile = %v", res)
	}
	_, err = h.getProfile(newToken(t))
	h.wantRefusal(err, connect.CodeUnauthenticated, "session_invalid")
}

// Буфер логгера после RecordPerson (успех и отказы) не содержит ни ИИН, ни ФИО.
func TestNoPIIInLogs(t *testing.T) {
	h := newHarness(t, nil)
	_, token := h.client()
	_, other := h.client()
	iin := freshIIN(t)
	h.mustRecordPerson(token, testFullName, iin)
	h.mustRecordPerson(token, testFullName, iin)
	_, err := h.recordPerson(other, testFullName, iin, h.key())
	h.wantRefusal(err, connect.CodeAlreadyExists, "iin_taken")
	_, err = h.recordPerson(token, testFullName, freshIIN(t), h.key())
	h.wantRefusal(err, connect.CodeFailedPrecondition, "person_already_recorded")
	h.mustUpdateContacts(token, "dala.mebel", "master@example.kz")

	logs := h.logs.String()
	for _, s := range []string{iin, "Сапаров", "Ерлан", "dala.mebel", "master@example.kz"} {
		if strings.Contains(logs, s) {
			t.Fatalf("в логе %q:\n%s", s, logs)
		}
	}
}

// SeedUsers пишет личность из full_name/iin/instagram/email; неверный ИИН — iin_invalid.
func TestSeedUsersWritesPerson(t *testing.T) {
	h := newHarness(t, nil)
	iin := freshIIN(t)
	su := seedUser(newPhone(), roleClient, true, roleClient)
	su.FullName, su.Iin, su.Instagram, su.Email = "  Иван  Петров ", iin, "@Dala.Mebel", " Master@Example.KZ "
	plain := seedUser(newPhone(), roleClient, true, roleClient)
	res, err := h.seed(su, plain)
	if err != nil {
		t.Fatalf("SeedUsers: %v", err)
	}
	id := uuid.MustParse(res.GetUsers()[0].GetId())
	row, ok := h.personRow(id)
	if !ok {
		t.Fatal("личность не записана")
	}
	if row.FullName.String != "Иван Петров" || row.IinLast4.String != iin[8:] || row.Instagram.String != "Dala.Mebel" || row.Email.String != "master@example.kz" {
		t.Fatalf("строка: %+v", row)
	}
	if got, err := h.svc.cfg.PII.Open(row.IinEnc.String, personIINAAD(id)); err != nil || string(got) != iin {
		t.Fatalf("расшифровка: %q, %v", got, err)
	}
	if _, ok := h.personRow(uuid.MustParse(res.GetUsers()[1].GetId())); ok {
		t.Fatal("личность без полей записана")
	}
	// Повтор сида — без ошибок, данные те же.
	if _, err := h.seed(su); err != nil {
		t.Fatalf("повтор SeedUsers: %v", err)
	}

	bad := seedUser(newPhone(), roleClient, true, roleClient)
	bad.Iin = "123456789012"
	_, err = h.seed(bad)
	h.wantRefusal(err, connect.CodeInvalidArgument, "iin_invalid")
	bad.Iin, bad.Instagram = "", "дала"
	_, err = h.seed(bad)
	h.wantRefusal(err, connect.CodeInvalidArgument, "instagram_invalid")
}
