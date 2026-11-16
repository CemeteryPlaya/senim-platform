import { describe, expect, it } from "vitest";
import { ru } from "@/i18n/ru";
import type { DealDocument, JournalRow } from "@/modules/operator";
import type { MoneyBlock } from "@/modules/payments";
import { dealMoney, journalTimeline, signatureLines } from "./deal-view";

const t = ru.app.operatorDeals;

const block = (over: Record<string, unknown>) => ({ bankBalanceTiyn: 0n, isTest: false, ...over }) as unknown as MoneyBlock;

describe("dealMoney: блок денег по журналу", () => {
  it("ждёт оплаты — ноль и тон «ожидает»; остаток на счёте сделки — отдельной строкой", () => {
    expect(dealMoney(block({ kind: "awaiting" }))).toEqual({ tone: "awaiting", title: t.money.awaiting, amount: 0n, rows: [{ label: t.money.bankBalance, amount: 0n }] });
  });

  it("под защитой, заморожено, возврат и выплата — сумма из журнала (тиыны), статус «ждёт банка» отличается подписью", () => {
    expect(dealMoney(block({ kind: "protected", amountTiyn: 10_200_000n, bankBalanceTiyn: 10_200_000n }))).toMatchObject({ tone: "protected", amount: 10_200_000n });
    expect(dealMoney(block({ kind: "frozen", amountTiyn: 9_600_000n }))).toMatchObject({ tone: "frozen", title: t.money.frozen, amount: 9_600_000n });
    expect(dealMoney(block({ kind: "completed", settled: true, paidToMasterTiyn: 9_600_000n }))).toMatchObject({ tone: "completed", title: t.money.completed, amount: 9_600_000n });
    expect(dealMoney(block({ kind: "completed", settled: false, paidToMasterTiyn: 9_600_000n }))).toMatchObject({ title: t.money.completedPending });
    expect(dealMoney(block({ kind: "refunded", settled: true, amountTiyn: 10_200_000n }))).toMatchObject({ tone: "refunded", title: t.money.refunded });
    expect(dealMoney(block({ kind: "refunded", settled: false, amountTiyn: 10_200_000n }))).toMatchObject({ title: t.money.refundedPending });
  });

  it("пометка тестовых денег — в примечании, только когда деньги тестовые", () => {
    expect(dealMoney(block({ kind: "awaiting", isTest: true })).note).toBe(t.money.test);
    expect(dealMoney(block({ kind: "awaiting" })).note).toBeUndefined();
  });
});

const row = (over: Partial<JournalRow>): JournalRow => ({
  id: "m1",
  seq: "12",
  type: "HOLD",
  status: "SUCCEEDED",
  amountTiyn: 10_200_000n,
  idempotencyKey: "hold:d1:1",
  parentId: null,
  isTest: false,
  externalRef: null,
  bankDocNumber: null,
  bankDocDate: null,
  error: null,
  createdAt: new Date("2026-11-10T09:00:00Z"),
  settledAt: null,
  ...over,
});

describe("journalTimeline: журнал денег лентой", () => {
  it("заголовок «№ · операция, статус», сумма — тиыны, ключ идемпотентности в тексте", () => {
    const [item] = journalTimeline([row({})]);
    expect(item).toMatchObject({ title: t.card.journalItem("12", t.moneyTypes.HOLD, t.moneyStatus.SUCCEEDED), amount: 10_200_000n });
    expect(item?.text).toContain(t.card.key("hold:d1:1"));
    expect(item?.text).not.toContain(t.testMark);
  });

  it("документ банка, причина отказа и пометка «тестовая» — в тексте; без них строк нет", () => {
    const [item] = journalTimeline([
      row({ isTest: true, status: "FAILED", error: "Нет поступления", bankDocNumber: "ПП-17", bankDocDate: new Date("2026-11-11T00:00:00Z"), settledAt: new Date("2026-11-11T10:00:00Z") }),
    ]);
    expect(item?.text).toContain("ПП-17");
    expect(item?.text).toContain(t.card.error("Нет поступления"));
    expect(item?.text).toContain(t.testMark);
  });

  it("пустой журнал — пустая лента", () => {
    expect(journalTimeline([])).toEqual([]);
  });
});

const doc = (over: Partial<DealDocument>): DealDocument =>
  ({ id: "doc1", kind: "CONTRACT", number: "Д-1", version: 1, sha256: "aa", status: "SIGNED", createdAt: new Date(), signedAt: null, signatures: [], handSignatures: [], ...over }) as DealDocument;

describe("signatureLines: подписи документа", () => {
  it("без подписей — пусто", () => {
    expect(signatureLines(doc({}))).toEqual([]);
  });

  it("ЭЦП: совпавший хэш и проверка — без тревоги; другой хэш или непроверенная — mismatch", () => {
    const sig = { party: "CLIENT", method: "NCALAYER", signedSha256: "aa", certSubject: "Иванов И.", verified: true, signedAt: new Date("2026-11-10T09:00:00Z") } as const;
    const [ok] = signatureLines(doc({ signatures: [sig] }));
    expect(ok?.mismatch).toBe(false);
    expect(ok?.detail).toEqual(["Иванов И.", t.documents.hashMatches, t.documents.verified]);
    expect(signatureLines(doc({ signatures: [{ ...sig, signedSha256: "bb" }] }))[0]).toMatchObject({ mismatch: true });
    expect(signatureLines(doc({ signatures: [{ ...sig, verified: false }] }))[0]).toMatchObject({ mismatch: true });
  });

  it("собственноручная: имя напечатано, хэш и IP; другой хэш — mismatch", () => {
    const hand = { party: "EXECUTOR", typedName: "Петров П.", imageFileId: null, documentSha256: "aa", ip: "10.0.0.1", signedAt: new Date("2026-11-10T09:00:00Z") } as const;
    const [line] = signatureLines(doc({ handSignatures: [hand] }));
    expect(line?.text).toContain(t.documents.typed("Петров П."));
    expect(line?.detail).toEqual([t.documents.hashMatches, t.documents.ip("10.0.0.1")]);
    expect(signatureLines(doc({ handSignatures: [{ ...hand, documentSha256: "bb" }] }))[0]).toMatchObject({ mismatch: true });
  });
});
