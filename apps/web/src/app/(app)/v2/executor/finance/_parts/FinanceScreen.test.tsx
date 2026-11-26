import { describe, expect, it } from "vitest";
import { ru } from "@/i18n/ru";
import { formatMoney } from "@/kit";
import { count, html, text } from "@/kit/test-utils";
import type { ExecutorFinance, FinanceRow } from "@/modules/deal-core";
import type { Device } from "@/platform/device";
import { FinanceScreen } from "./FinanceScreen";
import { financeView } from "./finance-view";

const t = ru.app.masterFinance;

const row = (over: Partial<FinanceRow> = {}): FinanceRow => ({
  dealId: "d1",
  dealNumber: 7,
  title: "Кухня угловая",
  amountTiyn: 115_200_000n,
  at: new Date("2026-11-03T10:00:00Z"),
  state: "received",
  ...over,
});
const journal = (rows: FinanceRow[], months: ExecutorFinance["months"]): ExecutorFinance => ({
  months,
  rows,
  receivedTiyn: rows.filter((r) => r.state === "received").reduce((a, r) => a + r.amountTiyn, 0n),
  reservedTiyn: rows.filter((r) => r.state === "reserved").reduce((a, r) => a + r.amountTiyn, 0n),
});

const NOW = new Date("2026-11-14T10:00:00Z");
const render = (finance: ExecutorFinance, month: string | undefined, device: Device) => html(<FinanceScreen view={financeView(finance, month, NOW)} device={device} />);

const WITH_PAYMENTS = journal(
  [row(), row({ dealId: "d2", dealNumber: 8, state: "reserved", amountTiyn: 48_000_000n, at: new Date("2026-11-12T10:00:00Z") })],
  [
    { month: "2026-09", receivedTiyn: 60_000_000n, deals: 1 },
    { month: "2026-11", receivedTiyn: 115_200_000n, deals: 1 },
  ],
);

describe.each(["mobile", "desktop"] as const)("«Финансы» мастера (%s)", (device) => {
  it("месяц с оплатами: одно h1, нет главного действия, суммы из журнала, строка ведёт в сделку", () => {
    const out = render(WITH_PAYMENTS, undefined, device);
    expect(count(out, "<h1")).toBe(1);
    expect(count(out, "data-primary-action")).toBe(0);
    const visible = text(<FinanceScreen view={financeView(WITH_PAYMENTS, undefined, NOW)} device={device} />);
    expect(visible).toContain(t.total);
    expect(visible).toContain(formatMoney(115_200_000n));
    expect(visible).toContain(t.awaiting.title);
    expect(visible).toContain(formatMoney(48_000_000n));
    expect(visible).toContain("Сделка № 7, 3 ноября 2026");
    expect(out).toContain('href="/v2/deals/d1"');
    expect(out).toContain('href="/v2/deals/d2"');
    // Текущий месяц: стрелки «вперёд» нет, «назад» — на октябрь.
    expect(out).toContain('href="/v2/executor/finance?month=2026-10"');
    expect(out).not.toContain(t.monthNav.next);
    // «Назад» называет родителя.
    expect(out).toContain(t.back);
  });

  it("прошлый месяц: стрелка «вперёд» есть; пустой месяц — пояснение и без списка", () => {
    const out = render(WITH_PAYMENTS, "2026-09", device);
    expect(out).toContain(t.monthNav.next);
    expect(out).toContain('href="/v2/executor/finance?month=2026-10"');
    expect(out).toContain(t.payments.empty.title);
    expect(out).toContain('href="/v2/executor/finance?month=2026-08"');
  });

  it("столбики «По месяцам» — с месяца первой оплаты (пустые месяцы до неё не рисуем), таблица-дубль для диктора; последними", () => {
    const out = render(WITH_PAYMENTS, undefined, device);
    const chart = out.slice(out.indexOf(t.chart.label));
    expect(chart).toContain("Сентябрь 2026");
    expect(chart).toContain("Ноябрь 2026");
    expect(chart).not.toContain("Август 2026");
    expect(out).toContain(`>${t.chart.title}</h2>`);
    // Оплаты месяца — сразу под суммой месяца, до графика; заголовок списка — только для диктора.
    expect(out.indexOf("Сделка № 7, 3 ноября 2026")).toBeLessThan(out.indexOf(t.chart.label));
    expect(out).toMatch(new RegExp(`<h2 id="fin-payments" class="sr-only">${t.payments.title}</h2>`));
  });

  it("оплата только в одном месяце — столбиков нет (сравнивать не с чем)", () => {
    const one = journal([row()], [{ month: "2026-11", receivedTiyn: 115_200_000n, deals: 1 }]);
    expect(render(one, undefined, device)).not.toContain(t.chart.title);
  });

  it("«Ожидает после приёмки» — героем: зелёный блок денег с крупной суммой первым, до месяца; имя раздела — для диктора", () => {
    const out = render(WITH_PAYMENTS, undefined, device);
    expect(out).toContain("bg-accent-soft");
    expect(out).toMatch(new RegExp(`<h2 id="fin-awaiting" class="sr-only">${t.awaiting.title}</h2>`));
    expect(out).toContain(t.awaiting.label);
    expect(out.indexOf(t.awaiting.title)).toBeLessThan(out.indexOf(t.total));
    expect(out).toContain("text-display-amount");
  });

  it("месяц переключается симметрично: «‹ Ноябрь 2026 ›» — у текущего месяца «вперёд» погашена, не ссылка; стрелки без серой плиты", () => {
    const out = render(WITH_PAYMENTS, undefined, device);
    const nav = out.slice(out.indexOf(`aria-label="${t.monthNav.label}"`), out.indexOf("</nav>"));
    expect(count(nav, "<svg")).toBe(2);
    expect(count(nav, "<a ")).toBe(1);
    expect(nav).not.toContain("bg-fill ");
  });

  it("все шесть месяцев пустые — столбиков нет; сумма месяца «0 ₸» приглушена", () => {
    const reservedOnly = journal([row({ state: "reserved" })], []);
    const out = render(reservedOnly, undefined, device);
    expect(out).not.toContain(t.chart.title);
    expect(out).toContain(t.awaiting.title);
    const zero = out.slice(out.search(/<dd class="[^"]*text-muted[^"]*">/));
    expect(zero.slice(0, zero.indexOf("</dd>"))).not.toContain("text-ink");
  });

  it("журнал пуст — обучающий экран с одним действием на заявки", () => {
    const out = render(journal([], []), undefined, device);
    expect(out).toContain(t.empty.title);
    expect(count(out, "data-primary-action")).toBe(1);
    expect(out).toContain('href="/v2/executor/requests"');
    expect(out).not.toContain(t.total);
  });

  it("слова мастера: нет «выплат», «договор», «комиссия», «эскроу», «платформа», «заказчик»", () => {
    const visible = text(<FinanceScreen view={financeView(WITH_PAYMENTS, undefined, NOW)} device={device} />);
    expect(visible).not.toMatch(/выплат|договор|комисси|эскроу|платформ|заказчик/i);
  });
});
