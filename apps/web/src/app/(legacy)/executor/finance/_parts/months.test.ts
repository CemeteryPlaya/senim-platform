import { describe, expect, it } from "vitest";
import { barPercent, chartWindow, monthName, monthTitle, selectedMonth, shiftMonth, versusPrevious } from "./months";

describe("месяцы «Финансов»", () => {
  it("сдвиг через границу года", () => {
    expect(shiftMonth("2026-01", -1)).toBe("2025-12");
    expect(shiftMonth("2026-12", 1)).toBe("2027-01");
    expect(shiftMonth("2026-11", -5)).toBe("2026-06");
  });

  it("месяц из адреса: верный — он, неверный и будущий — текущий", () => {
    expect(selectedMonth("2026-10", "2026-11")).toBe("2026-10");
    expect(selectedMonth("2025-02", "2026-11")).toBe("2025-02");
    expect(selectedMonth(undefined, "2026-11")).toBe("2026-11");
    expect(selectedMonth("2026-13", "2026-11")).toBe("2026-11");
    expect(selectedMonth("2026-1", "2026-11")).toBe("2026-11");
    expect(selectedMonth(["2026-10"], "2026-11")).toBe("2026-11");
    expect(selectedMonth("2027-01", "2026-11")).toBe("2026-11");
    expect(selectedMonth("0050-01", "2026-11")).toBe("2026-11");
    expect(selectedMonth("1999-12", "2026-11")).toBe("2026-11");
    expect(selectedMonth("2000-01", "2026-11")).toBe("2000-01");
  });

  it("окно столбиков — шесть месяцев до выбранного, пустые — нули", () => {
    const window = chartWindow(
      [
        { month: "2026-11", receivedTiyn: 300n, deals: 1 },
        { month: "2026-07", receivedTiyn: 100n, deals: 1 },
        { month: "2026-04", receivedTiyn: 999n, deals: 1 },
      ],
      "2026-11",
    );
    expect(window.map((m) => m.month)).toEqual(["2026-06", "2026-07", "2026-08", "2026-09", "2026-10", "2026-11"]);
    expect(window.map((m) => m.receivedTiyn)).toEqual([0n, 100n, 0n, 0n, 0n, 300n]);
  });

  it("высота столбика — доля от максимума окна", () => {
    expect(barPercent(300n, 300n)).toBe(100);
    expect(barPercent(100n, 300n)).toBe(33);
    expect(barPercent(0n, 0n)).toBe(0);
  });

  it("сравнение с прошлым месяцем", () => {
    expect(versusPrevious(118n, 100n, "2026-10")).toBe("+18% к октябрю");
    expect(versusPrevious(50n, 100n, "2026-05")).toBe("−50% к маю");
    expect(versusPrevious(100n, 100n, "2026-12")).toBe("0% к декабрю");
    expect(versusPrevious(100n, 0n, "2026-10")).toBeNull();
  });

  it("названия месяца", () => {
    expect(monthName("2026-11")).toBe("ноябрь");
    expect(monthTitle("2026-03")).toBe("Март 2026");
  });
});
