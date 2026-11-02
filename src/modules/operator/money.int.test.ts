import { describe, expect, it } from "vitest";
import { payForDeal } from "@/modules/deal-core";
import { db } from "@/platform/db";
import { makeOperator } from "../../../test/factories";
import { dealAt, dealOf, journalOf, makePhoto, signAct } from "../../../test/factories/deal";
import { getOperatorDeal } from "./deals";
import { confirmBankOperation, failBankOperation, listMoneyQueue, saveBankDocument } from "./money";

const PDF = new TextEncoder().encode("%PDF-1.4\n% тестовый документ\n");

/** Оплата ждёт оператора: сделка на manual, оферта подписана, покупатель нажал «Оплатить». */
async function pendingHold() {
  const f = await dealAt("SIGNED", { provider: "manual" });
  await payForDeal(f.client, { dealId: f.dealId });
  return f;
}

describe("деньги в банке: кнопки провайдера manual", () => {
  it("очередь показывает ждущую оплату; «Деньги поступили на счёт в банке» двигает сделку и пишет документ", async () => {
    const operator = await makeOperator();
    const f = await pendingHold();

    const [op] = await listMoneyQueue(operator);
    expect(op).toMatchObject({ dealId: f.dealId, type: "HOLD", ageDays: 0 });

    const scan = await saveBankDocument(operator, PDF);
    await confirmBankOperation(operator, { transactionId: op.id, bankDocNumber: "ПП-17", bankDocDate: new Date("2026-11-02"), bankDocFileId: scan });

    expect(await dealOf(f.dealId)).toMatchObject({ status: "PAID_HOLD" });
    expect(await db.moneyTransaction.findUniqueOrThrow({ where: { id: op.id } })).toMatchObject({ status: "SUCCEEDED", bankDocNumber: "ПП-17", bankDocFileId: scan });
    expect(await db.auditEvent.findFirstOrThrow({ where: { action: "payment.operation.confirmed" } })).toMatchObject({ actorId: operator.id, scope: `deal:${f.dealId}` });
    expect(await listMoneyQueue(operator)).toEqual([]);
  });

  it("двойной клик (два одновременных подтверждения со своими сканами) — ровно один эффект", async () => {
    const operator = await makeOperator();
    const f = await pendingHold();
    const [op] = await listMoneyQueue(operator);
    const confirm = async () =>
      confirmBankOperation(operator, { transactionId: op.id, bankDocNumber: "ПП-18", bankDocDate: new Date(), bankDocFileId: await saveBankDocument(operator, PDF) });

    const results = await Promise.allSettled([confirm(), confirm()]);

    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    expect(results.find((r) => r.status === "rejected")).toMatchObject({ reason: { code: "CONFLICT" } });
    expect(await db.auditEvent.count({ where: { action: "payment.operation.confirmed" } })).toBe(1);
    expect((await journalOf(f.dealId)).filter((t) => t.type === "HOLD")).toHaveLength(1);
    expect(await dealOf(f.dealId)).toMatchObject({ status: "PAID_HOLD" });
  });

  it("«Отклонено банком»: операция FAILED с причиной, сделка ждёт оплату", async () => {
    const operator = await makeOperator();
    const f = await pendingHold();
    const [op] = await listMoneyQueue(operator);

    await failBankOperation(operator, { transactionId: op.id, reason: "Платёж не поступил" });

    expect(await db.moneyTransaction.findUniqueOrThrow({ where: { id: op.id } })).toMatchObject({ status: "FAILED", error: "Платёж не поступил" });
    expect(await dealOf(f.dealId)).toMatchObject({ status: "CREATED" });
    expect(await db.auditEvent.count({ where: { action: "payment.operation.failed", actorId: operator.id } })).toBe(1);
  });

  it("после акта: в очереди раскрытие и обе части, пакет на раскрытие с суммами из журнала; выплата завершает сделку", async () => {
    const operator = await makeOperator();
    const f = await dealAt("READY", { provider: "manual" });
    await signAct(f.dealId);

    const queue = await listMoneyQueue(operator);
    expect(queue.map((q) => q.type).sort()).toEqual(["RELEASE", "SPLIT_MASTER", "SPLIT_PLATFORM"]);

    const card = await getOperatorDeal(operator, f.dealId);
    const deal = await dealOf(f.dealId);
    expect(card.releasePackage).toMatchObject({
      act: { kind: "ACCEPTANCE_ACT" },
      receipt: null,
      masterTiyn: deal.payoutTiyn,
      platformTiyn: deal.platformIncomeTiyn,
      releaseTiyn: deal.payoutTiyn + deal.platformIncomeTiyn,
      done: false,
    });

    for (const type of ["RELEASE", "SPLIT_MASTER", "SPLIT_PLATFORM"] as const) {
      const op = queue.find((q) => q.type === type)!;
      await confirmBankOperation(operator, { transactionId: op.id, bankDocNumber: `П-${type}`, bankDocDate: new Date(), bankDocFileId: await saveBankDocument(operator, PDF) });
    }
    expect(await dealOf(f.dealId)).toMatchObject({ status: "SPLIT_PAYOUT" });
    expect((await getOperatorDeal(operator, f.dealId)).releasePackage).toMatchObject({ done: true });
  });

  it("скан: только PDF, JPEG или PNG, сохраняется как BANK_DOCUMENT оператора", async () => {
    const operator = await makeOperator();
    const id = await saveBankDocument(operator, PDF);
    expect(await db.storedFile.findUniqueOrThrow({ where: { id } })).toMatchObject({ purpose: "BANK_DOCUMENT", uploadedById: operator.id, contentType: "application/pdf" });

    await expect(saveBankDocument(operator, new TextEncoder().encode("<html>не скан</html>"))).rejects.toMatchObject({ code: "VALIDATION" });
    await expect(saveBankDocument(operator, new Uint8Array())).rejects.toMatchObject({ code: "VALIDATION" });
    await expect(saveBankDocument(operator, new Uint8Array(4 * 1024 * 1024 + 1))).rejects.toMatchObject({ code: "VALIDATION" });
  });

  it("чужой скан не прикладывается: подтверждение отклоняется, операция ждёт", async () => {
    const operator = await makeOperator();
    const other = await makeOperator();
    await pendingHold();
    const [op] = await listMoneyQueue(operator);
    await expect(
      confirmBankOperation(operator, { transactionId: op.id, bankDocNumber: "1", bankDocDate: new Date(), bankDocFileId: await makePhoto(other, "BANK_DOCUMENT") }),
    ).rejects.toMatchObject({ code: "VALIDATION" });
    expect(await db.moneyTransaction.findUniqueOrThrow({ where: { id: op.id } })).toMatchObject({ status: "PENDING" });
  });
});
