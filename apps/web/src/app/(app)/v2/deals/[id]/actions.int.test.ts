import { beforeEach, describe, expect, it, vi } from "vitest";
import { db } from "@/platform/db";
import { makeClient } from "../../../../../../test/factories";
import { dealAt, journalOf } from "../../../../../../test/factories/deal";
import { freshBrowser } from "../../../../../../test/factories/identity";
import { signInAs } from "../../../../../../test/factories/session";
import { cancelDealAction } from "./actions";

vi.mock("next/headers", async () => (await import("../../../../../../test/factories/identity")).nextHeadersMock);

beforeEach(() => {
  freshBrowser({ "user-agent": "vitest" });
});

const auditCount = (dealId: string, action: string) => db.auditEvent.count({ where: { action, scope: `deal:${dealId}` } });

describe("cancelDealAction", () => {
  it("до оплаты: сделка отменена, денег в журнале нет, событие одно", async () => {
    const f = await dealAt("SIGNED");
    await signInAs(f.client);
    expect(await cancelDealAction({ dealId: f.dealId })).toEqual({ ok: true, data: { status: "CANCELLED" } });
    expect((await db.deal.findUniqueOrThrow({ where: { id: f.dealId } })).status).toBe("CANCELLED");
    expect(await journalOf(f.dealId)).toEqual([]);
    expect(await auditCount(f.dealId, "deal.cancelled")).toBe(1);
  });

  it("после оплаты: возврат всей зарезервированной суммы (цена и защита сделки) на карту", async () => {
    const f = await dealAt("PAID_HOLD");
    await signInAs(f.client);
    expect(await cancelDealAction({ dealId: f.dealId })).toEqual({ ok: true, data: { status: "REFUND_REQUESTED" } });
    const journal = await journalOf(f.dealId);
    const hold = journal.find((e) => e.type === "HOLD");
    const refunds = journal.filter((e) => e.type === "REFUND");
    expect(refunds).toHaveLength(1);
    expect(refunds[0]?.amountTiyn).toBe(hold?.amountTiyn);
    expect(refunds[0]?.amountTiyn).toBe((await db.deal.findUniqueOrThrow({ where: { id: f.dealId } })).buyerTotalTiyn);
  });

  it("двойное нажатие до оплаты: один эффект, второй вызов — конфликт", async () => {
    const f = await dealAt("SIGNED");
    await signInAs(f.client);
    const results = await Promise.all([cancelDealAction({ dealId: f.dealId }), cancelDealAction({ dealId: f.dealId })]);
    expect(results.filter((r) => r.ok)).toHaveLength(1);
    const failed = results.find((r) => !r.ok);
    expect(failed && !failed.ok ? failed.code : null).toBe("CONFLICT");
    expect(await auditCount(f.dealId, "deal.cancelled")).toBe(1);
  });

  it("двойное нажатие после оплаты: один возврат, второй вызов отклонён", async () => {
    const f = await dealAt("PAID_HOLD");
    await signInAs(f.client);
    const results = await Promise.all([cancelDealAction({ dealId: f.dealId }), cancelDealAction({ dealId: f.dealId })]);
    expect(results.filter((r) => r.ok)).toHaveLength(1);
    expect((await journalOf(f.dealId)).filter((e) => e.type === "REFUND")).toHaveLength(1);
    expect(await auditCount(f.dealId, "deal.cancel.requested")).toBe(1);
  });

  it("чужая сделка: не найдена, статус не меняется", async () => {
    const f = await dealAt("SIGNED");
    await signInAs(await makeClient("Нурланов Айдос Ержанович"));
    const result = await cancelDealAction({ dealId: f.dealId });
    expect(result.ok ? null : result.code).toBe("NOT_FOUND");
    expect((await db.deal.findUniqueOrThrow({ where: { id: f.dealId } })).status).toBe("CREATED");
  });

  it("мастер этим действием отменить не может (только покупатель)", async () => {
    const f = await dealAt("SIGNED");
    await signInAs(f.executor);
    expect((await cancelDealAction({ dealId: f.dealId })).ok).toBe(false);
    expect((await db.deal.findUniqueOrThrow({ where: { id: f.dealId } })).status).toBe("CREATED");
  });

  it("плохой вход отклоняет схема", async () => {
    await signInAs(await makeClient());
    const result = await cancelDealAction({ dealId: "" });
    expect(result.ok ? null : result.code).toBe("VALIDATION");
  });
});
