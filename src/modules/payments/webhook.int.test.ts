import { describe, expect, it } from "vitest";
import { dealOf, makeDeal, signContract } from "../../../test/factories/deal";
import { onMoneySettled } from "@/modules/deal-core";
import { db, transaction } from "@/platform/db";
import { computeDealMoney } from "./money";
import { moneyKey } from "./keys";
import { recordOperation } from "./ledger";
import { signMockWebhook } from "./providers/mock";
import { receiveWebhook } from "./webhook";

/** Вебхук провайдера: подпись, дедупликация по externalEventId, итог по ключу операции, хук deal-core. */
async function pendingHold() {
  const f = await makeDeal();
  await signContract(f.dealId);
  const deal = await dealOf(f.dealId);
  const { entry } = await transaction((tx) =>
    recordOperation(tx, { dealId: f.dealId, type: "HOLD", amountTiyn: deal.buyerTotalTiyn, idempotencyKey: moneyKey.hold(f.dealId), provider: "MOCK", isTest: true }),
  );
  return { ...f, op: entry };
}

const event = (idempotencyKey: string, eventId = "e1", status: "SUCCEEDED" | "FAILED" = "SUCCEEDED") => JSON.stringify({ eventId, idempotencyKey, status, externalRef: "BANK-77" });
const deliver = (body: string, headers = signMockWebhook(body)) => receiveWebhook("mock", headers, body, onMoneySettled);

describe("вебхук mock", () => {
  it("итог HOLD двигает сделку; повторная доставка того же события — без второго эффекта", async () => {
    const { dealId, op } = await pendingHold();
    const body = event(op.idempotencyKey);
    expect(await deliver(body)).toMatchObject({ processed: "settled", response: { status: 200 } });
    expect(await dealOf(dealId)).toMatchObject({ status: "PAID_HOLD" });
    expect(await db.moneyTransaction.findUniqueOrThrow({ where: { id: op.id } })).toMatchObject({ status: "SUCCEEDED", externalRef: "BANK-77" });

    expect(await deliver(body)).toMatchObject({ processed: "duplicate", response: { status: 200 } });
    const results = await Promise.all([deliver(body), deliver(body)]);
    expect(results.map((r) => r.processed)).toEqual(["duplicate", "duplicate"]);
    expect(await db.paymentWebhookEvent.count()).toBe(1);
    expect(await db.auditEvent.count({ where: { action: "deal.paid" } })).toBe(1);
    expect(await db.notification.count({ where: { kind: "money.hold.succeeded" } })).toBe(2);
  });

  it("параллельные доставки одного события — обрабатывается одна", async () => {
    const { op } = await pendingHold();
    const body = event(op.idempotencyKey, "e-par");
    const results = await Promise.all([deliver(body), deliver(body), deliver(body)]);
    expect(results.filter((r) => r.processed === "settled")).toHaveLength(1);
    expect(await db.auditEvent.count({ where: { action: "payment.operation.succeeded" } })).toBe(1);
  });

  it("другое событие о той же операции после итога — сохранено, итог не меняется", async () => {
    const { dealId, op } = await pendingHold();
    await deliver(event(op.idempotencyKey, "e1"));
    await deliver(event(op.idempotencyKey, "e2", "FAILED"));
    expect(await db.moneyTransaction.findUniqueOrThrow({ where: { id: op.id } })).toMatchObject({ status: "SUCCEEDED" });
    expect(await dealOf(dealId)).toMatchObject({ status: "PAID_HOLD" });
    expect(await db.paymentWebhookEvent.count()).toBe(2);
  });

  it("неверная или старая подпись — 400, событие не сохраняется", async () => {
    const { op } = await pendingHold();
    const body = event(op.idempotencyKey);
    const forged = new Headers(signMockWebhook(body));
    forged.set("x-mock-signature", "v1=00");
    expect(await deliver(body, forged)).toMatchObject({ processed: "rejected", response: { status: 400 } });
    expect(await deliver(body, signMockWebhook(body, new Date(Date.now() - 3600_000)))).toMatchObject({ processed: "rejected" });
    expect(await deliver("не json")).toMatchObject({ processed: "rejected" });
    expect(await db.paymentWebhookEvent.count()).toBe(0);
  });

  it("неизвестная операция или операция другого провайдера — событие сохранено с ошибкой, деньги не тронуты", async () => {
    const { dealId } = await pendingHold();
    expect(await deliver(event("hold:unknown"))).toMatchObject({ processed: "unknown-operation" });
    const manual = await makeDeal({ provider: "manual" });
    const { entry } = await transaction((tx) =>
      recordOperation(tx, { dealId: manual.dealId, type: "HOLD", amountTiyn: computeDealMoney(1000n).buyerTotalTiyn, idempotencyKey: "hold:manual-x", provider: "MANUAL", isTest: false }),
    );
    expect(await deliver(event(entry.idempotencyKey, "e-manual"))).toMatchObject({ processed: "unknown-operation" });
    expect(await db.moneyTransaction.findUniqueOrThrow({ where: { id: entry.id } })).toMatchObject({ status: "PENDING" });
    expect(await dealOf(dealId)).toMatchObject({ status: "CREATED" });
    expect(await db.paymentWebhookEvent.count({ where: { error: "unknown operation" } })).toBe(2);
  });

  it("manual не принимает вебхуков", async () => {
    expect(await receiveWebhook("manual", new Headers(), "{}", onMoneySettled)).toMatchObject({ processed: "rejected" });
  });
});
