import { describe, expect, it } from "vitest";
import { payForDeal } from "@/modules/deal-core";
import { recordAudit, SYSTEM } from "@/modules/audit";
import { computeDealMoney } from "@/modules/payments";
import { db } from "@/platform/db";
import { makeOperator } from "../../../test/factories";
import { confirmPending, dealAt, makeDeal, PRICE, signAct } from "../../../test/factories/deal";
import { searchAudit } from "./audit-log";
import { csvTiyn } from "./csv";
import { buildCsv, buildIncomeCsv, buildReport, incomeReport } from "./report";

const DAY = 86_400_000;
const money = computeDealMoney(PRICE);

/** Сделка на manual до выплаты: все части раскрытия подтверждены оператором. */
async function paidOut() {
  const f = await dealAt("READY", { provider: "manual" });
  await signAct(f.dealId);
  for (const type of ["RELEASE", "SPLIT_MASTER", "SPLIT_PLATFORM"] as const) await confirmPending(f.dealId, type);
  return f;
}

describe("отчёт", () => {
  it("считает сделки по статусам и операции журнала по типам; расхождения — manual без документа дольше N дней", async () => {
    const operator = await makeOperator();
    await makeDeal();
    const waiting = await dealAt("SIGNED", { provider: "manual" });
    await payForDeal(waiting.client, { dealId: waiting.dealId });

    const report = await buildReport(operator, { staleDays: 3 });

    expect(report.deals.find((d) => d.status === "CREATED")).toEqual({ status: "CREATED", count: 2, sumTiyn: 2n * PRICE });
    expect(report.operations).toEqual([{ type: "HOLD", status: "PENDING", count: 1, sumTiyn: money.buyerTotalTiyn }]);
    expect(report.discrepancies).toEqual([]);
    // Через 5 дней та же операция всё ещё без документа банка — расхождение.
    const later = await buildReport(operator, { staleDays: 3 }, new Date(Date.now() + 5 * DAY));
    expect(later.discrepancies).toEqual([expect.objectContaining({ dealId: waiting.dealId, type: "HOLD", amountTiyn: money.buyerTotalTiyn, daysWaiting: 5 })]);
  });

  it("CSV с разделителем «;», BOM и суммами в тенге", async () => {
    const operator = await makeOperator();
    const f = await makeDeal();
    await db.deal.update({ where: { id: f.dealId }, data: { title: 'Кухня "Лофт"; угловая' } });

    const csv = await buildCsv(operator, { kind: "deals", staleDays: 3 });

    expect(csv.startsWith("﻿Номер;Название;")).toBe(true);
    expect(csv).toContain('"Кухня ""Лофт""; угловая"');
    expect(csv).toContain(`;${csvTiyn(PRICE)};${csvTiyn(money.buyerTotalTiyn)};${csvTiyn(money.payoutTiyn)};`);
  });

  it("CSV журнала денег: строка на каждую операцию с ключом идемпотентности", async () => {
    const operator = await makeOperator();
    const f = await paidOut();

    const lines = (await buildCsv(operator, { kind: "operations", staleDays: 3 })).trim().split("\r\n");

    expect(lines).toHaveLength(5); // заголовок, HOLD, RELEASE, SPLIT_MASTER, SPLIT_PLATFORM
    expect(lines.join("\n")).toContain(`release:${f.dealId}`);
  });
});

describe("доход платформы по схеме 2% + 4%", () => {
  it("за период — из журнала: защита, гарантия и итог по сделкам; CSV с итоговой строкой", async () => {
    const operator = await makeOperator();
    const f = await paidOut();
    const period = { from: new Date(Date.now() - DAY), to: new Date(Date.now() + DAY) };

    const report = await incomeReport(operator, period);

    expect(report.rows).toEqual([expect.objectContaining({ dealId: f.dealId, protectionTiyn: money.protectionTiyn, guaranteeTiyn: money.guaranteeTiyn })]);
    expect(report.totalTiyn).toBe(money.platformIncomeTiyn);
    expect(report.protectionTiyn + report.guaranteeTiyn).toBe(report.totalTiyn);

    const csv = (await buildIncomeCsv(operator, period)).trim().split("\r\n");
    expect(csv).toHaveLength(3);
    expect(csv[2]).toBe(`Итого доход;;${csvTiyn(money.protectionTiyn)};${csvTiyn(money.guaranteeTiyn)};${csvTiyn(money.platformIncomeTiyn)};`);

    expect((await incomeReport(operator, { from: new Date(Date.now() + DAY), to: new Date(Date.now() + 2 * DAY) })).rows).toEqual([]);
  });
});

describe("журнал аудита", () => {
  it("фильтрует по scope, сущности и действию и листает по seq", async () => {
    const operator = await makeOperator();
    for (let i = 0; i < 5; i++) {
      await recordAudit(db, { actor: SYSTEM("test"), action: "deal.stage.accepted", entity: { type: "stage", id: `s${i}` }, scope: "deal:d1" });
    }
    await recordAudit(db, { actor: SYSTEM("test"), action: "request.published", entity: { type: "request", id: "r1" }, scope: "request:r1" });

    const page1 = await searchAudit(operator, { scope: "deal:d1", action: "deal.stage" }, 3);
    expect(page1.events.map((e) => e.entityId)).toEqual(["s4", "s3", "s2"]);
    expect(page1.nextBefore).toBe(page1.events[2].seq);

    const page2 = await searchAudit(operator, { scope: "deal:d1", before: BigInt(page1.nextBefore!) }, 3);
    expect(page2.events.map((e) => e.entityId)).toEqual(["s1", "s0"]);
    expect(page2.nextBefore).toBeNull();

    expect((await searchAudit(operator, { entityType: "request" })).events).toHaveLength(1);
  });

  it("фильтр по номеру сделки — вся её история; запись показывает IP и устройство", async () => {
    const operator = await makeOperator();
    const f = await makeDeal();
    const other = await makeDeal();
    const deal = await db.deal.findUniqueOrThrow({ where: { id: f.dealId } });
    await recordAudit(db, {
      actor: { kind: "user", id: operator.id, role: "OPERATOR" },
      action: "payment.operation.confirmed",
      entity: { type: "moneyTransaction", id: "m1" },
      scope: `deal:${f.dealId}`,
      origin: { ip: "203.0.113.7", userAgent: "Safari на iPhone" },
    });

    const found = await searchAudit(operator, { deal: deal.number });

    expect(found.events.length).toBeGreaterThan(0);
    expect(found.events.every((e) => e.scope === `deal:${f.dealId}`)).toBe(true);
    expect(found.events[0]).toMatchObject({ action: "payment.operation.confirmed", ip: "203.0.113.7", userAgent: "Safari на iPhone" });
    expect(found.events.some((e) => e.scope === `deal:${other.dealId}`)).toBe(false);
    expect(await searchAudit(operator, { deal: 999_999 })).toEqual({ events: [], nextBefore: null });
  });
});
