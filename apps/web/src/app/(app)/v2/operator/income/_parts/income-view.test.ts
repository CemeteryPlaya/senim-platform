import { describe, expect, it } from "vitest";
import type { IncomeRow } from "@/modules/payments";
import { incomeTotals } from "./income-view";

const row = (guaranteeTiyn: bigint, totalTiyn: bigint): IncomeRow => ({
  transactionId: "t",
  dealId: "d",
  dealNumber: 1,
  settledAt: new Date("2026-11-10T09:00:00Z"),
  protectionTiyn: totalTiyn - guaranteeTiyn,
  guaranteeTiyn,
  totalTiyn,
  isTest: false,
});

describe("incomeTotals: «Итого» — только когда доход не равен гарантии 6%", () => {
  it("ADR-015: доход = гарантия — ни итога, ни столбца «Итого»", () => {
    expect(incomeTotals({ rows: [row(27_000_00n, 27_000_00n)], guaranteeTiyn: 27_000_00n, totalTiyn: 27_000_00n })).toEqual({ total: false, totalColumn: false });
  });

  it("старая сделка с защитой 2 % — итог и столбец показываются", () => {
    const rows = [row(27_000_00n, 27_000_00n), row(6_000_00n, 8_000_00n)];
    expect(incomeTotals({ rows, guaranteeTiyn: 33_000_00n, totalTiyn: 35_000_00n })).toEqual({ total: true, totalColumn: true });
  });

  it("пустой период — нечего повторять", () => {
    expect(incomeTotals({ rows: [], guaranteeTiyn: 0n, totalTiyn: 0n })).toEqual({ total: false, totalColumn: false });
  });
});
