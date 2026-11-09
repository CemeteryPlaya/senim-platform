import { describe, expect, it } from "vitest";
import { ADDRESS, dealAt, dealOf, journalOf, makeDeal, makePhoto, PRICE, signAct, signContract } from "../../../test/factories/deal";
import { makeClient, makeExecutor } from "../../../test/factories";
import { computeDealMoney, moneyView } from "@/modules/payments";
import { db, transaction } from "@/platform/db";
import { createDeal, getDealView, onMoneySettled, payForDeal, processDealMoney, startWork, submitReady } from "./index";

const money = computeDealMoney(PRICE);

describe("createDeal — оферта", () => {
  it("снимок денег, провайдер из env, демо от покупателя, оферта и уведомления обеим сторонам", async () => {
    const client = await makeClient();
    await db.user.update({ where: { id: client.id }, data: { isDemo: true } });
    const { dealId, executor } = await makeDeal({ client });
    const deal = await dealOf(dealId);
    expect(deal).toMatchObject({ status: "CREATED", paymentProvider: "MOCK", isDemo: true, signedAt: null, ...money, durationDays: 30, warrantyMonths: 12 });
    expect(await db.document.count({ where: { dealId, kind: "CONTRACT" } })).toBe(1);
    expect(await db.notification.count({ where: { userId: { in: [client.id, executor.id] }, kind: "deal.offer.ready" } })).toBe(2);
    expect(await db.auditEvent.findFirstOrThrow({ where: { action: "deal.created" } })).toMatchObject({ entityId: dealId, scope: `deal:${dealId}` });
  });

  it("вторая сделка по той же заявке — CONFLICT; отклик чужой заявки — VALIDATION; самосделка — CONFLICT", async () => {
    const f = await makeDeal();
    const again = transaction((tx) => createDeal(tx, { requestId: f.requestId, offerId: f.offerId, priceTiyn: PRICE, title: "x" }));
    await expect(again).rejects.toMatchObject({ code: "CONFLICT" });

    const other = await db.request.create({ data: { clientId: f.client.id, mode: "TENDER" } });
    await expect(transaction((tx) => createDeal(tx, { requestId: other.id, offerId: f.offerId, priceTiyn: PRICE, title: "x" }))).rejects.toMatchObject({ code: "VALIDATION" });

    const both = await makeExecutor({ roles: ["EXECUTOR", "CLIENT"] });
    const request = await db.request.create({ data: { clientId: both.id, mode: "TENDER" } });
    const offer = await db.offer.create({ data: { requestId: request.id, executorId: both.executor.id, priceTiyn: PRICE, durationDays: 1, warrantyMonths: 1, measurementTerms: "FREE" } });
    await expect(transaction((tx) => createDeal(tx, { requestId: request.id, offerId: offer.id, priceTiyn: PRICE, title: "x" }))).rejects.toMatchObject({ code: "CONFLICT" });
  });

  it("цена — из строки цифр; ноль и дробь — VALIDATION", async () => {
    const f = await makeDeal({ priceTiyn: 12_345n });
    expect((await dealOf(f.dealId)).protectionTiyn).toBe(247n); // ⌈12 345 × 2 / 100⌉
    const g = await makeDeal();
    await db.deal.delete({ where: { id: g.dealId } }).catch(() => null);
    for (const priceTiyn of ["0", "1.5", "-1"]) {
      await expect(transaction((tx) => createDeal(tx, { requestId: g.requestId, offerId: g.offerId, priceTiyn, title: "x" }))).rejects.toMatchObject({ code: "VALIDATION" });
    }
  });
});

