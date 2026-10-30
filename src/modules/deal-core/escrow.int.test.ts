import { describe, expect, it, vi } from "vitest";
import { executeOperation, railFor, reconcile, requestOperation, simulatorDeposit, simulatorRedeliver } from "@/modules/payments";
import { db, transaction } from "@/platform/db";
import { makeOperator } from "../../../test/factories";
import { dealOf, makeDeal, makeStagePhoto, noCancelHooks, signAct, signContract, stagesOf, type DealFixture } from "../../../test/factories/deal";
import {
  acceptStage,
  cancelDeal,
  handleRailWebhook,
  markStagePaid,
  openDispute,
  resolveDispute,
  startStage,
  submitStage,
} from "./index";
import { onPaymentSettled } from "./service";

const code = (p: Promise<unknown>) => p.then(() => "OK", (e: { code?: string }) => e.code ?? String(e));

const accountOf = (dealId: string) => db.escrowAccount.findUniqueOrThrow({ where: { dealId } });

/** Банк зачисляет деньги и доставляет подписанный вебхук платформе. */
async function deposit(f: DealFixture, amount: number) {
  const account = await accountOf(f.dealId);
  const delivery = await simulatorDeposit(f.client, { accountId: account.id, amount });
  return handleRailWebhook("escrow-simulator", { headers: new Headers(delivery.headers), rawBody: delivery.rawBody });
}

/** Эскроу-сделка (симулятор), договор подписан, счёт открыт. */
async function signedEscrowDeal(total = 100_000) {
  const f = await makeDeal({ rail: "escrow-simulator", total });
  await signContract(f.dealId);
  return f;
}

async function finishStage(f: DealFixture, stageId: string) {
  await startStage(f.executor, { stageId });
  await submitStage(f.executor, { stageId, report: "Этап готов", photoIds: [await makeStagePhoto(f.executor)] });
  await acceptStage(f.client, { stageId });
}

