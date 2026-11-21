import { describe, expect, it } from "vitest";
import { cancelDeal, processDealMoney } from "@/modules/deal-core";
import type { CurrentUser } from "@/modules/identity";
import { computeDealMoney, platformIncomeReport } from "@/modules/payments";
import { db } from "@/platform/db";
import { makeAdmin, makeClient, makeExecutor, makeOperator } from "../../../test/factories";
import { dealAt, journalOf, PRICE, signAct } from "../../../test/factories/deal";
import { makeOffer, makeRequest } from "../../../test/factories/operator";
import { adminStats, type AdminPeriod } from "./stats";

const DAY = 86_400_000;
const money = computeDealMoney(PRICE);
const withoutMfa = (user: CurrentUser): CurrentUser => ({ ...user, mfa: { required: true, verifiedAt: null } });
const daysAgo = (n: number) => new Date(Date.now() - n * DAY);
const count = <S extends string>(rows: readonly { status: S; count: number }[], status: S) => rows.find((r) => r.status === status)?.count;
const total = (rows: readonly { count: number }[]) => rows.reduce((acc, r) => acc + r.count, 0);

/**
 * Платформа в миниатюре: черновик 10 дней назад; опубликованная заявка с предложением; сделка до выплаты мастеру; сделка,
 * отменённая после оплаты (возврат). Заявки сделок опубликованы — иначе воронка их не видит.
 */
async function platform() {
  const draft = await makeRequest({ status: "DRAFT" });
  await db.request.update({ where: { id: draft.id }, data: { createdAt: daysAgo(10) } });
  const open = await makeRequest({ publishedHoursAgo: 1 });
  await makeOffer(open.id);

  const done = await dealAt("READY");
  await signAct(done.dealId);
  await processDealMoney(done.dealId);

  const refunded = await dealAt("PAID_HOLD");
  await cancelDeal(refunded.client, { dealId: refunded.dealId });
  await processDealMoney(refunded.dealId);

  await db.request.updateMany({ where: { id: { in: [done.requestId, refunded.requestId] } }, data: { publishedAt: new Date() } });
  return { draft, open, done, refunded };
}

describe("админка: статистика — кто допущен", () => {
  it("оператор, покупатель, мастер — FORBIDDEN; администратор без второго фактора — MFA_REQUIRED", async () => {
    for (const user of [await makeOperator(), await makeClient(), await makeExecutor()]) {
      await expect(adminStats(user, "all")).rejects.toMatchObject({ code: "FORBIDDEN" });
    }
    await expect(adminStats(withoutMfa(await makeAdmin()), "all")).rejects.toMatchObject({ code: "MFA_REQUIRED" });
  });

  it("неизвестный период (подмена типа) — VALIDATION", async () => {
    const admin = await makeAdmin();
    for (const period of ["1y", "", "__proto__", 7, null] as unknown as AdminPeriod[]) {
      await expect(adminStats(admin, period)).rejects.toMatchObject({ code: "VALIDATION" });
    }
  });
});