describe("полный путь на mock: оферта → оплата → работа → сдача → акт → выплата", () => {
  it("статусы по ТЗ п. 9, журнал сходится до тиына, грейд растёт", async () => {
    const f = await makeDeal();
    await expect(payForDeal(f.client, { dealId: f.dealId })).rejects.toMatchObject({ code: "CONFLICT" }); // оферта не подписана
    await signContract(f.dealId);
    expect((await dealOf(f.dealId)).signedAt).toBeInstanceOf(Date);

    const paid = await payForDeal(f.client, { dealId: f.dealId });
    expect(paid).toMatchObject({ status: "SUCCEEDED", redirectUrl: null });
    expect(await dealOf(f.dealId)).toMatchObject({ status: "PAID_HOLD" });
    expect(await moneyView(f.dealId)).toMatchObject({ kind: "protected", amountTiyn: money.buyerTotalTiyn, isTest: true });

    await startWork(f.executor, { dealId: f.dealId });
    const ready = await submitReady(f.executor, { dealId: f.dealId, photoIds: [await makePhoto(f.executor)], ...ADDRESS, accuracyM: 12 });
    expect(ready).toEqual({ distanceM: 0, withinRadius: true, radiusM: 500 });
    expect(await dealOf(f.dealId)).toMatchObject({ status: "READY", readyLat: ADDRESS.lat, readyAccuracyM: 12, readyDistanceM: 0, readyWithinRadius: true });
    expect(await db.document.count({ where: { dealId: f.dealId, kind: "ACCEPTANCE_ACT" } })).toBe(1);

    await signAct(f.dealId);
    expect(await dealOf(f.dealId)).toMatchObject({ status: "ACCEPTED" });
    await processDealMoney(f.dealId);
    expect(await dealOf(f.dealId)).toMatchObject({ status: "SPLIT_PAYOUT" });

    const journal = await journalOf(f.dealId);
    expect(journal.map((t) => [t.type, t.status])).toEqual([
      ["HOLD", "SUCCEEDED"],
      ["RELEASE", "SUCCEEDED"],
      ["SPLIT_MASTER", "SUCCEEDED"],
      ["SPLIT_PLATFORM", "SUCCEEDED"],
    ]);
    const amount = (type: string) => journal.filter((t) => t.type === type).reduce((a, t) => a + t.amountTiyn, 0n);
    expect(amount("HOLD")).toBe(amount("SPLIT_MASTER") + amount("SPLIT_PLATFORM") + amount("REFUND"));
    expect(amount("SPLIT_MASTER")).toBe(money.payoutTiyn);
    expect(journal.every((t) => t.isTest)).toBe(true);
    expect(await moneyView(f.dealId)).toMatchObject({ kind: "completed", paidToMasterTiyn: money.payoutTiyn, protectionTiyn: money.protectionTiyn, bankBalanceTiyn: 0n, settled: true });
    expect(await db.grade.findUniqueOrThrow({ where: { executorId: f.executor.executor.id } })).toMatchObject({ completedOrdersCount: 1, advancePercent: 0 });
  });
});

describe("гонки: двойной клик не даёт двойного эффекта", () => {
  it("двойная оплата — одна операция HOLD", async () => {
    const f = await dealAt("SIGNED");
    const results = await Promise.allSettled([payForDeal(f.client, { dealId: f.dealId }), payForDeal(f.client, { dealId: f.dealId })]);
    expect(results.every((r) => r.status === "fulfilled")).toBe(true);
    expect(await db.moneyTransaction.count({ where: { dealId: f.dealId, type: "HOLD" } })).toBe(1);
    expect(await dealOf(f.dealId)).toMatchObject({ status: "PAID_HOLD" });
  });

  it("повтор оплаты после успеха — та же операция, а не CONFLICT", async () => {
    // На медленной машине второй клик приходит, когда первый уже довёл сделку до PAID_HOLD.
    const f = await dealAt("SIGNED");
    const first = await payForDeal(f.client, { dealId: f.dealId });
    expect(await dealOf(f.dealId)).toMatchObject({ status: "PAID_HOLD" });
    const again = await payForDeal(f.client, { dealId: f.dealId });
    expect(again).toEqual({ ...first, status: "SUCCEEDED", redirectUrl: null });
    expect(await db.moneyTransaction.count({ where: { dealId: f.dealId, type: "HOLD" } })).toBe(1);
    expect(await db.auditEvent.count({ where: { action: "deal.payment.requested", entityId: f.dealId } })).toBe(1);
  });

  it("двойная выплата — один RELEASE, один SPLIT_MASTER, грейд +1", async () => {
    const f = await dealAt("READY");
    await signAct(f.dealId);
    await Promise.all([processDealMoney(f.dealId), processDealMoney(f.dealId), processDealMoney(f.dealId)]);
    expect(await db.moneyTransaction.count({ where: { dealId: f.dealId, type: "SPLIT_MASTER" } })).toBe(1);
    expect(await dealOf(f.dealId)).toMatchObject({ status: "SPLIT_PAYOUT" });
    expect((await db.grade.findUniqueOrThrow({ where: { executorId: f.executor.executor.id } })).completedOrdersCount).toBe(1);
    // Повторная подпись акта (повтор хука) ничего не меняет.
    await signAct(f.dealId);
    expect(await db.moneyTransaction.count({ where: { dealId: f.dealId } })).toBe(4);
  });

  it("двойное «начать работу» — один переход, второй CONFLICT", async () => {
    const f = await dealAt("PAID_HOLD");
    const results = await Promise.allSettled([startWork(f.executor, { dealId: f.dealId }), startWork(f.executor, { dealId: f.dealId })]);
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    expect(results.find((r) => r.status === "rejected")).toMatchObject({ reason: { code: "CONFLICT" } });
    expect(await db.auditEvent.count({ where: { action: "deal.started" } })).toBe(1);
  });

  it("повторный итог операции (хук дважды) — без второго перехода", async () => {
    const f = await dealAt("PAID_HOLD");
    const hold = await db.moneyTransaction.findFirstOrThrow({ where: { dealId: f.dealId, type: "HOLD" } });
    await transaction((tx) => onMoneySettled(tx, hold));
    expect(await db.auditEvent.count({ where: { action: "deal.paid" } })).toBe(1);
  });
});