describe("эскроу-сделка в банк-симуляторе", () => {
  it("подпись договора → счёт открыт, ждём пополнения; отметок «Я оплатил» нет", async () => {
    const f = await signedEscrowDeal();
    expect(await dealOf(f.dealId)).toMatchObject({ status: "AWAITING_DEPOSIT", paymentMode: "ESCROW_SIMULATOR" });
    const account = await accountOf(f.dealId);
    expect(account).toMatchObject({ rail: "ESCROW_SIMULATOR", status: "OPENED", deposited: 0 });
    expect((account.requisites as { iban: string }).iban).toMatch(/^KZ00999\d{13}$/);

    const [advance] = await stagesOf(f.dealId);
    expect(await code(markStagePaid(f.client, { stageId: advance.id }))).toBe("CONFLICT");
  });

  it("частичное пополнение не запускает работы, полное — запускает и раскрывает аванс", async () => {
    const f = await signedEscrowDeal();
    await deposit(f, 30_000);
    expect(await dealOf(f.dealId)).toMatchObject({ status: "AWAITING_DEPOSIT" });

    await deposit(f, 70_000);
    expect(await dealOf(f.dealId)).toMatchObject({ status: "IN_PROGRESS" });
    const [advance] = await stagesOf(f.dealId);
    expect(advance.payment).toMatchObject({ status: "CONFIRMED" });
    expect(await accountOf(f.dealId)).toMatchObject({ deposited: 100_000, released: 50_000, status: "PARTIALLY_RELEASED" });
    expect(await db.paymentOperation.findUniqueOrThrow({ where: { idempotencyKey: `release:${advance.id}` } })).toMatchObject({
      status: "SUCCEEDED",
      amount: 50_000,
    });
  });

  it("повторная доставка вебхука не зачисляет деньги второй раз", async () => {
    const f = await signedEscrowDeal();
    const first = await deposit(f, 100_000);
    expect(first.duplicate).toBe(false);

    const account = await accountOf(f.dealId);
    const again = await simulatorRedeliver(f.client, { accountId: account.id });
    const second = await handleRailWebhook("escrow-simulator", { headers: new Headers(again!.headers), rawBody: again!.rawBody });
    expect(second.duplicate).toBe(true);
    expect(await accountOf(f.dealId)).toMatchObject({ deposited: 100_000 });
    expect(await db.paymentOperation.count({ where: { dealId: f.dealId, kind: "DEPOSIT" } })).toBe(1);
    expect(await db.bankWebhookEvent.count()).toBe(1);
  });

  it("вебхук с поддельной подписью отклоняется и ничего не меняет", async () => {
    const f = await signedEscrowDeal();
    const account = await accountOf(f.dealId);
    const real = await simulatorDeposit(f.client, { accountId: account.id, amount: 100_000 });
    const forged = real.rawBody.replace("100000", "999999");
    expect(await code(handleRailWebhook("escrow-simulator", { headers: new Headers(real.headers), rawBody: forged }))).toBe("UNAUTHENTICATED");
    expect(await accountOf(f.dealId)).toMatchObject({ deposited: 0 });
  });

  it("сбой между банком и журналом: повтор и параллельный воркер не двигают деньги второй раз", async () => {
    const f = await signedEscrowDeal();
    await deposit(f, 100_000);
    const account = await accountOf(f.dealId);
    const key = "test:crash-after-bank";
    await transaction((tx) => requestOperation(tx, { dealId: f.dealId, kind: "REFUND", amount: 10_000, idempotencyKey: key }));
    // Банк уже выполнил операцию, а процесс упал до записи результата: операция в журнале PENDING
    await railFor("escrow-simulator").refund({ externalId: account.externalId, dealId: f.dealId, amount: 10_000, reason: "test", idempotencyKey: key });

    await Promise.all([executeOperation(key, onPaymentSettled), executeOperation(key, onPaymentSettled)]);
    expect(await db.paymentOperation.findUniqueOrThrow({ where: { idempotencyKey: key } })).toMatchObject({ status: "SUCCEEDED" });
    expect(await accountOf(f.dealId)).toMatchObject({ refunded: 10_000 });
    const rows = (await reconcile(f.dealId)).filter((r) => r.idempotencyKey === key);
    expect(rows).toEqual([expect.objectContaining({ status: "MATCHED", ourAmount: 10_000, bankAmount: 10_000 })]);
  });

  it("двойной клик «Принять этап» — один транш, сделка закрывается после актов", async () => {
    const f = await signedEscrowDeal();
    await deposit(f, 100_000);
    const [advance, work, final] = await stagesOf(f.dealId);
    await finishStage(f, advance.id);
    await finishStage(f, work.id);
    await startStage(f.executor, { stageId: final.id });
    await submitStage(f.executor, { stageId: final.id, report: "Монтаж завершён", photoIds: [await makeStagePhoto(f.executor)] });

    const results = await Promise.allSettled([acceptStage(f.client, { stageId: final.id }), acceptStage(f.client, { stageId: final.id })]);
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    expect(await db.paymentOperation.count({ where: { stageId: final.id, kind: "RELEASE" } })).toBe(1);

    const key = `release:${final.id}`;
    const statement = (await reconcile(f.dealId)).filter((r) => r.idempotencyKey === key);
    expect(statement).toEqual([expect.objectContaining({ status: "MATCHED", ourAmount: 50_000, bankAmount: 50_000 })]);
    expect(await accountOf(f.dealId)).toMatchObject({ released: 100_000, status: "CLOSED" });

    for (const s of [advance, work, final]) await signAct(s.id);
    expect(await dealOf(f.dealId)).toMatchObject({ status: "COMPLETED" });
  });

  it("сверка: журнал платформы совпадает с выпиской банка", async () => {
    const f = await signedEscrowDeal();
    await deposit(f, 100_000);
    const rows = await reconcile(f.dealId);
    expect(rows.map((r) => [r.kind, r.status])).toEqual([
      ["DEPOSIT", "MATCHED"],
      ["RELEASE", "MATCHED"],
    ]);
  });

  it("отмена после частичного пополнения возвращает внесённое заказчику", async () => {
    const f = await signedEscrowDeal();
    await deposit(f, 30_000);
    await cancelDeal(f.client, { dealId: f.dealId, reason: "Нашли другого мастера" }, noCancelHooks);
    expect(await dealOf(f.dealId)).toMatchObject({ status: "CANCELLED" });
    expect(await accountOf(f.dealId)).toMatchObject({ deposited: 30_000, refunded: 30_000, status: "REFUNDED" });
    expect(await db.paymentOperation.findUniqueOrThrow({ where: { idempotencyKey: `cancel:${f.dealId}:refund` } })).toMatchObject({
      status: "SUCCEEDED",
    });
  });

  it("частичное решение спора: исполнителю присуждённое, остаток — заказчику", async () => {
    const f = await signedEscrowDeal();
    await deposit(f, 100_000);
    const [advance, work] = await stagesOf(f.dealId);
    await finishStage(f, advance.id);
    await startStage(f.executor, { stageId: work.id });
    const { disputeId } = await openDispute(f.client, { dealId: f.dealId, reason: "DEADLINE", description: "Сроки сорваны на месяц" });
    const operator = await makeOperator();
    await resolveDispute(operator, { disputeId, decision: "PARTIAL", decisionAmount: 20_000, rationale: "Часть работы выполнена" });

    expect(await dealOf(f.dealId)).toMatchObject({ status: "TERMINATED" });
    expect(await accountOf(f.dealId)).toMatchObject({ released: 70_000, refunded: 30_000, status: "CLOSED" });
    expect((await reconcile(f.dealId)).every((r) => r.status === "MATCHED")).toBe(true);
  });

  it("транш в пути: расторжение не возвращает транзитную сумму и не платит дважды", async () => {
    const f = await signedEscrowDeal();
    await deposit(f, 100_000);
    const [advance, work, final] = await stagesOf(f.dealId);
    await finishStage(f, advance.id);
    await finishStage(f, work.id);
    await startStage(f.executor, { stageId: final.id });
    await submitStage(f.executor, { stageId: final.id, report: "Монтаж завершён", photoIds: [await makeStagePhoto(f.executor)] });
    // Банк не ответил на раскрытие транша за приёмку: операция остаётся в пути (PENDING).
    const down = vi.spyOn(railFor("escrow-simulator"), "releaseTranche").mockRejectedValueOnce(new Error("банк недоступен"));
    await acceptStage(f.client, { stageId: final.id });
    down.mockRestore();
    expect(await db.paymentOperation.findUniqueOrThrow({ where: { idempotencyKey: `release:${final.id}` } })).toMatchObject({ status: "PENDING" });

    const { disputeId } = await openDispute(f.client, { dealId: f.dealId, reason: "QUALITY", description: "Монтаж с перекосом дверей" });
    const operator = await makeOperator();
    // Неоплаченного не осталось: транш уже запрошен — частичное решение не может присудить его второй раз.
    expect(
      await code(resolveDispute(operator, { disputeId, decision: "PARTIAL", decisionAmount: 10_000, rationale: "Часть работы с браком" })),
    ).toBe("VALIDATION");
    await resolveDispute(operator, { disputeId, decision: "TERMINATE", rationale: "Стороны не договорились" });

    expect(await db.paymentOperation.count({ where: { idempotencyKey: `dispute:${disputeId}:refund` } })).toBe(0);
    expect(await db.paymentOperation.count({ where: { dealId: f.dealId, status: "FAILED" } })).toBe(0);
    expect(await accountOf(f.dealId)).toMatchObject({ deposited: 100_000, released: 100_000, refunded: 0 });
    expect((await reconcile(f.dealId)).every((r) => r.status === "MATCHED")).toBe(true);
  });
});
