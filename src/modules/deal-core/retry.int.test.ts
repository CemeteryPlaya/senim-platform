import { describe, expect, it } from "vitest";
import type { MoneyTransactionType } from "@/generated/prisma/enums";
import { failManualOperation, listRetriableOperations, moneyView, retryFailedOperation } from "@/modules/payments";
import { db } from "@/platform/db";
import { makeOperator } from "../../../test/factories";
import { confirmPending, dealAt, dealOf, journalOf, makePhoto, PRICE, signAct } from "../../../test/factories/deal";
import { cancelDeal, onMoneySettled, openDispute, resolveDispute } from "./index";
import { confirmManualOperation, computeDealMoney } from "@/modules/payments";

/**
 * Отказ банка по выплате или возврату (ADR-009, «Повторы операций»): сделка не застревает — оператор
 * повторяет операцию новой попыткой со своим ключом, итог новой попытки двигает сделку как обычно.
 */

const money = computeDealMoney(PRICE);

async function pendingOf(dealId: string, type: MoneyTransactionType) {
  return db.moneyTransaction.findFirstOrThrow({ where: { dealId, type, status: "PENDING" }, orderBy: { seq: "desc" } });
}

async function bankRefuses(dealId: string, type: MoneyTransactionType) {
  const op = await pendingOf(dealId, type);
  await failManualOperation(await makeOperator(), { transactionId: op.id, reason: "Банк отклонил: неверные реквизиты" }, onMoneySettled);
  return op;
}

const retry = async (transactionId: string) => retryFailedOperation(await makeOperator(), { transactionId }, onMoneySettled);
const keys = async (dealId: string) => (await journalOf(dealId)).map((t) => [t.idempotencyKey, t.status]);
const requestStatus = async (requestId: string) => (await db.request.findUniqueOrThrow({ where: { id: requestId } })).status;

describe("повтор возврата после отказа банка", () => {
  it("отмена после оплаты: отказ → сделка ждёт, заявка не отменена → повтор → REFUNDED, заявка отменена", async () => {
    const f = await dealAt("PAID_HOLD", { provider: "manual" });
    expect(await cancelDeal(f.client, { dealId: f.dealId })).toEqual({ status: "REFUND_REQUESTED" });
    expect(await requestStatus(f.requestId)).toBe("CLOSED");

    const failed = await bankRefuses(f.dealId, "REFUND");
    expect(await dealOf(f.dealId)).toMatchObject({ status: "PAID_HOLD" });
    expect(await requestStatus(f.requestId)).toBe("CLOSED");
    expect((await listRetriableOperations(await makeOperator())).map((o) => o.id)).toEqual([failed.id]);

    // Двойной клик: одна новая попытка.
    const results = await Promise.all([retry(failed.id), retry(failed.id)]);
    expect(results.map((r) => r.created).sort()).toEqual([false, true]);
    expect((await keys(f.dealId)).filter(([key]) => String(key).startsWith("refund:"))).toEqual([
      [`refund:${f.dealId}`, "FAILED"],
      [`refund:${f.dealId}:2`, "PENDING"],
    ]);
    expect(await listRetriableOperations(await makeOperator())).toEqual([]);
    expect(await db.auditEvent.count({ where: { action: "payment.operation.retried", entityId: failed.id } })).toBe(1);

    await confirmPending(f.dealId, "REFUND");
    expect(await dealOf(f.dealId)).toMatchObject({ status: "REFUNDED" });
    expect(await requestStatus(f.requestId)).toBe("CANCELLED");
    expect(await moneyView(f.dealId)).toMatchObject({ kind: "refunded", settled: true, bankBalanceTiyn: 0n });

    // Повтор не отклонённой операции — CONFLICT.
    const done = await db.moneyTransaction.findFirstOrThrow({ where: { idempotencyKey: `refund:${f.dealId}:2` } });
    await expect(retry(done.id)).rejects.toMatchObject({ code: "CONFLICT" });
  });

  it("спор с полным возвратом: отказ → повтор → REFUNDED и заявка отменена после подтверждения", async () => {
    const f = await dealAt("IN_PROGRESS", { provider: "manual" });
    const { disputeId } = await openDispute(f.client, { dealId: f.dealId, reason: "QUALITY", description: "Работа не по оферте" });
    await resolveDispute(await makeOperator(), { disputeId, outcome: "FULL_REFUND", rationale: "Работы не выполнены" });
    const failed = await bankRefuses(f.dealId, "REFUND");
    expect(await requestStatus(f.requestId)).toBe("CLOSED");
    await retry(failed.id);
    expect(await pendingOf(f.dealId, "REFUND")).toMatchObject({ disputeId, amountTiyn: money.buyerTotalTiyn });
    await confirmPending(f.dealId, "REFUND");
    expect(await dealOf(f.dealId)).toMatchObject({ status: "REFUNDED" });
    expect(await requestStatus(f.requestId)).toBe("CANCELLED");
  });
});

