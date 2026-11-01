import { describe, expect, it } from "vitest";
import { hmacHex } from "@/platform/crypto";
import { escrowStatusOf } from "./escrow-status";
import { paymentModeOf, railModeOf, RAIL_MODES } from "./modes";
import { reconcileEntries, type JournalOperation } from "./reconcile-entries";
import { SIGNATURE_HEADER, signWebhook, TIMESTAMP_HEADER, verifyWebhookSignature } from "./webhook-signature";
import type { StatementEntry } from "./rail";

describe("подпись вебхука (HMAC-SHA256)", () => {
  const secret = "test-secret";
  const body = JSON.stringify({ eventId: "evt_1", amount: 100 });
  const now = new Date("2026-10-30T10:00:00Z");

  it("принимает подпись, сделанную тем же секретом", () => {
    const headers = new Headers(signWebhook(secret, body, now));
    expect(verifyWebhookSignature(secret, headers, body, now)).toBe(true);
  });

  it("отклоняет изменённое тело, чужой секрет и старую подпись", () => {
    const headers = new Headers(signWebhook(secret, body, now));
    expect(verifyWebhookSignature(secret, headers, body.replace("100", "999"), now)).toBe(false);
    expect(verifyWebhookSignature("other", headers, body, now)).toBe(false);
    const later = new Date(now.getTime() + 6 * 60_000);
    expect(verifyWebhookSignature(secret, headers, body, later)).toBe(false);
  });

  it("отклоняет запрос без заголовков подписи", () => {
    expect(verifyWebhookSignature(secret, new Headers(), body, now)).toBe(false);
  });
});

describe("статус счёта сделки", () => {
  const total = 1000;
  it.each([
    [{ deposited: 0, released: 0, refunded: 0 }, "OPENED"],
    [{ deposited: 400, released: 0, refunded: 0 }, "OPENED"],
    [{ deposited: 1000, released: 0, refunded: 0 }, "FUNDED"],
    [{ deposited: 1000, released: 300, refunded: 0 }, "PARTIALLY_RELEASED"],
    [{ deposited: 1000, released: 1000, refunded: 0 }, "CLOSED"],
    [{ deposited: 1000, released: 300, refunded: 700 }, "CLOSED"],
    [{ deposited: 1000, released: 0, refunded: 1000 }, "REFUNDED"],
    [{ deposited: 400, released: 0, refunded: 400 }, "REFUNDED"],
  ] as const)("%o → %s", (counters, status) => {
    expect(escrowStatusOf({ ...counters, total })).toBe(status);
  });
});

describe("сверка журнала с выпиской", () => {
  const op = (o: Partial<JournalOperation>): JournalOperation => ({
    idempotencyKey: "release:s1",
    externalRef: "SIMOP-1",
    kind: "RELEASE",
    amount: 500,
    status: "SUCCEEDED",
    ...o,
  });
  const entry = (e: Partial<StatementEntry>): StatementEntry => ({
    externalRef: "SIMOP-1",
    kind: "RELEASE",
    amount: 500,
    occurredAt: new Date(0),
    idempotencyKey: "release:s1",
    ...e,
  });

  it("совпадение по ключу идемпотентности", () => {
    expect(reconcileEntries("d1", [op({})], [entry({})])).toEqual([
      expect.objectContaining({ status: "MATCHED", ourAmount: 500, bankAmount: 500, idempotencyKey: "release:s1" }),
    ]);
  });

  it("пополнение сопоставляется по номеру операции банка", () => {
    const deposit = op({ idempotencyKey: "deposit:evt_1", externalRef: "SIMOP-9", kind: "DEPOSIT", amount: 1000 });
    const bank = entry({ externalRef: "SIMOP-9", kind: "DEPOSIT", amount: 1000, idempotencyKey: undefined });
    expect(reconcileEntries("d1", [deposit], [bank])[0].status).toBe("MATCHED");
  });

  it("находит расхождение суммы, пропуск в банке и пропуск в журнале", () => {
    const rows = reconcileEntries(
      "d1",
      [op({}), op({ idempotencyKey: "release:s2", externalRef: null, amount: 300 })],
      [entry({ amount: 450 }), entry({ externalRef: "SIMOP-7", idempotencyKey: "refund:x", kind: "REFUND", amount: 50 })],
    );
    expect(rows.map((r) => r.status)).toEqual(["AMOUNT_MISMATCH", "MISSING_IN_BANK", "MISSING_IN_JOURNAL"]);
  });

  it("неуспешная операция без движения в банке не попадает в отчёт", () => {
    expect(reconcileEntries("d1", [op({ status: "FAILED", externalRef: null })], [])).toEqual([]);
  });
});

