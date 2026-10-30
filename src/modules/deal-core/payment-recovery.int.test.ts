import { afterEach, describe, expect, it, vi } from "vitest";
import { railFor, resendPendingOperations, simulatorDeposit } from "@/modules/payments";
import { db } from "@/platform/db";
import { makeOperator } from "../../../test/factories";
import { makeDeal, makeStagePhoto, signContract, stagesOf, TEMPLATES, type DealFixture } from "../../../test/factories/deal";
import { acceptStage, getDealView, handleRailWebhook, openDispute, resolveDispute, retryPaymentOperation, startStage, submitStage } from "./index";
import { onPaymentSettled } from "./service";

const code = (p: Promise<unknown>) => p.then(() => "OK", (e: { code?: string }) => e.code ?? String(e));
const rail = () => railFor("escrow-simulator");
const opOf = (idempotencyKey: string) => db.paymentOperation.findUniqueOrThrow({ where: { idempotencyKey } });

/** Эскроу-сделка с одним этапом (оплата после приёмки), счёт пополнен, этап сдан. */
async function submittedEscrowStage(): Promise<DealFixture & { stageId: string }> {
  const f = await makeDeal({ rail: "escrow-simulator", template: TEMPLATES.single });
  await signContract(f.dealId);
  const account = await db.escrowAccount.findUniqueOrThrow({ where: { dealId: f.dealId } });
  const delivery = await simulatorDeposit(f.client, { accountId: account.id, amount: 100_000 });
  await handleRailWebhook("escrow-simulator", { headers: new Headers(delivery.headers), rawBody: delivery.rawBody });
  const [stage] = await stagesOf(f.dealId);
  await startStage(f.executor, { stageId: stage.id });
  await submitStage(f.executor, { stageId: stage.id, report: "Кухня установлена", photoIds: [await makeStagePhoto(f.executor)] });
  return { ...f, stageId: stage.id };
}

afterEach(() => {
  vi.restoreAllMocks();
});

/** «Прошло N минут»: операция создана давно. */
const ageOperation = (idempotencyKey: string) =>
  db.paymentOperation.update({ where: { idempotencyKey }, data: { createdAt: new Date(Date.now() - 60 * 60 * 1000) } });

describe("зависшие денежные операции (payments.resendPending)", () => {
  it("банк не ответил ни разу: задача досылает операцию старше N минут, свежую не трогает", async () => {
    const f = await submittedEscrowStage();
    const down = vi.spyOn(rail(), "releaseTranche").mockRejectedValue(new Error("банк недоступен"));
    await acceptStage(f.client, { stageId: f.stageId });
    down.mockRestore();
    const key = `release:${f.stageId}`;
    expect(await opOf(key)).toMatchObject({ status: "PENDING", externalRef: null });

    await resendPendingOperations(onPaymentSettled);
    expect(await opOf(key)).toMatchObject({ status: "PENDING" });

    await ageOperation(key);
    expect(await resendPendingOperations(onPaymentSettled)).toEqual({ resent: 1, failed: 0 });
    expect(await opOf(key)).toMatchObject({ status: "SUCCEEDED" });
    expect((await stagesOf(f.dealId))[0].payment).toMatchObject({ status: "CONFIRMED" });
  });

  it("вебхук банка потерялся: задача спрашивает банк по тому же ключу — деньги не двигаются второй раз", async () => {
    const f = await submittedEscrowStage();
    vi.spyOn(rail(), "releaseTranche").mockResolvedValueOnce({ status: "PENDING", externalRef: "bank-op-1" });
    await acceptStage(f.client, { stageId: f.stageId });
    const key = `release:${f.stageId}`;
    expect(await opOf(key)).toMatchObject({ status: "PENDING", externalRef: "bank-op-1" });

    await ageOperation(key);
    await resendPendingOperations(onPaymentSettled);
    await resendPendingOperations(onPaymentSettled);
    expect(await opOf(key)).toMatchObject({ status: "SUCCEEDED" });
    expect(await db.escrowAccount.findUniqueOrThrow({ where: { dealId: f.dealId } })).toMatchObject({ released: 100_000 });
  });
});

