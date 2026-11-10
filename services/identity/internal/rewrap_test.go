package internal

import (
	"bytes"
	"context"
	"encoding/base64"
	"strings"
	"testing"

	"github.com/google/uuid"

	"github.com/CemeteryPlaya/senim-platform/pkg/pii"
)

// Ключи теста перешифровки: test-1 — ключ остальных тестов пакета (testKeyring).
var (
	rewrapK1    = bytes.Repeat([]byte{0x31}, 32)
	rewrapK2    = bytes.Repeat([]byte{0x32}, 32)
	rewrapTest1 = bytes.Repeat([]byte{5}, 32)
)

func kek(kid string, key []byte) string { return kid + ":" + base64.StdEncoding.EncodeToString(key) }

// rewrapCmd выполняет identity rewrap-pii с набором ключей keks и текущим current.
func rewrapCmd(t *testing.T, current, keks string, args ...string) (int, string) {
	t.Helper()
	vars := map[string]string{
		"APP_ENV": "dev", "IDENTITY_APP_DSN": pgEnv.AppDSN("identity"),
		"PII_KEKS": keks, "PII_KEK_CURRENT": current,
	}
	var logs bytes.Buffer
	code := Main(context.Background(), append([]string{"rewrap-pii"}, args...), func(k string) (string, bool) { v, ok := vars[k]; return v, ok }, &logs)
	return code, logs.String()
}

func (h *harness) setPersonIINEnc(userID uuid.UUID, enc string) {
	h.t.Helper()
	if _, err := h.pool.Exec(context.Background(), `UPDATE persons SET iin_enc = $2 WHERE user_id = $1`, userID, enc); err != nil {
		h.t.Fatal(err)
	}
}

// encValues — все шифртексты ПДн в базе.
func (h *harness) encValues() []string {
	h.t.Helper()
	rows, err := h.pool.Query(context.Background(), `
		SELECT iin_enc FROM persons WHERE iin_enc IS NOT NULL
		UNION ALL SELECT bin_iin_enc FROM parties
		UNION ALL SELECT signer_iin_enc FROM parties WHERE signer_iin_enc IS NOT NULL
		UNION ALL SELECT payout_iban_enc FROM parties WHERE payout_iban_enc IS NOT NULL
		UNION ALL SELECT secret_enc FROM mfa_factors`)
	if err != nil {
		h.t.Fatal(err)
	}
	defer rows.Close()
	var out []string
	for rows.Next() {
		var s string
		if err := rows.Scan(&s); err != nil {
			h.t.Fatal(err)
		}
		out = append(out, s)
	}
	if err := rows.Err(); err != nil {
		h.t.Fatal(err)
	}
	return out
}

