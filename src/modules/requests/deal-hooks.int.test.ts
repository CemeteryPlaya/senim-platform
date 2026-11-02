import { afterEach, describe, expect, it } from "vitest";
import { cancelDeal, openDispute, registerRequestsPort, resolveDispute } from "@/modules/deal-core";
import { db, transaction } from "@/platform/db";
import { makeOperator } from "../../../test/factories";
import { dealAt, makeDeal, signAct, signContract } from "../../../test/factories/deal";
import { onDealCancelled, onDealSigned, requestsPort } from "./index";

const statusOf = async (requestId: string) => (await db.request.findUniqueOrThrow({ where: { id: requestId } })).status;
const closedAudits = (requestId: string) => db.auditEvent.count({ where: { action: "request.closed", entityId: requestId } });
const cancelAudits = (requestId: string) => db.auditEvent.count({ where: { action: "request.cancelled_with_deal", entityId: requestId } });
const dispute = (user: Parameters<typeof openDispute>[0], dealId: string) => openDispute(user, { dealId, reason: "QUALITY", description: "Работа не по оферте" });

// Порт зарегистрирован в test/setup-integration.ts, как на сервере; тест «ошибка порта» подменяет его.
afterEach(() => registerRequestsPort(requestsPort));

describe("оферта заключена — заявка закрыта (порт requests в deal-core)", () => {
  it("подпись оферты обеими сторонами → заявка CONTRACTING → CLOSED с записью в журнале; повтор ничего не меняет", async () => {
    const f = await makeDeal();
    expect(await statusOf(f.requestId)).toBe("CONTRACTING");

    await signContract(f.dealId);

    const request = await db.request.findUniqueOrThrow({ where: { id: f.requestId } });
    expect(request.status).toBe("CLOSED");
    expect(request.closedAt).not.toBeNull();
    await transaction((tx) => onDealSigned(tx, f.dealId));
    expect(await closedAudits(f.requestId)).toBe(1);
  });

  it("акт приёмки заявку не трогает", async () => {
    const f = await dealAt("READY");
    await signAct(f.dealId);
    expect(await statusOf(f.requestId)).toBe("CLOSED");
    expect(await closedAudits(f.requestId)).toBe(1);
  });
});

describe("сделка закончилась без выплаты мастеру — заявка отменена", () => {
  it("отмена до подписи оферты → заявка CONTRACTING → CANCELLED в той же транзакции, с записью в журнале", async () => {
    const f = await makeDeal();
    await cancelDeal(f.client, { dealId: f.dealId, reason: "Передумали" });

    const request = await db.request.findUniqueOrThrow({ where: { id: f.requestId } });
    expect(request.status).toBe("CANCELLED");
    expect(request.closedAt).not.toBeNull();
    expect(await cancelAudits(f.requestId)).toBe(1);
  });

  it("оферта подписана, оплаты нет — отмена: CLOSED → CANCELLED", async () => {
    const f = await dealAt("SIGNED");
    await cancelDeal(f.client, { dealId: f.dealId });
    expect(await statusOf(f.requestId)).toBe("CANCELLED");
    const audit = await db.auditEvent.findFirstOrThrow({ where: { action: "request.cancelled_with_deal", entityId: f.requestId } });
    expect(audit.before).toEqual({ status: "CLOSED" });
  });

  it("отмена после оплаты (возврат денег) → заявка CANCELLED", async () => {
    const f = await dealAt("PAID_HOLD");
    expect(await cancelDeal(f.client, { dealId: f.dealId })).toEqual({ status: "REFUND_REQUESTED" });
    expect((await db.deal.findUniqueOrThrow({ where: { id: f.dealId } })).status).toBe("REFUNDED");
    expect(await statusOf(f.requestId)).toBe("CANCELLED");
  });

  it("спор: полный возврат → заявка CANCELLED; раздел — заявка остаётся CLOSED (работа оплачена)", async () => {
    const refund = await dealAt("IN_PROGRESS");
    const { disputeId } = await dispute(refund.client, refund.dealId);
    await resolveDispute(await makeOperator(), { disputeId, outcome: "FULL_REFUND", rationale: "Работы не выполнены" });
    expect(await statusOf(refund.requestId)).toBe("CANCELLED");

    const split = await dealAt("IN_PROGRESS");
    const second = await dispute(split.client, split.dealId);
    await resolveDispute(await makeOperator(), { disputeId: second.disputeId, outcome: "PARTIAL_SPLIT", masterShareTiyn: "5000000", rationale: "Сделана половина" });
    expect(await statusOf(split.requestId)).toBe("CLOSED");
  });

  it("ошибка порта откатывает и отмену сделки", async () => {
    const f = await makeDeal();
    registerRequestsPort({
      ...requestsPort,
      onDealCancelled: async () => {
        throw new Error("requests упал");
      },
    });
    await expect(cancelDeal(f.client, { dealId: f.dealId })).rejects.toThrow("requests упал");
    expect((await db.deal.findUniqueOrThrow({ where: { id: f.dealId } })).status).toBe("CREATED");
  });

  it("повторный вызов и заявка не в CONTRACTING/CLOSED ничего не меняют", async () => {
    const f = await makeDeal();
    await cancelDeal(f.client, { dealId: f.dealId });
    await transaction((tx) => onDealCancelled(tx, f.dealId));
    expect(await cancelAudits(f.requestId)).toBe(1);

    const g = await makeDeal();
    await db.request.update({ where: { id: g.requestId }, data: { status: "OPEN" } });
    await transaction((tx) => onDealCancelled(tx, g.dealId));
    expect(await statusOf(g.requestId)).toBe("OPEN");
  });
});
