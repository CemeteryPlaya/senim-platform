import type { ReactElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ru } from "@/i18n/ru";
import { formatMoney } from "@/kit";
import { getExecutorFinance, monthOf, processDealMoney } from "@/modules/deal-core";
import { computeDealMoney } from "@/modules/payments";
import { db } from "@/platform/db";
import { makeExecutor } from "../../../../../../test/factories";
import { dealAt, PRICE, signAct } from "../../../../../../test/factories/deal";
import { freshBrowser } from "../../../../../../test/factories/identity";
import { signInAs } from "../../../../../../test/factories/session";
import { shiftMonth } from "@/features/executor-finance/months";

const h = vi.hoisted(() => ({ device: "mobile" as "mobile" | "desktop" }));
vi.mock("@/platform/device", () => ({ getDevice: async () => h.device }));
vi.mock("next/headers", async () => (await import("../../../../../../test/factories/identity")).nextHeadersMock);

const { default: FinancePage } = await import("./page");

const t = ru.app.masterFinance;
const gate = ru.app.masterRequests.gate;
const money = computeDealMoney(PRICE);
type Params = Record<string, string>;

beforeEach(() => {
  freshBrowser({ "user-agent": "vitest" });
  h.device = "mobile";
});

const render = async (params: Params = {}): Promise<string> => renderToStaticMarkup((await FinancePage({ searchParams: Promise.resolve(params) })) as ReactElement);
const visible = (out: string) => out.replace(/<[^>]*>/g, " ").replace(/&nbsp;/g, " ");

async function paidMaster() {
  const done = await dealAt("READY");
  await signAct(done.dealId);
  await processDealMoney(done.dealId);
  const reserved = await dealAt("IN_PROGRESS", { executor: done.executor });
  await db.user.update({ where: { id: done.executor.id }, data: { emailVerifiedAt: new Date() } });
  await signInAs(done.executor);
  const paidAt = (await db.moneyTransaction.findFirstOrThrow({ where: { dealId: done.dealId, type: "SPLIT_MASTER" } })).settledAt!;
  return { done, reserved, month: monthOf(paidAt) };
}

describe("«Финансы» мастера: суммы из журнала денег", () => {
  it("месяц оплаты: «Получено за месяц» и оплата — сумма журнала; «Ожидает после приёмки» — резерв", async () => {
    const { done, reserved, month } = await paidMaster();
    for (const device of ["mobile", "desktop"] as const) {
      h.device = device;
      const out = await render({ month });
      const text = visible(out);
      expect(text).toContain(t.total);
      expect(text).toContain(formatMoney(money.payoutTiyn));
      expect(text).toContain(t.awaiting.title);
      expect(out).toContain(`href="/v2/deals/${done.dealId}"`);
      expect(out).toContain(`href="/v2/deals/${reserved.dealId}"`);
      expect(text).not.toMatch(/выплат|договор|комисси|эскроу|платформ|заказчик/i);
      // Покупатель платит больше мастера: ни защиты сделки, ни «к оплате» покупателя на экране нет.
      expect(text).not.toContain(formatMoney(money.buyerTotalTiyn));
      expect(out.split("data-primary-action").length - 1).toBe(0);
      expect((out.match(/<h1/g) ?? []).length).toBe(1);
    }
    // Сумма на экране — ровно то, что отдаёт модуль.
    const finance = await getExecutorFinance(done.executor);
    expect(finance.receivedTiyn).toBe(money.payoutTiyn);
  });

  it("пустой месяц (раньше оплаты): сумма нулевая, оплат нет, стрелка «вперёд» ведёт к следующему", async () => {
    const { month } = await paidMaster();
    const earlier = shiftMonth(month, -2);
    const out = await render({ month: earlier });
    expect(out).toContain(t.payments.empty.title);
    expect(out).toContain(`href="/v2/executor/finance?month=${shiftMonth(earlier, 1)}"`);
    expect(visible(out)).toContain(formatMoney(0n));
  });

  it("неверный и будущий месяц — текущий; стрелки «вперёд» у текущего нет", async () => {
    await paidMaster();
    const current = monthOf(new Date());
    for (const month of ["2999-01", "abc", "2026-13"]) {
      const out = await render({ month });
      expect(out).toContain(`href="/v2/executor/finance?month=${shiftMonth(current, -1)}"`);
      expect(out).not.toContain(t.monthNav.next);
    }
  });

  it("мастер без оплат — обучающий экран", async () => {
    const executor = await makeExecutor();
    await db.user.update({ where: { id: executor.id }, data: { emailVerifiedAt: new Date() } });
    await signInAs(executor);
    const out = await render();
    expect(out).toContain(t.empty.title);
    expect(out.split("data-primary-action").length - 1).toBe(1);
  });

  it("неодобренный мастер — экран статуса вместо ошибки", async () => {
    for (const [status, key] of [["PENDING", "pending"], ["REJECTED", "rejected"]] as const) {
      freshBrowser({ "user-agent": "vitest" });
      const executor = await makeExecutor({ status });
      await db.user.update({ where: { id: executor.id }, data: { emailVerifiedAt: new Date() } });
      await signInAs(executor);
      const out = await render();
      expect(out).toContain(gate[key].now);
      expect(out).toContain('href="/v2/register/executor"');
      expect(out).not.toContain(t.total);
    }
  });
});
