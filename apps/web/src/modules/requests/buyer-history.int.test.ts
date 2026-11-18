import { describe, expect, it } from "vitest";
import type { DealStatus, RequestStatus } from "@/generated/prisma/enums";
import { db } from "@/platform/db";
import { makeClient, makeExecutor } from "../../../test/factories";
import { makeOfferThread } from "../../../test/factories/companies";
import { makeFurnitureType } from "../../../test/factories/requests";
import { buyerHistory } from "./buyer-history";

/** История заказов покупателя: счётчики и строки со статусом (сделки без оферты не считаются сделками). */

const code = (c: string) => expect.objectContaining({ code: c });

type Client = Awaited<ReturnType<typeof makeClient>>;

const thread = (client: Client, dealStatus: DealStatus | undefined, extra: { signed?: boolean; requestStatus?: RequestStatus } = {}) =>
  makeOfferThread({ client, dealStatus, signed: extra.signed, requestStatus: extra.requestStatus ?? (dealStatus ? "CLOSED" : "OPEN") });

const rowOf = async (client: Client, requestId: string) => (await buyerHistory(client)).rows.find((r) => r.requestId === requestId);

describe("история заказов покупателя: статус строки", () => {
  it.each([
    ["SPLIT_PAYOUT", "success"],
    ["CANCELLED", "cancelled"],
    ["REFUNDED", "failed"],
    ["IN_PROGRESS", "progress"],
    ["PAID_HOLD", "progress"],
  ] as const)("сделка %s с офертой — %s, href ведёт в сделку", async (dealStatus, state) => {
    const client = await makeClient();
    const t = await thread(client, dealStatus);

    const row = await rowOf(client, t.requestId);

    expect(row).toMatchObject({ state, href: `/deals/${t.dealId}`, priceTiyn: expect.any(BigInt) });
  });

  it("сделка без оферты в CANCELLED — отменён, ведёт в сделку", async () => {
    const client = await makeClient();
    const t = await thread(client, "CANCELLED", { signed: false });

    expect(await rowOf(client, t.requestId)).toMatchObject({ state: "cancelled", href: `/deals/${t.dealId}` });
  });

  it("сделка без оферты в CREATED — в процессе", async () => {
    const client = await makeClient();
    const t = await thread(client, "CREATED", { signed: false });

    expect(await rowOf(client, t.requestId)).toMatchObject({ state: "progress" });
  });

  it("заявка без сделки: OPEN — в процессе, CANCELLED — отменён; href — заявка, цены и мастера нет", async () => {
    const client = await makeClient();
    const open = await thread(client, undefined);
    const cancelled = await thread(client, undefined, { requestStatus: "CANCELLED" });

    expect(await rowOf(client, open.requestId)).toMatchObject({ state: "progress", href: `/requests/${open.requestId}`, executorLabel: null, priceTiyn: null });
    expect(await rowOf(client, cancelled.requestId)).toMatchObject({ state: "cancelled", href: `/requests/${cancelled.requestId}` });
  });

  it("заявка CANCELLED со сделкой с офертой в процессе — по сделке", async () => {
    const client = await makeClient();
    const t = await thread(client, "IN_PROGRESS", { requestStatus: "CANCELLED" });

    expect(await rowOf(client, t.requestId)).toMatchObject({ state: "progress" });
  });
});

describe("история заказов покупателя: содержимое", () => {
  it("название как в «Моих заявках», мастер по ADR-006, цена сделки, дата — публикация", async () => {
    const client = await makeClient();
    const executor = await makeExecutor();
    const type = await makeFurnitureType("Шкаф-купе");
    const t = await makeOfferThread({ client, executor, dealStatus: "SPLIT_PAYOUT", requestStatus: "CLOSED" });
    await db.request.update({ where: { id: t.requestId }, data: { furnitureTypeId: type.id } });
    const deal = await db.deal.findUniqueOrThrow({ where: { id: t.dealId! } });
    const request = await db.request.findUniqueOrThrow({ where: { id: t.requestId } });

    const row = await rowOf(client, t.requestId);

    expect(row?.title).toBe("Шкаф-купе");
    expect(row?.executorLabel).toBe(`Исполнитель №${executor.executor.publicNumber}`);
    expect(row?.priceTiyn).toBe(deal.priceTiyn);
    expect(row?.at).toEqual(request.publishedAt);
  });

  it("at — дата создания, если публикации не было; новые выше", async () => {
    const client = await makeClient();
    const older = await thread(client, undefined);
    const newer = await thread(client, undefined);
    await db.request.update({ where: { id: older.requestId }, data: { publishedAt: new Date("2026-01-01T00:00:00Z") } });
    await db.request.update({ where: { id: newer.requestId }, data: { publishedAt: null } });
    const created = (await db.request.findUniqueOrThrow({ where: { id: newer.requestId } })).createdAt;

    const { rows } = await buyerHistory(client);

    expect(rows.map((r) => r.requestId)).toEqual([newer.requestId, older.requestId]);
    expect(rows[0]?.at).toEqual(created);
  });

  it("не больше 100 строк, а счётчики — по всем заявкам", async () => {
    const client = await makeClient();
    await db.request.createMany({
      data: Array.from({ length: 103 }, () => ({ clientId: client.id, mode: "TENDER" as const, status: "OPEN" as const, segment: "COMFORT" as const })),
    });

    const h = await buyerHistory(client);

    expect(h.rows).toHaveLength(100);
    expect(h.counts.orders).toBe(103);
  });
});

describe("история заказов покупателя: счётчики и доступ", () => {
  it("заказы — кроме черновиков; сделки — с офертой; успешные — SPLIT_PAYOUT", async () => {
    const client = await makeClient();
    await db.request.create({ data: { clientId: client.id, mode: "TENDER", status: "DRAFT", segment: "COMFORT" } });
    await thread(client, undefined);
    await thread(client, "SPLIT_PAYOUT");
    await thread(client, "CANCELLED");
    await thread(client, "REFUNDED");
    await thread(client, "IN_PROGRESS");
    await thread(client, "CREATED", { signed: false });
    await thread(client, "CANCELLED", { signed: false });

    const h = await buyerHistory(client);

    expect(h.counts).toEqual({ orders: 7, deals: 4, successful: 1 });
    expect(h.rows).toHaveLength(7);
  });

  it("черновик в строки не входит", async () => {
    const client = await makeClient();
    const draft = await db.request.create({ data: { clientId: client.id, mode: "TENDER", status: "DRAFT", segment: "COMFORT" } });

    const h = await buyerHistory(client);

    expect(h.rows.find((r) => r.requestId === draft.id)).toBeUndefined();
    expect(h.counts).toEqual({ orders: 0, deals: 0, successful: 0 });
  });

  it("чужие заявки не видны", async () => {
    const mine = await makeClient();
    const other = await makeClient();
    await thread(other, "SPLIT_PAYOUT");

    const h = await buyerHistory(mine);

    expect(h).toEqual({ counts: { orders: 0, deals: 0, successful: 0 }, rows: [] });
  });

  it("мастер без роли покупателя — FORBIDDEN", async () => {
    const master = await makeExecutor();

    await expect(buyerHistory(master)).rejects.toThrow(code("FORBIDDEN"));
  });
});
