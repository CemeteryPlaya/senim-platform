import { describe, expect, it } from "vitest";
import { escrowStatusOf } from "./escrow-status";
import { reconcileEntries, type JournalOperation } from "./reconcile-entries";
import { signWebhook, verifyWebhookSignature } from "./webhook-signature";
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