describe("повтор выплаты после отказа банка", () => {
  it("раскрытие отклонено: части отклонены вместе с ним; повтор раскрытия — с новыми частями → SPLIT_PAYOUT", async () => {
    const f = await dealAt("READY", { provider: "manual" });
    await signAct(f.dealId);
    const release = await bankRefuses(f.dealId, "RELEASE");
    expect(await keys(f.dealId)).toEqual(
      expect.arrayContaining([
        [`release:${f.dealId}`, "FAILED"],
        [`split-master:${f.dealId}`, "FAILED"],
        [`split-platform:${f.dealId}`, "FAILED"],
      ]),
    );
    const orphan = await db.moneyTransaction.findFirstOrThrow({ where: { dealId: f.dealId, type: "SPLIT_MASTER" } });
    expect(orphan.error).toBeTruthy();
    // Часть отклонённого раскрытия отдельно не повторяется и в очереди не показывается.
    await expect(retry(orphan.id)).rejects.toMatchObject({ code: "CONFLICT" });
    expect((await listRetriableOperations(await makeOperator())).map((o) => o.type)).toEqual(["RELEASE"]);

    expect(await retry(release.id)).toEqual({ created: true });
    const second = await pendingOf(f.dealId, "RELEASE");
    expect(second.idempotencyKey).toBe(`release:${f.dealId}:2`);
    expect(await pendingOf(f.dealId, "SPLIT_MASTER")).toMatchObject({ idempotencyKey: `split-master:${f.dealId}:2`, parentId: second.id, amountTiyn: money.payoutTiyn });
    expect(await pendingOf(f.dealId, "SPLIT_PLATFORM")).toMatchObject({ idempotencyKey: `split-platform:${f.dealId}:2`, parentId: second.id, amountTiyn: money.platformIncomeTiyn });

    await confirmPending(f.dealId, "RELEASE");
    await confirmPending(f.dealId, "SPLIT_MASTER");
    await confirmPending(f.dealId, "SPLIT_PLATFORM");
    expect(await dealOf(f.dealId)).toMatchObject({ status: "SPLIT_PAYOUT" });
    expect(await moneyView(f.dealId)).toMatchObject({ kind: "completed", settled: true, paidToMasterTiyn: money.payoutTiyn, bankBalanceTiyn: 0n });
  });

  it.each(["SPLIT_MASTER", "SPLIT_PLATFORM"] as const)("%s отклонён (неверный IBAN): повтор под тем же раскрытием → SPLIT_PAYOUT", async (type) => {
    const f = await dealAt("READY", { provider: "manual" });
    await signAct(f.dealId);
    await confirmPending(f.dealId, "RELEASE");
    const release = await db.moneyTransaction.findFirstOrThrow({ where: { dealId: f.dealId, type: "RELEASE" } });
    const failed = await bankRefuses(f.dealId, type);
    await confirmPending(f.dealId, type === "SPLIT_MASTER" ? "SPLIT_PLATFORM" : "SPLIT_MASTER");
    expect(await dealOf(f.dealId)).toMatchObject({ status: "ACCEPTED" });

    const results = await Promise.all([retry(failed.id), retry(failed.id)]);
    expect(results.filter((r) => r.created)).toHaveLength(1);
    const again = await pendingOf(f.dealId, type);
    expect(again).toMatchObject({ parentId: release.id, amountTiyn: failed.amountTiyn, idempotencyKey: `${type === "SPLIT_MASTER" ? "split-master" : "split-platform"}:${f.dealId}:2` });
    expect(await db.moneyTransaction.count({ where: { dealId: f.dealId, type } })).toBe(2);

    await confirmPending(f.dealId, type);
    expect(await dealOf(f.dealId)).toMatchObject({ status: "SPLIT_PAYOUT" });
    expect(await moneyView(f.dealId)).toMatchObject({ kind: "completed", settled: true, paidToMasterTiyn: money.payoutTiyn, bankBalanceTiyn: 0n });
    await expect(retry(again.id)).rejects.toMatchObject({ code: "CONFLICT" });
  });
});

describe("повтор: границы", () => {
  it("оплату оператор не повторяет; ждущую операцию — тоже; не оператор — FORBIDDEN", async () => {
    const f = await dealAt("SIGNED", { provider: "manual" });
    const { payForDeal } = await import("./index");
    await payForDeal(f.client, { dealId: f.dealId });
    const hold = await pendingOf(f.dealId, "HOLD");
    await expect(retry(hold.id)).rejects.toMatchObject({ code: "CONFLICT" });
    await failManualOperation(await makeOperator(), { transactionId: hold.id, reason: "Платёж не поступил" }, onMoneySettled);
    await expect(retry(hold.id)).rejects.toMatchObject({ code: "CONFLICT" });
    await expect(retryFailedOperation(f.client, { transactionId: hold.id }, onMoneySettled)).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(retry("нет-такой")).rejects.toMatchObject({ code: "NOT_FOUND" });
  });

  it("manual: часть выплаты не подтверждается раньше раскрытия", async () => {
    const f = await dealAt("READY", { provider: "manual" });
    await signAct(f.dealId);
    const operator = await makeOperator();
    const master = await pendingOf(f.dealId, "SPLIT_MASTER");
    await expect(
      confirmManualOperation(operator, { transactionId: master.id, bankDocNumber: "П-1", bankDocDate: new Date(), bankDocFileId: await makePhoto(operator, "BANK_DOCUMENT") }, onMoneySettled),
    ).rejects.toMatchObject({ code: "CONFLICT" });
    expect(await db.moneyTransaction.findUniqueOrThrow({ where: { id: master.id } })).toMatchObject({ status: "PENDING" });
  });
});
