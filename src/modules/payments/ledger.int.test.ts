import { describe, expect, it } from "vitest";
import { dealAt, makeDeal, PRICE, signAct } from "../../../test/factories/deal";
import { makeOperator } from "../../../test/factories";
import { onMoneySettled, openDispute, processDealMoney, resolveDispute } from "@/modules/deal-core";
import { db, transaction } from "@/platform/db";
import { computeDealMoney, computeSplit } from "./money";
import { moneyKey } from "./keys";
import { recordOperation, settle, trySettle } from "./ledger";
import { pollPendingOperations } from "./poll";
import { platformIncomeReport } from "./report";

const money = computeDealMoney(PRICE);
const hold = (dealId: string, amountTiyn = money.buyerTotalTiyn) => ({
  dealId,
  type: "HOLD" as const,
  amountTiyn,
  idempotencyKey: moneyKey.hold(dealId),
  provider: "MOCK" as const,
  isTest: true,
});

describe("журнал: ключ идемпотентности", () => {
  it("повтор с тем же ключом — та же операция, не дубль (и параллельно)", async () => {
    const { dealId } = await makeDeal();
    const [a, b] = await Promise.all([transaction((tx) => recordOperation(tx, hold(dealId))), transaction((tx) => recordOperation(tx, hold(dealId)))]);
    expect(a.entry.id).toBe(b.entry.id);
    expect([a.created, b.created].sort()).toEqual([false, true]);
    expect(await db.moneyTransaction.count({ where: { dealId } })).toBe(1);
  });

  it("тот же ключ с другой суммой — CONFLICT, операция не подменяется", async () => {
    const { dealId } = await makeDeal();
    await transaction((tx) => recordOperation(tx, hold(dealId)));
    await expect(transaction((tx) => recordOperation(tx, hold(dealId, 1n)))).rejects.toMatchObject({ code: "CONFLICT" });
  });

  it("итог — один раз: второй trySettle — null, settle — CONFLICT", async () => {
    const { dealId } = await makeDeal();
    const { entry } = await transaction((tx) => recordOperation(tx, hold(dealId)));
    const results = await Promise.all([
      transaction((tx) => trySettle(tx, entry.id, { status: "SUCCEEDED", externalRef: "A" })),
      transaction((tx) => trySettle(tx, entry.id, { status: "FAILED", error: "x" })),
    ]);
    expect(results.filter(Boolean)).toHaveLength(1);
    await expect(transaction((tx) => settle(tx, entry.id, { status: "SUCCEEDED" }))).rejects.toMatchObject({ code: "CONFLICT" });
  });
});

describe("журнал только на добавление (триггер БД)", () => {
  it("DELETE, смена суммы, типа, ключа и итога проведённой операции — ошибка БД", async () => {
    const f = await dealAt("PAID_HOLD");
    const op = await db.moneyTransaction.findFirstOrThrow({ where: { dealId: f.dealId } });
    await expect(db.moneyTransaction.delete({ where: { id: op.id } })).rejects.toThrow(/append-only/);
    await expect(db.$executeRaw`DELETE FROM "MoneyTransaction" WHERE id = ${op.id}`).rejects.toThrow(/append-only/);
    await expect(db.moneyTransaction.update({ where: { id: op.id }, data: { amountTiyn: 1n } })).rejects.toThrow(/append-only/);
    await expect(db.moneyTransaction.update({ where: { id: op.id }, data: { type: "REFUND" } })).rejects.toThrow(/append-only/);
    await expect(db.moneyTransaction.update({ where: { id: op.id }, data: { idempotencyKey: "other" } })).rejects.toThrow(/append-only/);
    await expect(db.moneyTransaction.update({ where: { id: op.id }, data: { status: "FAILED" } })).rejects.toThrow(/settled operation/);
    expect(await db.moneyTransaction.findUniqueOrThrow({ where: { id: op.id } })).toMatchObject({ amountTiyn: money.buyerTotalTiyn, status: "SUCCEEDED" });
  });
});

describe("опрос ждущих операций", () => {
  it("mock без номера — отправляется снова тем же ключом и проводится; manual не опрашивается", async () => {
    const mock = await makeDeal();
    const manual = await makeDeal({ provider: "manual" });
    const mockOp = await transaction((tx) => recordOperation(tx, hold(mock.dealId)));
    await transaction((tx) => recordOperation(tx, { ...hold(manual.dealId), provider: "MANUAL", isTest: false }));
    const later = new Date(Date.now() + 5 * 60_000);
    const summary = await pollPendingOperations(onMoneySettled, { now: later });
    expect(summary).toMatchObject({ checked: 1, resentDeals: 1 });
    expect(await db.moneyTransaction.findUniqueOrThrow({ where: { id: mockOp.entry.id } })).toMatchObject({ status: "SUCCEEDED" });
    expect(await db.moneyTransaction.count({ where: { dealId: manual.dealId, status: "PENDING" } })).toBe(1);
  });

  it("с номером провайдера — getStatus; свежие операции не трогаются", async () => {
    const f = await makeDeal();
    const { entry } = await transaction((tx) => recordOperation(tx, hold(f.dealId)));
    await db.moneyTransaction.update({ where: { id: entry.id }, data: { externalRef: "MOCK-1" } });
    expect(await pollPendingOperations(onMoneySettled)).toMatchObject({ checked: 0 });
    expect(await pollPendingOperations(onMoneySettled, { now: new Date(Date.now() + 120_000) })).toMatchObject({ checked: 1, settled: 1 });
  });
});

describe("отчёт оператора: доход платформы 2% + 4% — из журнала", () => {
  it("обычная выплата и раздел по спору; разбивка сходится с операцией журнала", async () => {
    const plain = await dealAt("READY");
    await signAct(plain.dealId);
    await processDealMoney(plain.dealId);
    const split = await dealAt("IN_PROGRESS");
    const { disputeId } = await openDispute(split.client, { dealId: split.dealId, reason: "QUALITY", description: "Сделана половина работ" });
    const operator = await makeOperator();
    const share = 50_000_00n;
    await resolveDispute(operator, { disputeId, outcome: "PARTIAL_SPLIT", masterShareTiyn: share, rationale: "Половина работ выполнена" });

    const report = await platformIncomeReport(operator, { from: new Date(Date.now() - 3600_000), to: new Date(Date.now() + 3600_000) });
    expect(report.rows).toHaveLength(2);
    for (const row of report.rows) expect(row.protectionTiyn + row.guaranteeTiyn).toBe(row.totalTiyn);
    expect(report.totalTiyn).toBe(money.platformIncomeTiyn + computeSplit(PRICE, share).platformTiyn);
    expect(report.protectionTiyn).toBe(money.protectionTiyn + computeDealMoney(share).protectionTiyn);
    await expect(platformIncomeReport(plain.client, { from: new Date(0), to: new Date() })).rejects.toMatchObject({ code: "FORBIDDEN" });
  });
});
