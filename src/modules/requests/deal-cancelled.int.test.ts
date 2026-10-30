import { describe, expect, it } from "vitest";
import { cancelDeal } from "@/modules/deal-core";
import { db, transaction } from "@/platform/db";
import { makeDeal } from "../../../test/factories/deal";
import { onDealCancelled } from "./index";

describe("заявка закрывается, когда сделку отменили до начала работ", () => {
  it("отмена сделки → заявка CONTRACTING → CANCELLED в той же транзакции, с записью в журнале", async () => {
    const f = await makeDeal();

    await cancelDeal(f.client, { dealId: f.dealId, reason: "Передумали" }, { onCancelled: onDealCancelled });

    const request = await db.request.findUniqueOrThrow({ where: { id: f.requestId } });
    expect(request.status).toBe("CANCELLED");
    expect(request.closedAt).not.toBeNull();
    expect(await db.auditEvent.count({ where: { action: "request.cancelled_with_deal", entityId: f.requestId } })).toBe(1);
  });

  it("ошибка хука откатывает и отмену сделки", async () => {
    const f = await makeDeal();
    const failing = async () => {
      throw new Error("requests упал");
    };
    await expect(cancelDeal(f.client, { dealId: f.dealId }, { onCancelled: failing })).rejects.toThrow("requests упал");
    expect((await db.deal.findUniqueOrThrow({ where: { id: f.dealId } })).status).toBe("AWAITING_SIGNATURES");
  });

  it("повторный вызов и заявка не в CONTRACTING ничего не меняют", async () => {
    const f = await makeDeal();
    await cancelDeal(f.client, { dealId: f.dealId }, { onCancelled: onDealCancelled });
    await transaction((tx) => onDealCancelled(tx, f.dealId));
    expect(await db.auditEvent.count({ where: { action: "request.cancelled_with_deal", entityId: f.requestId } })).toBe(1);

    const g = await makeDeal();
    await db.request.update({ where: { id: g.requestId }, data: { status: "CLOSED" } });
    await transaction((tx) => onDealCancelled(tx, g.dealId));
    expect((await db.request.findUniqueOrThrow({ where: { id: g.requestId } })).status).toBe("CLOSED");
  });
});
