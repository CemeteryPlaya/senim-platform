import { describe, expect, it } from "vitest";
import { confirmPending, dealAt, dealOf, journalOf, makePhoto, signAct } from "../../../test/factories/deal";
import { makeOperator } from "../../../test/factories";
import { confirmManualOperation, failManualOperation, listPendingManualOperations, moneyView } from "@/modules/payments";
import { db } from "@/platform/db";
import { onMoneySettled, payForDeal } from "./index";

/** Провайдер manual (пилот): операции ждут, пока оператор подтвердит их банковским документом. */
describe("manual: оплата и выплата по банковским документам", () => {
  it("оплата ждёт оператора; подтверждение двигает сделку и пишет реквизиты документа в журнал и аудит", async () => {
    const f = await dealAt("SIGNED", { provider: "manual" });
    expect(await payForDeal(f.client, { dealId: f.dealId })).toMatchObject({ status: "PENDING" });
    expect(await dealOf(f.dealId)).toMatchObject({ status: "CREATED", paymentProvider: "MANUAL" });
    expect(await moneyView(f.dealId)).toMatchObject({ kind: "awaiting", payment: "PENDING", isTest: false });

    const operator = await makeOperator();
    const [pending] = await listPendingManualOperations(operator);
    expect(pending).toMatchObject({ dealId: f.dealId, type: "HOLD" });
    const scan = await makePhoto(operator, "BANK_DOCUMENT");
    await confirmManualOperation(operator, { transactionId: pending.id, bankDocNumber: "ПП-17", bankDocDate: "2026-11-02", bankDocFileId: scan }, onMoneySettled);

    expect(await dealOf(f.dealId)).toMatchObject({ status: "PAID_HOLD" });
    expect(await db.moneyTransaction.findUniqueOrThrow({ where: { id: pending.id } })).toMatchObject({
      status: "SUCCEEDED",
      bankDocNumber: "ПП-17",
      bankDocFileId: scan,
      confirmedById: operator.id,
      externalRef: "ПП-17",
    });
    expect(await db.auditEvent.findFirstOrThrow({ where: { action: "payment.operation.confirmed" } })).toMatchObject({ actorId: operator.id, scope: `deal:${f.dealId}` });

    // Двойной клик — CONFLICT, повторно тот же скан не приложить.
    await expect(
      confirmManualOperation(operator, { transactionId: pending.id, bankDocNumber: "ПП-17", bankDocDate: "2026-11-02", bankDocFileId: await makePhoto(operator, "BANK_DOCUMENT") }, onMoneySettled),
    ).rejects.toMatchObject({ code: "CONFLICT" });
  });

  it("номер, дата и скан обязательны; скан — свой, BANK_DOCUMENT, не приложенный; не оператор — FORBIDDEN", async () => {
    const f = await dealAt("SIGNED", { provider: "manual" });
    await payForDeal(f.client, { dealId: f.dealId });
    const op = await db.moneyTransaction.findFirstOrThrow({ where: { dealId: f.dealId } });
    const operator = await makeOperator();
    const other = await makeOperator();
    const bad = [
      { bankDocNumber: "", bankDocDate: "2026-11-02", bankDocFileId: await makePhoto(operator, "BANK_DOCUMENT") },
      { bankDocNumber: "1", bankDocDate: "не дата", bankDocFileId: await makePhoto(operator, "BANK_DOCUMENT") },
      { bankDocNumber: "1", bankDocDate: "2026-11-02", bankDocFileId: "" },
      { bankDocNumber: "1", bankDocDate: "2026-11-02", bankDocFileId: await makePhoto(other, "BANK_DOCUMENT") },
      { bankDocNumber: "1", bankDocDate: "2026-11-02", bankDocFileId: await makePhoto(operator, "DELIVERY") },
      { bankDocNumber: "1", bankDocDate: "2099-01-01", bankDocFileId: await makePhoto(operator, "BANK_DOCUMENT") },
    ];
    for (const input of bad) {
      await expect(confirmManualOperation(operator, { transactionId: op.id, ...input }, onMoneySettled)).rejects.toMatchObject({ code: "VALIDATION" });
    }
    await expect(confirmManualOperation(f.client, { transactionId: op.id, bankDocNumber: "1", bankDocDate: "2026-11-02", bankDocFileId: "x" }, onMoneySettled)).rejects.toMatchObject({ code: "FORBIDDEN" });
    expect(await db.moneyTransaction.findUniqueOrThrow({ where: { id: op.id } })).toMatchObject({ status: "PENDING" });
  });

  it("отказ банка: оплата FAILED, сделка ждёт; повторная оплата — новая попытка со своим ключом", async () => {
    const f = await dealAt("SIGNED", { provider: "manual" });
    await payForDeal(f.client, { dealId: f.dealId });
    const operator = await makeOperator();
    const op = await db.moneyTransaction.findFirstOrThrow({ where: { dealId: f.dealId } });
    await failManualOperation(operator, { transactionId: op.id, reason: "Платёж не поступил" }, onMoneySettled);
    expect(await moneyView(f.dealId)).toMatchObject({ kind: "awaiting", payment: "FAILED" });
    await payForDeal(f.client, { dealId: f.dealId });
    expect((await journalOf(f.dealId)).map((t) => [t.idempotencyKey, t.status])).toEqual([
      [`hold:${f.dealId}`, "FAILED"],
      [`hold:${f.dealId}:2`, "PENDING"],
    ]);
    expect(await db.notification.count({ where: { kind: "money.hold.failed" } })).toBe(2);
  });

  it("выплата: сделка завершается, когда подтверждены раскрытие и обе части", async () => {
    const f = await dealAt("READY", { provider: "manual" });
    await signAct(f.dealId);
    await confirmPending(f.dealId, "RELEASE");
    await confirmPending(f.dealId, "SPLIT_MASTER");
    expect(await dealOf(f.dealId)).toMatchObject({ status: "ACCEPTED" });
    expect(await moneyView(f.dealId)).toMatchObject({ kind: "completed", settled: false });
    await confirmPending(f.dealId, "SPLIT_PLATFORM");
    expect(await dealOf(f.dealId)).toMatchObject({ status: "SPLIT_PAYOUT" });
    expect(await moneyView(f.dealId)).toMatchObject({ kind: "completed", settled: true, bankBalanceTiyn: 0n });
  });

  it("демо-сделка (покупатель — демо-персона) на manual: операции журнала тестовые, блок денег помечен", async () => {
    const f = await dealAt("SIGNED", { provider: "manual" });
    await db.user.update({ where: { id: f.client.id }, data: { isDemo: true } });
    await db.deal.update({ where: { id: f.dealId }, data: { isDemo: true } });
    await payForDeal(f.client, { dealId: f.dealId });
    expect((await journalOf(f.dealId)).map((e) => e.isTest)).toEqual([true]);
    expect(await moneyView(f.dealId)).toMatchObject({ isTest: true });
  });

  it("mock-операцию оператор не подтверждает", async () => {
    const f = await dealAt("PAID_HOLD");
    const operator = await makeOperator();
    const op = await db.moneyTransaction.findFirstOrThrow({ where: { dealId: f.dealId } });
    await expect(failManualOperation(operator, { transactionId: op.id, reason: "Проверка mock" }, onMoneySettled)).rejects.toMatchObject({ code: "CONFLICT" });
  });
});
