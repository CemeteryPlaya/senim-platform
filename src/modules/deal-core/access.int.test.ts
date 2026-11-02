import { afterEach, describe, expect, it } from "vitest";
import { dealAt, makeDeal, makePhoto } from "../../../test/factories/deal";
import { actingAs, makeClient, makeExecutor, makeOperator } from "../../../test/factories";
import { db } from "@/platform/db";
import { resetEnvCache } from "@/platform/env";
import { addProgressReport, cancelDeal, dealPartyOf, getDealView, leaveReview, listDeals, openDispute, payForDeal, startWork, submitReady } from "./index";

const noop = { onCancelled: async () => {} };

afterEach(() => {
  delete process.env.FEATURE_REVIEWS;
  resetEnvCache();
});

describe("IDOR: чужая сделка — «не найдено», а не «запрещено»", () => {
  it("чужой покупатель и чужой мастер не видят сделку и не могут ничего сделать", async () => {
    const f = await dealAt("PAID_HOLD");
    const strangerClient = await makeClient();
    const strangerExecutor = await makeExecutor();
    for (const stranger of [strangerClient, strangerExecutor]) {
      await expect(getDealView(stranger, f.dealId)).rejects.toMatchObject({ code: "NOT_FOUND" });
      await expect(payForDeal(stranger, { dealId: f.dealId })).rejects.toMatchObject({ code: "NOT_FOUND" });
      await expect(startWork(stranger, { dealId: f.dealId })).rejects.toMatchObject({ code: "NOT_FOUND" });
      await expect(cancelDeal(stranger, { dealId: f.dealId }, noop)).rejects.toMatchObject({ code: "NOT_FOUND" });
      await expect(openDispute(stranger, { dealId: f.dealId, reason: "OTHER", description: "Попытка чужого спора" })).rejects.toMatchObject({ code: "NOT_FOUND" });
      expect(await dealPartyOf(stranger, f.dealId)).toBeNull();
      expect(await listDeals(stranger)).toEqual([]);
    }
    await expect(submitReady(strangerExecutor, { dealId: f.dealId, photoIds: [await makePhoto(strangerExecutor)] })).rejects.toMatchObject({ code: "NOT_FOUND" });
  });

  it("стороны видят свою сделку в списке, оператор — все; несуществующая — NOT_FOUND", async () => {
    const a = await makeDeal();
    const b = await makeDeal();
    expect((await listDeals(a.client)).map((d) => d.id)).toEqual([a.dealId]);
    expect((await listDeals(b.executor)).map((d) => [d.id, d.myRole])).toEqual([[b.dealId, "EXECUTOR"]]);
    const operator = await makeOperator();
    expect((await listDeals(operator)).map((d) => d.id).sort()).toEqual([a.dealId, b.dealId].sort());
    expect((await getDealView(operator, a.dealId)).viewer).toBe("OPERATOR");
    const paid = await dealAt("PAID_HOLD", { client: a.client });
    expect((await listDeals(a.client)).find((d) => d.id === paid.dealId)).toMatchObject({ myRole: "CLIENT", money: { kind: "protected" }, estimate: { party: "CLIENT" } });
    await expect(getDealView(operator, "nope")).rejects.toMatchObject({ code: "NOT_FOUND" });
  });

  it("сторона в другой роли (ADR-004) — по активной роли: покупатель-мастер не платит за мастера", async () => {
    const both = await makeExecutor({ roles: ["EXECUTOR", "CLIENT"] });
    const f = await dealAt("SIGNED", { executor: both });
    await expect(payForDeal(actingAs(both, "CLIENT"), { dealId: f.dealId })).rejects.toMatchObject({ code: "NOT_FOUND" });
    await expect(payForDeal(both, { dealId: f.dealId })).rejects.toMatchObject({ code: "FORBIDDEN" });
    expect(await dealPartyOf(actingAs(both, "CLIENT"), f.dealId)).toBe("EXECUTOR");
  });

  it("оператор не действует за стороны", async () => {
    const f = await dealAt("PAID_HOLD");
    const operator = await makeOperator();
    await expect(startWork(operator, { dealId: f.dealId })).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(cancelDeal(operator, { dealId: f.dealId }, noop)).rejects.toMatchObject({ code: "FORBIDDEN" });
  });
});

describe("«Ход работ»", () => {
  it("мастер добавляет отчёт с фото, пока идут работы; текст без контактов; покупатель уведомлён", async () => {
    const f = await dealAt("IN_PROGRESS");
    const { reportId } = await addProgressReport(f.executor, { dealId: f.dealId, title: "Каркас", text: "Собрал каркас, пишите в WhatsApp +77011234567", photoIds: [await makePhoto(f.executor, "PROGRESS_REPORT")] });
    const report = await db.progressReport.findUniqueOrThrow({ where: { id: reportId }, include: { photos: true } });
    expect(report.photos).toHaveLength(1);
    expect(report.text).not.toContain("77011234567");
    expect(await db.notification.count({ where: { userId: f.client.id, kind: "deal.progress" } })).toBe(1);
    expect((await getDealView(f.client, f.dealId)).progressReports).toHaveLength(1);
  });

  it("до начала работ — нельзя; покупатель — нельзя", async () => {
    const f = await dealAt("PAID_HOLD");
    await expect(addProgressReport(f.executor, { dealId: f.dealId, text: "Рано" })).rejects.toMatchObject({ code: "CONFLICT" });
    await expect(addProgressReport(f.client, { dealId: f.dealId, text: "Не мастер" })).rejects.toMatchObject({ code: "FORBIDDEN" });
  });
});

describe("отзыв (флаг reviews)", () => {
  it("флаг выключен — недоступно; включён — только покупатель и только после выплаты", async () => {
    const f = await dealAt("IN_PROGRESS");
    await expect(leaveReview(f.client, { dealId: f.dealId, rating: 5 })).rejects.toMatchObject({ code: "FORBIDDEN" });
    process.env.FEATURE_REVIEWS = "true";
    resetEnvCache();
    await expect(leaveReview(f.client, { dealId: f.dealId, rating: 5 })).rejects.toMatchObject({ code: "CONFLICT" });
    await expect(leaveReview(f.executor, { dealId: f.dealId, rating: 5 })).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(leaveReview(f.client, { dealId: f.dealId, rating: 7 })).rejects.toMatchObject({ code: "VALIDATION" });
  });
});
