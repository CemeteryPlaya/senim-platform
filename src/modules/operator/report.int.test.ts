import { describe, expect, it } from "vitest";
import { recordAudit, SYSTEM } from "@/modules/audit";
import { db } from "@/platform/db";
import { makeOperator } from "../../../test/factories";
import { makeDeal } from "../../../test/factories/operator";
import { searchAudit } from "./audit-log";
import { buildCsv, buildReport } from "./report";

describe("отчёт", () => {
  it("считает сделки, этапы и оплаты по статусам и находит зависшие отметки об оплате", async () => {
    const operator = await makeOperator();
    const { deal } = await makeDeal({
      stages: [
        { amount: 100_000, status: "CLOSED", payment: "CONFIRMED" },
        { amount: 50_000, status: "ACCEPTED", payment: "MARKED_PAID", markedPaidDaysAgo: 5 },
        { amount: 70_000, status: "PENDING", payment: "MARKED_PAID", markedPaidDaysAgo: 1 },
      ],
    });
    await makeDeal({ status: "COMPLETED", stages: [{ amount: 10_000, status: "CLOSED", payment: "CONFIRMED" }] });

    const report = await buildReport(operator, { staleDays: 3 });

    expect(report.deals).toEqual(expect.arrayContaining([{ status: "IN_PROGRESS", count: 1, sum: 220_000 }, { status: "COMPLETED", count: 1, sum: 10_000 }]));
    expect(report.payments).toEqual(expect.arrayContaining([{ status: "MARKED_PAID", count: 2, sum: 120_000 }, { status: "CONFIRMED", count: 2, sum: 110_000 }]));
    expect(report.stages.find((s) => s.status === "CLOSED")?.count).toBe(2);
    expect(report.discrepancies).toEqual([expect.objectContaining({ dealNumber: deal.number, stageTitle: "Этап 2", amount: 50_000, daysWaiting: 5 })]);
    expect(report.reconciliation).toEqual([]);
  });

  it("CSV с разделителем «;» и BOM для Excel", async () => {
    const operator = await makeOperator();
    await makeDeal({ title: 'Кухня "Лофт"; угловая' });

    const csv = await buildCsv(operator, { kind: "deals", staleDays: 3 });

    expect(csv.startsWith("﻿Номер;Название;")).toBe(true);
    expect(csv).toContain('"Кухня ""Лофт""; угловая"');
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
});