describe("подпись вебхука: заголовки и допуск по времени", () => {
  const secret = "test-secret";
  const body = "{}";
  const now = new Date("2026-10-30T10:00:00Z");
  const signed = () => signWebhook(secret, body, now);
  const withHeaders = (over: Record<string, string | null>) => {
    const h = new Headers(signed());
    for (const [k, v] of Object.entries(over)) {
      if (v === null) h.delete(k);
      else h.set(k, v);
    }
    return h;
  };

  it("тело — JSON, метка времени в секундах", () => {
    expect(signed()).toMatchObject({ "content-type": "application/json", [TIMESTAMP_HEADER]: String(now.getTime() / 1000) });
  });

  it("без метки времени или без подписи — отказ", () => {
    expect(verifyWebhookSignature(secret, withHeaders({ [TIMESTAMP_HEADER]: null }), body, now)).toBe(false);
    expect(verifyWebhookSignature(secret, withHeaders({ [SIGNATURE_HEADER]: null }), body, now)).toBe(false);
  });

  it("метка времени — только цифры целиком", () => {
    const ts = signed()[TIMESTAMP_HEADER];
    for (const bad of [`${ts}x`, `x${ts}`, ` ${ts}`, `${ts} `, `${ts}.0`]) {
      // подпись честная для «плохой» метки: отказ — именно из-за её формата
      const h = withHeaders({ [TIMESTAMP_HEADER]: bad, [SIGNATURE_HEADER]: `v1=${hmacHex(secret, `${bad}.${body}`)}` });
      expect(verifyWebhookSignature(secret, h, body, now)).toBe(false);
    }
  });

  it("допуск — ровно 5 минут в обе стороны", () => {
    const h = new Headers(signed());
    const at = (ms: number) => new Date(now.getTime() + ms);
    expect(verifyWebhookSignature(secret, h, body, at(5 * 60_000))).toBe(true);
    expect(verifyWebhookSignature(secret, h, body, at(-5 * 60_000))).toBe(true);
    expect(verifyWebhookSignature(secret, h, body, at(5 * 60_000 + 1000))).toBe(false);
    expect(verifyWebhookSignature(secret, h, body, at(-5 * 60_000 - 1000))).toBe(false);
  });
});

describe("режимы оплаты: строка env ↔ enum БД", () => {
  it("каждый режим переводится туда и обратно", () => {
    expect(RAIL_MODES).toEqual(["manual", "escrow-simulator", "bank"]);
    expect(RAIL_MODES.map(paymentModeOf)).toEqual(["MANUAL", "ESCROW_SIMULATOR", "BANK"]);
    for (const mode of RAIL_MODES) expect(railModeOf(paymentModeOf(mode))).toBe(mode);
  });
});

describe("сверка: сопоставление и строки отчёта", () => {
  const op = (o: Partial<JournalOperation>): JournalOperation => ({
    idempotencyKey: "release:s1",
    externalRef: null,
    kind: "RELEASE",
    amount: 500,
    status: "SUCCEEDED",
    ...o,
  });
  const entry = (e: Partial<StatementEntry>): StatementEntry => ({
    externalRef: "BANK-1",
    kind: "RELEASE",
    amount: 500,
    occurredAt: new Date(0),
    idempotencyKey: "release:s1",
    ...e,
  });

  it("операция без номера банка не сопоставляется с записью без номера по совпадению null", () => {
    const rows = reconcileEntries("d1", [op({ idempotencyKey: "release:s2" })], [entry({ idempotencyKey: undefined })]);
    expect(rows.map((r) => r.status)).toEqual(["MISSING_IN_BANK", "MISSING_IN_JOURNAL"]);
  });

  it("другой номер банка и другой ключ — не та запись", () => {
    const rows = reconcileEntries("d1", [op({ idempotencyKey: "release:s2", externalRef: "BANK-2" })], [entry({})]);
    expect(rows.map((r) => r.status)).toEqual(["MISSING_IN_BANK", "MISSING_IN_JOURNAL"]);
  });

  it("неуспешная у нас, но проведённая банком — расхождение «нет в журнале» с данными банка", () => {
    expect(reconcileEntries("d1", [op({ status: "FAILED" })], [entry({ amount: 400 })])).toEqual([
      { dealId: "d1", idempotencyKey: "release:s1", externalRef: "BANK-1", kind: "RELEASE", ourAmount: null, bankAmount: 400, status: "MISSING_IN_JOURNAL" },
    ]);
  });

  it("та же сумма, но другой вид операции — расхождение", () => {
    expect(reconcileEntries("d1", [op({})], [entry({ kind: "REFUND" })])[0]).toMatchObject({ status: "AMOUNT_MISMATCH", kind: "RELEASE" });
  });

  it("лишняя запись банка без ключа — строка с ключом null", () => {
    expect(reconcileEntries("d1", [], [entry({ idempotencyKey: undefined })])).toEqual([
      { dealId: "d1", idempotencyKey: null, externalRef: "BANK-1", kind: "RELEASE", ourAmount: null, bankAmount: 500, status: "MISSING_IN_JOURNAL" },
    ]);
  });
});