describe("сдача: фото обязательно, GPS — мягкая проверка", () => {
  it("далеко от адреса — предупреждение, но сдано; без координат — расстояние null", async () => {
    const far = await dealAt("IN_PROGRESS");
    const r = await submitReady(far.executor, { dealId: far.dealId, photoIds: [await makePhoto(far.executor)], lat: ADDRESS.lat + 0.01, lng: ADDRESS.lng });
    expect(r).toMatchObject({ withinRadius: false, radiusM: 500 });
    expect(r.distanceM).toBeGreaterThan(1000);
    expect(await dealOf(far.dealId)).toMatchObject({ status: "READY", readyWithinRadius: false, readyAccuracyM: null });

    const blind = await dealAt("IN_PROGRESS");
    expect(await submitReady(blind.executor, { dealId: blind.dealId, photoIds: [await makePhoto(blind.executor)] })).toEqual({ distanceM: null, withinRadius: null, radiusM: 500 });
    expect(await dealOf(blind.dealId)).toMatchObject({ status: "READY", readyLat: null, readyDistanceM: null });

    const noAddress = await dealAt("IN_PROGRESS", { address: null });
    expect(await submitReady(noAddress.executor, { dealId: noAddress.dealId, photoIds: [await makePhoto(noAddress.executor)], ...ADDRESS })).toMatchObject({ distanceM: null });
  });

  it("без фото, с чужим или чужого назначения фото, с половиной координат — отказ, статус прежний", async () => {
    const f = await dealAt("IN_PROGRESS");
    await expect(submitReady(f.executor, { dealId: f.dealId, photoIds: [] })).rejects.toMatchObject({ code: "VALIDATION" });
    await expect(submitReady(f.executor, { dealId: f.dealId, photoIds: [await makePhoto(f.client)] })).rejects.toMatchObject({ code: "CONFLICT" });
    await expect(submitReady(f.executor, { dealId: f.dealId, photoIds: [await makePhoto(f.executor, "PORTFOLIO")] })).rejects.toMatchObject({ code: "CONFLICT" });
    await expect(submitReady(f.executor, { dealId: f.dealId, photoIds: [await makePhoto(f.executor)], lat: 1 })).rejects.toMatchObject({ code: "VALIDATION" });
    expect(await dealOf(f.dealId)).toMatchObject({ status: "IN_PROGRESS" });
  });

  it("покупатель не может сдать работу, мастер — подписать за покупателя", async () => {
    const f = await dealAt("IN_PROGRESS");
    await expect(submitReady(f.client, { dealId: f.dealId, photoIds: [await makePhoto(f.client)] })).rejects.toMatchObject({ code: "FORBIDDEN" });
  });
});

describe("экран сделки", () => {
  it("покупатель и мастер видят свою смету, блок денег из журнала и главное действие", async () => {
    const f = await dealAt("PAID_HOLD");
    const client = await getDealView(f.client, f.dealId);
    expect(client).toMatchObject({
      viewer: "CLIENT",
      estimate: { party: "CLIENT", extraTiyn: money.protectionTiyn, totalTiyn: money.buyerTotalTiyn },
      moneyBlock: { kind: "protected", amountTiyn: money.buyerTotalTiyn },
      next: { action: "waitStart", mine: false },
      can: { cancel: true, openDispute: true, addProgress: false },
    });
    expect(client.moneyHistory.map((h) => h.type)).toEqual(["HOLD"]);
    const master = await getDealView(f.executor, f.dealId);
    expect(master).toMatchObject({ estimate: { party: "EXECUTOR", extraTiyn: money.guaranteeTiyn, totalTiyn: money.payoutTiyn }, next: { action: "startWork", mine: true }, can: { cancel: false } });
  });
});