describe("админка: статистика платформы", () => {
  it("всё время: заявки, сделки и мастера по статусам; деньги — из журнала в тиынах; воронка по шагам", async () => {
    const admin = await makeAdmin();
    const { refunded, done } = await platform();
    const refund = (await journalOf(refunded.dealId)).filter((e) => e.type === "REFUND");
    expect(refund).toHaveLength(1);
    expect((await db.deal.findUniqueOrThrow({ where: { id: done.dealId } })).status).toBe("SPLIT_PAYOUT");

    const stats = await adminStats(admin, "all");

    // Каждое значение перечисления — строкой, с нулями.
    expect(stats.requests.map((r) => r.status)).toEqual(["DRAFT", "PLATFORM_MEASURING", "OPEN", "OFFER_CHOSEN", "MEASURING", "CONTRACTING", "CLOSED", "CANCELLED"]);
    expect(total(stats.requests)).toBe(4);
    expect(count(stats.requests, "DRAFT")).toBe(1);
    expect(count(stats.requests, "OPEN")).toBe(1);
    expect(stats.deals.map((d) => d.status)).toEqual(["CREATED", "PAID_HOLD", "IN_PROGRESS", "READY", "ACCEPTED", "SPLIT_PAYOUT", "CANCELLED", "REFUNDED"]);
    expect(count(stats.deals, "SPLIT_PAYOUT")).toBe(1);
    expect(count(stats.deals, "REFUNDED")).toBe(1);
    expect(total(stats.deals)).toBe(2);
    expect(stats.masters.map((m) => m.status)).toEqual(["PENDING", "APPROVED", "REJECTED"]);
    expect(total(stats.masters)).toBe(await db.executorProfile.count());

    expect(stats.money).toEqual({
      paidTiyn: 2n * money.buyerTotalTiyn,
      payoutTiyn: money.payoutTiyn,
      refundTiyn: refund[0].amountTiyn,
      incomeTiyn: money.platformIncomeTiyn,
    });
    for (const value of Object.values(stats.money)) expect(typeof value).toBe("bigint");
    // Доход платформы = оплачено − выплата по сделке с выплатой (возврат — деньги отменённой сделки).
    expect(stats.money.paidTiyn - stats.money.refundTiyn - stats.money.payoutTiyn).toBe(stats.money.incomeTiyn);

    expect(stats.funnel).toEqual({ published: 3, withOffer: 3, dealCreated: 2, paid: 2, accepted: 1, paidOut: 1 });
  });

  it("период: 7 дней отсекают запись, созданную 10 дней назад, и операцию журнала, проведённую тогда же; 30 дней — нет", async () => {
    const admin = await makeAdmin();
    const { refunded } = await platform();
    // Сделка с возвратом — 10 дней назад: сама сделка и обе её операции журнала.
    await db.deal.update({ where: { id: refunded.dealId }, data: { createdAt: daysAgo(10) } });
    await db.moneyTransaction.updateMany({ where: { dealId: refunded.dealId }, data: { settledAt: daysAgo(10) } });

    const week = await adminStats(admin, "7d");
    expect(total(week.requests)).toBe(3);
    expect(count(week.requests, "DRAFT")).toBe(0);
    expect(total(week.deals)).toBe(1);
    expect(count(week.deals, "REFUNDED")).toBe(0);
    expect(week.money).toEqual({ paidTiyn: money.buyerTotalTiyn, payoutTiyn: money.payoutTiyn, refundTiyn: 0n, incomeTiyn: money.platformIncomeTiyn });

    const month = await adminStats(admin, "30d");
    expect(total(month.requests)).toBe(4);
    expect(total(month.deals)).toBe(2);
    expect(month.money.paidTiyn).toBe(2n * money.buyerTotalTiyn);

    // «Сейчас» через 10 дней: всё созданное сегодня вне недели, но в «всё время».
    const later = await adminStats(admin, "7d", new Date(Date.now() + 10 * DAY));
    expect(total(later.requests)).toBe(0);
    expect(later.money).toEqual({ paidTiyn: 0n, payoutTiyn: 0n, refundTiyn: 0n, incomeTiyn: 0n });
    expect(later.funnel).toEqual({ published: 0, withOffer: 0, dealCreated: 0, paid: 0, accepted: 0, paidOut: 0 });
    expect(total((await adminStats(admin, "all", new Date(Date.now() + 10 * DAY))).requests)).toBe(4);
  });

  it("доход платформы за 30 дней сходится с отчётом оператора «доход платформы» на тех же данных", async () => {
    const admin = await makeAdmin();
    const operator = await makeOperator();
    const { done } = await platform();
    // Выплата 40 дней назад — вне периода и статистики, и отчёта.
    const old = await dealAt("READY");
    await signAct(old.dealId);
    await processDealMoney(old.dealId);
    await db.moneyTransaction.updateMany({ where: { dealId: old.dealId }, data: { settledAt: daysAgo(40) } });

    const now = new Date();
    const stats = await adminStats(admin, "30d", now);
    const report = await platformIncomeReport(operator, { from: new Date(now.getTime() - 30 * DAY), to: new Date(now.getTime() + 1) });

    expect(report.rows.map((r) => r.dealId)).toEqual([done.dealId]);
    expect(stats.money.incomeTiyn).toBe(report.totalTiyn);
    expect(stats.money.incomeTiyn).toBe(money.platformIncomeTiyn);
  });

  it("этот месяц — с 1-го числа по Алматы (+05:00), как «Доход платформы» оператора по умолчанию", async () => {
    const admin = await makeAdmin();
    const operator = await makeOperator();
    const { done } = await platform();
    const now = new Date("2026-11-21T12:00:00.000Z");
    const monthStart = new Date("2026-11-01T00:00:00.000+05:00");
    // Черновик — за миг до начала месяца по Алматы (31 октября по UTC тоже); другой — ровно в начале месяца.
    const before = await makeRequest({ status: "DRAFT" });
    await db.request.update({ where: { id: before.id }, data: { createdAt: new Date(monthStart.getTime() - 1) } });
    const first = await makeRequest({ status: "DRAFT" });
    await db.request.update({ where: { id: first.id }, data: { createdAt: monthStart } });
    await db.moneyTransaction.updateMany({ where: { dealId: done.dealId }, data: { settledAt: monthStart } });

    const month = await adminStats(admin, "month", now);
    // Черновики месяца: черновик платформы (10 дней назад) и «ровно в начале»; «за миг до» — нет.
    const drafts = await db.request.findMany({ where: { status: "DRAFT", createdAt: { gte: monthStart } }, select: { id: true } });
    expect(drafts.map((d) => d.id)).toContain(first.id);
    expect(drafts.map((d) => d.id)).not.toContain(before.id);
    expect(count(month.requests, "DRAFT")).toBe(drafts.length);
    const report = await platformIncomeReport(operator, { from: monthStart, to: new Date(now.getTime() + 1) });
    expect(month.money.incomeTiyn).toBe(report.totalTiyn);
    expect(month.money.incomeTiyn).toBe(money.platformIncomeTiyn);
  });

  it("операции журнала не в итоге (ждут банк, отказ) в деньги не входят", async () => {
    const admin = await makeAdmin();
    const waiting = await dealAt("SIGNED", { provider: "manual" });
    const { payForDeal } = await import("@/modules/deal-core");
    await payForDeal(waiting.client, { dealId: waiting.dealId });
    expect((await journalOf(waiting.dealId)).map((e) => [e.type, e.status])).toEqual([["HOLD", "PENDING"]]);

    const stats = await adminStats(admin, "all");
    expect(stats.money).toEqual({ paidTiyn: 0n, payoutTiyn: 0n, refundTiyn: 0n, incomeTiyn: 0n });
    expect(stats.funnel.paid).toBe(0);
  });
});