describe("отклонённая банком операция", () => {
  it("операторы получают уведомление, в журнале — отказ, оплата этапа не подтверждена", async () => {
    const operator = await makeOperator();
    const f = await submittedEscrowStage();
    vi.spyOn(rail(), "releaseTranche").mockResolvedValueOnce({ status: "FAILED", error: "Счёт заблокирован" });
    await acceptStage(f.client, { stageId: f.stageId });

    expect(await opOf(`release:${f.stageId}`)).toMatchObject({ status: "FAILED", error: "Счёт заблокирован" });
    expect((await stagesOf(f.dealId))[0].payment).toMatchObject({ status: "DUE" });
    expect(await db.auditEvent.count({ where: { action: "payment.operation.failed", scope: `deal:${f.dealId}` } })).toBe(1);
    const notes = await db.notification.findMany({ where: { userId: operator.id, kind: "payment.failed" } });
    expect(notes).toHaveLength(1);
    expect(notes[0].link).toBe(`/deals/${f.dealId}`);
  });

  it("оператор повторяет с новым ключом release:<stageId>:retry:1; двойной клик — один повтор, один транш", async () => {
    const operator = await makeOperator();
    const f = await submittedEscrowStage();
    vi.spyOn(rail(), "releaseTranche").mockResolvedValueOnce({ status: "FAILED", error: "Счёт заблокирован" });
    await acceptStage(f.client, { stageId: f.stageId });
    const key = `release:${f.stageId}`;

    expect(await code(retryPaymentOperation(f.client, { idempotencyKey: key }))).toBe("FORBIDDEN");
    const results = await Promise.allSettled([
      retryPaymentOperation(operator, { idempotencyKey: key }),
      retryPaymentOperation(operator, { idempotencyKey: key }),
    ]);
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);

    expect(await opOf(`${key}:retry:1`)).toMatchObject({ status: "SUCCEEDED", stageId: f.stageId, amount: 100_000 });
    expect(await db.paymentOperation.count({ where: { stageId: f.stageId, kind: "RELEASE", status: "SUCCEEDED" } })).toBe(1);
    expect((await stagesOf(f.dealId))[0].payment).toMatchObject({ status: "CONFIRMED" });
    expect(await db.auditEvent.count({ where: { action: "payment.operation.retried" } })).toBe(1);
    // Повторять нечего: операция уже выполнена.
    expect(await code(retryPaymentOperation(operator, { idempotencyKey: key }))).toBe("CONFLICT");
    expect(await code(retryPaymentOperation(operator, { idempotencyKey: `${key}:retry:1` }))).toBe("CONFLICT");
  });

  it("транш отклонён, спор расторг сделку, возврат отклонён: повтор транша — CONFLICT, повтор возврата — можно", async () => {
    const operator = await makeOperator();
    const f = await submittedEscrowStage();
    vi.spyOn(rail(), "releaseTranche").mockResolvedValueOnce({ status: "FAILED", error: "Счёт заблокирован" });
    await acceptStage(f.client, { stageId: f.stageId });
    const release = `release:${f.stageId}`;

    const { disputeId } = await openDispute(f.client, { dealId: f.dealId, reason: "QUALITY", description: "Работа не устроила" });
    vi.spyOn(rail(), "refund").mockResolvedValueOnce({ status: "FAILED", error: "Счёт заблокирован" });
    await resolveDispute(operator, { disputeId, decision: "TERMINATE", rationale: "Стороны не договорились" });
    const refund = `dispute:${disputeId}:refund`;
    expect(await opOf(refund)).toMatchObject({ status: "FAILED", amount: 100_000 });

    // Экран показывает оператору повтор только для операции, которая всё ещё должна быть выполнена.
    const view = await getDealView(operator, f.dealId);
    expect(view.operations.map((o) => o.retryKey).filter(Boolean)).toEqual([refund]);

    expect(await code(retryPaymentOperation(operator, { idempotencyKey: release }))).toBe("CONFLICT");
    expect(await db.paymentOperation.count({ where: { idempotencyKey: `${release}:retry:1` } })).toBe(0);

    await retryPaymentOperation(operator, { idempotencyKey: refund });
    expect(await opOf(`${refund}:retry:1`)).toMatchObject({ status: "SUCCEEDED", amount: 100_000 });
    expect(await db.escrowAccount.findUniqueOrThrow({ where: { dealId: f.dealId } })).toMatchObject({ released: 0, refunded: 100_000 });
    expect((await getDealView(operator, f.dealId)).operations.every((o) => o.retryKey === null)).toBe(true);
  });
});