func TestRewrapMovesToCurrentKID(t *testing.T) {
	// Данные под k1: личность, сторона ТОО со счётом, секрет TOTP.
	k1, err := pii.NewKeyring("k1", map[string][]byte{"k1": rewrapK1})
	if err != nil {
		t.Fatal(err)
	}
	h := newHarness(t, func(c *ServeConfig) { c.PII = k1 })
	client, clientToken := h.client()
	iin := freshIIN(t)
	h.mustRecordPerson(clientToken, testFullName, iin)
	master, masterToken, bin, director := h.tooParty()
	const iban = "KZ86125KZT5004100100"
	if _, err := h.setPayoutIban(masterToken, iban, h.key()); err != nil {
		t.Fatal(err)
	}
	op, opToken := h.operator()
	secret := h.mustStart(opToken)
	// Испорченная строка: ИИН заказчика перенесён в строку другого человека.
	victim, victimToken := h.client()
	h.mustRecordPerson(victimToken, testFullName, freshIIN(t))
	victimRow, _ := h.personRow(victim.ID)
	clientRow, _ := h.personRow(client.ID)
	h.setPersonIINEnc(victim.ID, clientRow.IinEnc.String)
	for _, v := range h.encValues() {
		if kid, err := k1.KIDOf(v); err != nil || (kid != "k1" && kid != "test-1") {
			t.Fatalf("до перешифровки: kid %q, %v", kid, err)
		}
	}

	// Текущий k2, k1 и test-1 (данные других тестов) ещё в наборе. Пачка по 2 — несколько
	// транзакций на таблицу.
	all := kek("k2", rewrapK2) + "," + kek("k1", rewrapK1) + "," + kek("test-1", rewrapTest1)
	// Остальные тесты пакета читают своё под test-1: в конце вернуть всё на test-1.
	t.Cleanup(func() {
		if code, logs := rewrapCmd(t, "test-1", all); code != 0 {
			t.Errorf("обратная перешифровка: код %d\n%s", code, logs)
		}
	})

	// Испорченная строка не останавливает остальные: она остаётся под прежним ключом,
	// названа в логе (без значений), код выхода 1.
	code, logs := rewrapCmd(t, "k2", all, "--batch", "2")
	if code != 1 || !strings.Contains(logs, victim.ID.String()) || !strings.Contains(logs, "iin_enc") {
		t.Fatalf("rewrap-pii с испорченной строкой: код %d\n%s", code, logs)
	}
	for _, v := range h.encValues() {
		if !strings.HasPrefix(v, "v2.k2.") && v != clientRow.IinEnc.String {
			t.Fatalf("после перешифровки не под k2: %.12s…", v)
		}
	}
	if strings.Contains(logs, iin) || strings.Contains(logs, bin) || strings.Contains(logs, iban) {
		t.Fatalf("значения в логе:\n%s", logs)
	}

	// Строка исправлена — повтор переводит и её.
	h.setPersonIINEnc(victim.ID, victimRow.IinEnc.String)
	code, logs = rewrapCmd(t, "k2", all, "--batch", "2")
	if code != 0 {
		t.Fatalf("rewrap-pii: код %d\n%s", code, logs)
	}
	for _, table := range []string{"persons", "parties", "mfa_factors"} {
		if !strings.Contains(logs, table) {
			t.Fatalf("в выводе нет числа по таблице %s:\n%s", table, logs)
		}
	}
	for _, v := range h.encValues() {
		if !strings.HasPrefix(v, "v2.k2.") {
			t.Fatalf("после перешифровки не под k2: %.12s…", v)
		}
	}
	// Значения те же: читаются ключом k2 с теми же AAD.
	k2, err := pii.NewKeyring("k2", map[string][]byte{"k2": rewrapK2})
	if err != nil {
		t.Fatal(err)
	}
	open := func(blob, aad string) string {
		t.Helper()
		plain, err := k2.Open(blob, aad)
		if err != nil {
			t.Fatalf("%s: %v", aad, err)
		}
		return string(plain)
	}
	person, _ := h.personRow(client.ID)
	party, _ := h.partyRow(master.ID)
	factor, _ := h.factor(op.ID.String())
	if open(person.IinEnc.String, "identity.persons.iin:"+client.ID.String()) != iin ||
		open(party.BinIinEnc, "identity.parties.bin_iin:"+master.ID.String()) != bin ||
		open(party.SignerIinEnc.String, "identity.parties.signer_iin:"+master.ID.String()) != director ||
		open(party.PayoutIbanEnc.String, "identity.parties.payout_iban:"+master.ID.String()) != iban ||
		open(factor.SecretEnc, "identity.mfa_factors.secret:"+op.ID.String()) != string(secret) {
		t.Fatal("значения изменились после перешифровки")
	}

	// Повтор — нечего перешифровывать; без ключа старых данных — ошибка с именем kid.
	if code, logs := rewrapCmd(t, "k2", kek("k2", rewrapK2)); code != 0 {
		t.Fatalf("повтор: код %d\n%s", code, logs)
	}
	if code, _ := rewrapCmd(t, "k2", all, "--batch", "0"); code == 0 {
		t.Fatal("--batch 0 принят")
	}
	if code, _ := rewrapCmd(t, "k2", all, "лишний"); code == 0 {
		t.Fatal("лишний аргумент принят")
	}
	if code, _ := rewrapCmd(t, "", ""); code == 0 {
		t.Fatal("без ключей принято")
	}
}

func TestServeRefusesMissingKID(t *testing.T) {
	h := newHarness(t, nil)
	// В базе есть шифртекст под test-1 (ключ тестов).
	_, token := h.client()
	h.mustRecordPerson(token, testFullName, freshIIN(t))

	// Проверка видит kid базы и называет отсутствующий.
	ctx := context.Background()
	if err := checkPIIKeys(ctx, h.pool, testKeyring(t)); err != nil {
		t.Fatalf("все kid известны: %v", err)
	}
	other, err := pii.NewKeyring("other", map[string][]byte{"other": rewrapK2})
	if err != nil {
		t.Fatal(err)
	}
	if err := checkPIIKeys(ctx, h.pool, other); err == nil || !strings.Contains(err.Error(), `"test-1"`) || !strings.Contains(err.Error(), "PII_KEKS") {
		t.Fatalf("неизвестный kid: %v", err)
	}

	// serve не стартует: ошибка называет kid, сервис выходит до NATS и gRPC.
	vars := serveVars()
	vars["IDENTITY_APP_DSN"] = pgEnv.AppDSN("identity")
	vars["PII_KEKS"] = kek("other", rewrapK2)
	vars["PII_KEK_CURRENT"] = "other"
	var logs bytes.Buffer
	code := Main(ctx, []string{"serve"}, func(k string) (string, bool) { v, ok := vars[k]; return v, ok }, &logs)
	if code != 1 || !strings.Contains(logs.String(), `test-1`) || !strings.Contains(logs.String(), "pii_key_unknown") {
		t.Fatalf("serve: код %d\n%s", code, logs.String())
	}
	if strings.Contains(logs.String(), "nats") {
		t.Fatalf("serve дошёл до NATS:\n%s", logs.String())
	}
}
