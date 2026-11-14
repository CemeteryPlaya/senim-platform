import { describe, expect, it } from "vitest";
import { ru } from "@/i18n/ru";
import type { ExecutorFinance, FinanceRow } from "@/modules/deal-core";
import { financeView, monthTitle, versusText } from "./finance-view";

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

const finance = (rows: FinanceRow[], months: ExecutorFinance["months"] = [], over: Partial<ExecutorFinance> = {}): ExecutorFinance => ({
  months,
  rows,
  receivedTiyn: rows.filter((r) => r.state === "received").reduce((a, r) => a + r.amountTiyn, 0n),
  reservedTiyn: rows.filter((r) => r.state === "reserved").reduce((a, r) => a + r.amountTiyn, 0n),
  ...over,
});

const NOW = new Date("2026-11-14T10:00:00Z");

describe("месяц «Финансов» мастера", () => {
  it("заголовок месяца — название и год", () => {
    expect(monthTitle("2026-11")).toBe("Ноябрь 2026");
    expect(monthTitle("2026-01")).toBe("Январь 2026");
  });

  it("по умолчанию текущий; суммы и оплаты месяца — из журнала, сравнение с прошлым месяцем в целых процентах", () => {
    const rows = [row(), row({ dealId: "d2", dealNumber: 8, amountTiyn: 100_000_000n, at: new Date("2026-10-10T10:00:00Z") })];
    const months = [
      { month: "2026-11", receivedTiyn: 115_200_000n, deals: 1 },
      { month: "2026-10", receivedTiyn: 100_000_000n, deals: 1 },
    ] as const;
    const view = financeView(finance(rows, [...months]), undefined, NOW);
    expect(view.month).toBe("2026-11");
    expect(view.title).toBe("Ноябрь 2026");
    expect(view.totalTiyn).toBe(115_200_000n);
    expect(view.versus).toBe("на 15% больше, чем в октябре");
    expect(view.payments.map((p) => p.key.startsWith("d1"))).toEqual([true]);
    expect(view.payments[0]).toMatchObject({ href: "/v2/deals/d1", title: "Кухня угловая", amountTiyn: 115_200_000n });
    expect(view.payments[0]!.line).toBe("Сделка № 7, 3 ноября 2026");
    expect(view.nextHref).toBeNull();
    expect(view.prevHref).toBe("/v2/executor/finance?month=2026-10");
    expect(view.empty).toBe(false);
  });

  it("граница года: январь — назад в декабрь, декабрь — вперёд в январь; в январе сравнение с декабрём", () => {
    const rows = [row({ at: new Date("2026-01-10T10:00:00Z"), amountTiyn: 90n }), row({ dealId: "d0", at: new Date("2025-12-10T10:00:00Z"), amountTiyn: 100n })];
    const months = [
      { month: "2026-01", receivedTiyn: 90n, deals: 1 },
      { month: "2025-12", receivedTiyn: 100n, deals: 1 },
    ] as const;
    const january = financeView(finance(rows, [...months]), "2026-01", NOW);
    expect(january.prevHref).toBe("/v2/executor/finance?month=2025-12");
    expect(january.nextHref).toBe("/v2/executor/finance?month=2026-02");
    expect(january.versus).toBe("на 10% меньше, чем в декабре");
    expect(january.bars.map((b) => b.name)).toEqual(["Август 2025", "Сентябрь 2025", "Октябрь 2025", "Ноябрь 2025", "Декабрь 2025", "Январь 2026"]);
    expect(january.bars.map((b) => b.label)).toEqual(["Авг", "Сен", "Окт", "Ноя", "Дек", "Янв"]);
    const december = financeView(finance(rows, [...months]), "2025-12", NOW);
    expect(december.nextHref).toBe("/v2/executor/finance?month=2026-01");
    expect(december.versus).toBeNull();
  });

  it("столбики: шесть месяцев, выбранный — последний и текущий; пустые — нули", () => {
    const months = [
      { month: "2026-11", receivedTiyn: 300n, deals: 1 },
      { month: "2026-08", receivedTiyn: 100n, deals: 1 },
    ] as const;
    const view = financeView(finance([row()], [...months]), "2026-11", NOW);
    expect(view.bars.map((b) => b.value)).toEqual([0n, 0n, 100n, 0n, 0n, 300n]);
    expect(view.bars.map((b) => b.selected)).toEqual([false, false, false, false, false, true]);
  });

  it("неверный и будущий месяц в адресе — текущий; пустой месяц — без оплат", () => {
    const base = finance([row()], [{ month: "2026-11", receivedTiyn: 115_200_000n, deals: 1 }]);
    expect(financeView(base, "2027-03", NOW).month).toBe("2026-11");
    expect(financeView(base, "abc", NOW).month).toBe("2026-11");
    expect(financeView(base, ["2026-10"], NOW).month).toBe("2026-11");
    const empty = financeView(base, "2026-09", NOW);
    expect(empty.payments).toEqual([]);
    expect(empty.totalTiyn).toBe(0n);
    expect(empty.empty).toBe(false);
  });

  it("«Ожидает после приёмки»: сумма и строки только из резерва журнала; нет резерва — нет блока", () => {
    const reserved = row({ dealId: "d3", dealNumber: 9, state: "reserved", amountTiyn: 48_000_000n, at: new Date("2026-11-12T10:00:00Z") });
    const view = financeView(finance([row(), reserved]), undefined, NOW);
    expect(view.awaiting?.totalTiyn).toBe(48_000_000n);
    expect(view.awaiting?.rows.map((r) => r.href)).toEqual(["/v2/deals/d3"]);
    // Резерв не попадает в оплаты месяца.
    expect(view.payments.map((p) => p.href)).toEqual(["/v2/deals/d1"]);
    expect(financeView(finance([row()]), undefined, NOW).awaiting).toBeNull();
  });

  it("журнал пуст — обучающий экран", () => {
    expect(financeView(finance([]), undefined, NOW).empty).toBe(true);
  });

  it("тексты: сравнение словами, целый процент; отрицательный усекается к нулю", () => {
    expect(versusText(0n, "декабре")).toBe("как в декабре");
    expect(versusText(18n, "октябре")).toBe("на 18% больше, чем в октябре");
    expect(versusText(-5n, "мае")).toBe("на 5% меньше, чем в мае");
    expect(t.monthsIn).toHaveLength(12);
    expect(t.months).toHaveLength(12);
    expect(t.monthsShort).toHaveLength(12);
  });

  it("отрицательный процент усечён: 2 против 3 — на 33% меньше, а не на 34%", () => {
    const rows = [row({ amountTiyn: 2n }), row({ dealId: "d0", amountTiyn: 3n, at: new Date("2026-10-10T10:00:00Z") })];
    const months = [
      { month: "2026-11", receivedTiyn: 2n, deals: 1 },
      { month: "2026-10", receivedTiyn: 3n, deals: 1 },
    ] as const;
    expect(financeView(finance(rows, [...months]), undefined, NOW).versus).toBe("на 33% меньше, чем в октябре");
  });
});
