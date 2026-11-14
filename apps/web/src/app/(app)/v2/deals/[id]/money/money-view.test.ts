import { describe, expect, it } from "vitest";
import { ru } from "@/i18n/ru";
import type { MoneyHistoryItem } from "@/modules/payments";
import { operationRows } from "./money-view";

const t = ru.app.deal.money;
let seq = 0;
const item = (over: Partial<MoneyHistoryItem> & Pick<MoneyHistoryItem, "type">): MoneyHistoryItem => ({
  id: over.id ?? `e${++seq}`,
  status: "SUCCEEDED",
  amountTiyn: 100n,
  at: new Date(2026, 10, 10, 10, seq),
  basisDocumentId: null,
  operationRef: null,
  isTest: true,
  ...over,
});

describe("operationRows: движение денег покупателя", () => {
  it("оплата и возврат — строки с суммами журнала, свежие сверху", () => {
    const rows = operationRows([item({ id: "a", type: "HOLD", amountTiyn: 102_000_00n }), item({ id: "b", type: "REFUND", amountTiyn: 102_000_00n })]);
    expect(rows.map((r) => [r.covers, r.title, r.amount])).toEqual([
      [["b"], t.type.REFUND, 102_000_00n],
      [["a"], t.type.HOLD, 102_000_00n],
    ]);
  });

  it("выплата мастеру и доход сервиса сворачиваются в одну строку без суммы", () => {
    const rows = operationRows([
      item({ id: "h", type: "HOLD", amountTiyn: 102_000_00n }),
      item({ id: "m", type: "SPLIT_MASTER", amountTiyn: 96_000_00n, basisDocumentId: "act1" }),
      item({ id: "p", type: "SPLIT_PLATFORM", amountTiyn: 6_000_00n }),
    ]);
    expect(rows).toHaveLength(2);
    const [payout, hold] = rows;
    expect(payout?.title).toBe(t.payout);
    expect(payout?.covers).toEqual(["m", "p"]);
    expect(payout).not.toHaveProperty("amount");
    expect(payout?.basis?.documentId).toBe("act1");
    expect(hold?.amount).toBe(102_000_00n);
  });

  it("раздел по спору: возврат называется «Спор решён: возвращено вам», остальное ушло мастеру — без суммы", () => {
    const rows = operationRows([
      item({ id: "h", type: "HOLD", amountTiyn: 102_000_00n }),
      item({ id: "m", type: "SPLIT_MASTER", amountTiyn: 57_600_00n }),
      item({ id: "p", type: "SPLIT_PLATFORM", amountTiyn: 3_600_00n }),
      item({ id: "r", type: "REFUND", amountTiyn: 40_800_00n }),
    ]);
    const byTitle = Object.fromEntries(rows.map((r) => [r.title, r]));
    expect(byTitle[t.refundSplit]?.amount).toBe(40_800_00n);
    expect(byTitle[t.payoutRest]).not.toHaveProperty("amount");
  });

  it("остановка и снятие остановки выплаты — без суммы (сумма записи — часть мастера)", () => {
    const rows = operationRows([item({ type: "FREEZE", amountTiyn: 96_000_00n }), item({ type: "UNFREEZE", amountTiyn: 96_000_00n })]);
    for (const row of rows) expect(row).not.toHaveProperty("amount");
  });

  it("каждая запись журнала показана или свёрнута — ровно в одной строке", () => {
    const history = [item({ type: "HOLD" }), item({ type: "FREEZE" }), item({ type: "UNFREEZE" }), item({ type: "SPLIT_MASTER" }), item({ type: "SPLIT_PLATFORM" }), item({ type: "REFUND" })];
    const covered = operationRows(history).flatMap((r) => r.covers);
    expect([...covered].sort()).toEqual(history.map((h) => h.id).sort());
  });

  it("слова: нет «комиссия», «эскроу», «тестовый», «гарантия», «4%»", () => {
    const history = [item({ type: "HOLD" }), item({ type: "FREEZE" }), item({ type: "SPLIT_MASTER" }), item({ type: "SPLIT_PLATFORM" }), item({ type: "REFUND" })];
    for (const row of operationRows(history)) expect(`${row.title} ${row.text ?? ""}`).not.toMatch(/комисси|эскроу|тестов|демо|платформ|гаранти|4%/i);
  });

  it("статус банка и номер операции — в тексте; пометка тестового платежа не выводится", () => {
    const [row] = operationRows([item({ type: "REFUND", status: "PENDING", operationRef: "BK-1" })]);
    expect(row?.text).toBe(`${t.status.PENDING} · ${t.bankRef("BK-1")}`);
  });

  it("документ-основание — ссылка на PDF; пустой журнал — пустой список", () => {
    expect(operationRows([item({ type: "HOLD", basisDocumentId: "doc1" })])[0]?.basis).toEqual({ documentId: "doc1", href: "/api/documents/doc1/pdf" });
    expect(operationRows([])).toEqual([]);
  });
});
