import { describe, expect, it } from "vitest";
import { ru } from "@/i18n/ru";
import type { MoneyHistoryItem } from "@/modules/payments";
import { operationRows } from "./money-view";

const t = ru.app.deal.money;
const item = (over: Partial<MoneyHistoryItem> & Pick<MoneyHistoryItem, "id" | "type">): MoneyHistoryItem => ({
  status: "SUCCEEDED",
  amountTiyn: 100n,
  at: new Date("2026-11-10T10:00:00Z"),
  basisDocumentId: null,
  operationRef: null,
  isTest: true,
  ...over,
});

describe("operationRows: записи журнала человеческим текстом", () => {
  it("одна запись — одна строка, свежие сверху, суммы как в журнале", () => {
    const rows = operationRows([item({ id: "a", type: "HOLD", amountTiyn: 102_000_00n }), item({ id: "b", type: "SPLIT_MASTER", amountTiyn: 96_000_00n })]);
    expect(rows.map((r) => [r.id, r.amount])).toEqual([
      ["b", 96_000_00n],
      ["a", 102_000_00n],
    ]);
  });

  it("у каждого вида записи свой текст без слов «комиссия», «эскроу», «тестовый»", () => {
    const types = ["HOLD", "FREEZE", "UNFREEZE", "SPLIT_MASTER", "SPLIT_PLATFORM", "REFUND"] as const;
    const rows = operationRows(types.map((type) => item({ id: type, type })));
    expect(new Set(rows.map((r) => r.title)).size).toBe(types.length);
    for (const row of rows) expect(`${row.title} ${row.text ?? ""}`).not.toMatch(/комисси|эскроу|тестов|демо|платформ/i);
  });

  it("защита сделки называется по-покупательски и поясняется", () => {
    const [row] = operationRows([item({ id: "p", type: "SPLIT_PLATFORM" })]);
    expect(row?.title).toBe(t.type.SPLIT_PLATFORM);
    expect(row?.text).toContain("Защиту сделки (2%)");
  });

  it("пометка тестового платежа не выводится; статус банка и номер операции — в тексте", () => {
    const [row] = operationRows([item({ id: "x", type: "REFUND", status: "PENDING", operationRef: "BK-1" })]);
    expect(row?.text).toBe(`${t.status.PENDING} · ${t.bankRef("BK-1")}`);
  });

  it("выполненная операция без номера — без текста", () => {
    expect(operationRows([item({ id: "h", type: "HOLD" })])[0]).not.toHaveProperty("text");
  });

  it("документ-основание — ссылка на PDF", () => {
    const [row] = operationRows([item({ id: "s", type: "SPLIT_MASTER", basisDocumentId: "doc1" })]);
    expect(row?.basis).toEqual({ documentId: "doc1", href: "/api/documents/doc1/pdf" });
  });

  it("пустой журнал — пустой список", () => {
    expect(operationRows([])).toEqual([]);
  });
});
