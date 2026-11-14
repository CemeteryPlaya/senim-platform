import { describe, expect, it } from "vitest";
import { ru } from "@/i18n/ru";
import type { MoneyHistoryItem } from "@/modules/payments";
import { masterOperationRows, operationRows } from "./money-view";

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
    const rows = operationRows(
      [
        item({ id: "h", type: "HOLD", amountTiyn: 102_000_00n }),
        item({ id: "m", type: "SPLIT_MASTER", amountTiyn: 96_000_00n, basisDocumentId: "act1" }),
        item({ id: "p", type: "SPLIT_PLATFORM", amountTiyn: 6_000_00n }),
      ],
      { kinds: new Map([["act1", "ACCEPTANCE_ACT"]]) },
    );
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

  it("номер операции банка — в тексте; пометка тестового платежа не выводится", () => {
    const [row] = operationRows([item({ type: "REFUND", operationRef: "BK-1" })]);
    expect(row?.text).toBe(t.bankRef("BK-1"));
  });

  describe("заголовок оплаты зависит от состояния в банке", () => {
    it("проведена: «Вы оплатили — деньги в банке под защитой» с суммой", () => {
      const [row] = operationRows([item({ type: "HOLD", status: "SUCCEEDED", amountTiyn: 102_000_00n })]);
      expect([row?.title, row?.amount]).toEqual([t.type.HOLD, 102_000_00n]);
    });
    it("ждёт банка: «Оплата обрабатывается» (с суммой)", () => {
      const [row] = operationRows([item({ type: "HOLD", status: "PENDING", amountTiyn: 102_000_00n })]);
      expect([row?.title, row?.amount]).toEqual([t.hold.PENDING, 102_000_00n]);
    });
    it("ждёт банка при переводе по реквизитам: «Ждём ваш перевод»", () => {
      const [row] = operationRows([item({ type: "HOLD", status: "PENDING" })], { manual: true });
      expect(row?.title).toBe(t.hold.WAITING);
    });
    it("не прошла: «Оплата не прошла», суммы нет", () => {
      const [row] = operationRows([item({ type: "HOLD", status: "FAILED", amountTiyn: 102_000_00n })]);
      expect(row?.title).toBe(t.hold.FAILED);
      expect(row).not.toHaveProperty("amount");
    });
  });

  describe("заголовок возврата зависит от состояния в банке", () => {
    it("проведён: «Деньги возвращены вам» с суммой", () => {
      const [row] = operationRows([item({ type: "REFUND", status: "SUCCEEDED", amountTiyn: 5n })]);
      expect([row?.title, row?.amount]).toEqual([t.type.REFUND, 5n]);
    });
    it("ждёт банка: «Возврат обрабатывается»", () => {
      expect(operationRows([item({ type: "REFUND", status: "PENDING" })])[0]?.title).toBe(t.refundState.PENDING);
    });
    it("не прошёл: «Возврат не прошёл — оператор повторит»", () => {
      expect(operationRows([item({ type: "REFUND", status: "FAILED" })])[0]?.title).toBe(t.refundState.FAILED);
    });
  });

  describe("свёрнутая выплата мастеру — по последним попыткам частей", () => {
    const split = (status: MoneyHistoryItem["status"], type: "SPLIT_MASTER" | "SPLIT_PLATFORM", id?: string) => item({ type, status, ...(id ? { id } : {}) });
    const title = (history: MoneyHistoryItem[]) => operationRows(history).find((r) => r.kind === "payout")?.title;

    it("обе части проведены — «Оплата переведена мастеру»", () => {
      expect(title([split("SUCCEEDED", "SPLIT_MASTER"), split("SUCCEEDED", "SPLIT_PLATFORM")])).toBe(t.payout);
    });
    it("часть ждёт банка — «Банк переводит оплату мастеру»", () => {
      expect(title([split("PENDING", "SPLIT_MASTER"), split("SUCCEEDED", "SPLIT_PLATFORM")])).toBe(t.payoutState.PENDING);
    });
    it("часть отклонена — «Выплата мастеру не прошла — оператор повторит»", () => {
      expect(title([split("FAILED", "SPLIT_MASTER"), split("SUCCEEDED", "SPLIT_PLATFORM")])).toBe(t.payoutState.FAILED);
    });
    it("отказ → повтор → успех: «Оплата переведена мастеру», «не прошла» нет, записи покрыты", () => {
      const history = [split("FAILED", "SPLIT_MASTER", "m1"), split("SUCCEEDED", "SPLIT_PLATFORM", "p1"), split("SUCCEEDED", "SPLIT_MASTER", "m2")];
      const rows = operationRows(history);
      expect(rows).toHaveLength(1);
      expect(rows[0]?.title).toBe(t.payout);
      expect(rows[0]?.title).not.toMatch(/не прошла/);
      expect([...(rows[0]?.covers ?? [])].sort()).toEqual(["m1", "m2", "p1"]);
    });
    it("отказ → повтор ждёт банка: «Банк переводит оплату мастеру»", () => {
      expect(title([split("FAILED", "SPLIT_MASTER"), split("SUCCEEDED", "SPLIT_PLATFORM"), split("PENDING", "SPLIT_MASTER")])).toBe(t.payoutState.PENDING);
    });
    it("раздел по спору: проведено — «Остальное переведено мастеру», ждёт — «Банк переводит остальное мастеру»", () => {
      const refund = item({ type: "REFUND" });
      expect(title([split("SUCCEEDED", "SPLIT_MASTER"), split("SUCCEEDED", "SPLIT_PLATFORM"), refund])).toBe(t.payoutRest);
      expect(title([split("PENDING", "SPLIT_MASTER"), split("SUCCEEDED", "SPLIT_PLATFORM"), refund])).toBe(t.payoutState.PENDING_REST);
    });
  });

  it("документ-основание — ссылка на PDF с подписью по виду документа; вид неизвестен — без ссылки; пустой журнал — пустой список", () => {
    const kinds = new Map([["doc1", "CONTRACT" as const]]);
    expect(operationRows([item({ type: "HOLD", basisDocumentId: "doc1" })], { kinds })[0]?.basis).toEqual({
      documentId: "doc1",
      href: "/api/documents/doc1/pdf",
      label: "Открыть оферту",
    });
    expect(operationRows([item({ type: "HOLD", basisDocumentId: "doc2" })], { kinds })[0]?.basis).toBeNull();
    expect(operationRows([])).toEqual([]);
  });
});

describe("masterOperationRows: движение денег мастера", () => {
  const tm = ru.app.masterMoney;
  const BUYER_AMOUNT = 102_000_00n;
  const MASTER_AMOUNT = 96_000_00n;
  const journal = () => [
    item({ id: "h", type: "HOLD", amountTiyn: BUYER_AMOUNT, operationRef: "BUYER-REF" }),
    item({ id: "m", type: "SPLIT_MASTER", amountTiyn: MASTER_AMOUNT, operationRef: "BK-9", basisDocumentId: "act1" }),
    item({ id: "p", type: "SPLIT_PLATFORM", amountTiyn: 6_000_00n }),
  ];

  it("оплата покупателя: строка без суммы покупателя, без его номера операции и без обещания «Вы получите»", () => {
    const [row] = masterOperationRows([item({ type: "HOLD", amountTiyn: BUYER_AMOUNT, operationRef: "BUYER-REF" })]);
    expect(row?.title).toBe(tm.hold.DONE);
    expect(row).not.toHaveProperty("amount");
    expect(row).not.toHaveProperty("text");
    expect(row?.basis).toBeNull();
  });

  it("оплата ждёт банка / перевод по реквизитам / не прошла — без сумм", () => {
    expect(masterOperationRows([item({ type: "HOLD", status: "PENDING" })])[0]?.title).toBe(tm.hold.PENDING);
    expect(masterOperationRows([item({ type: "HOLD", status: "PENDING" })], { manual: true })[0]?.title).toBe(tm.hold.WAITING);
    const failed = masterOperationRows([item({ type: "HOLD", status: "FAILED" })])[0];
    expect(failed?.title).toBe(tm.hold.FAILED);
    expect(failed).not.toHaveProperty("amount");
  });

  it("остановка спором и снятие — без суммы", () => {
    const rows = masterOperationRows([item({ type: "FREEZE", amountTiyn: MASTER_AMOUNT }), item({ type: "UNFREEZE", amountTiyn: MASTER_AMOUNT })]);
    expect(rows.map((r) => r.title)).toEqual([tm.unfreeze, tm.freeze]);
    for (const row of rows) expect(row).not.toHaveProperty("amount");
  });

  it("оплата мастеру: сумма мастера и номер операции банка; доход сервиса свёрнут в ту же строку без суммы", () => {
    const rows = masterOperationRows(journal());
    expect(rows).toHaveLength(2);
    const [payout] = rows;
    expect(payout?.title).toBe(tm.payout.DONE);
    expect(payout?.amount).toBe(MASTER_AMOUNT);
    expect(payout?.text).toBe(tm.bankRef("BK-9"));
    expect(payout?.covers).toEqual(["m", "p"]);
    expect(payout?.basis).toBeNull();
    expect(rows.some((r) => r.amount === BUYER_AMOUNT || r.amount === 6_000_00n)).toBe(false);
  });

  it("оплата мастеру по состоянию банка: ждёт, отказ (без суммы), отказ → повтор → успех", () => {
    const split = (status: MoneyHistoryItem["status"], type: "SPLIT_MASTER" | "SPLIT_PLATFORM", id?: string) => item({ type, status, ...(id ? { id } : {}) });
    expect(masterOperationRows([split("PENDING", "SPLIT_MASTER"), split("SUCCEEDED", "SPLIT_PLATFORM")])[0]?.title).toBe(tm.payout.PENDING);
    const failed = masterOperationRows([split("FAILED", "SPLIT_MASTER"), split("SUCCEEDED", "SPLIT_PLATFORM")])[0];
    expect(failed?.title).toBe(tm.payout.FAILED);
    expect(failed).not.toHaveProperty("amount");
    const retried = masterOperationRows([split("FAILED", "SPLIT_MASTER", "m1"), split("SUCCEEDED", "SPLIT_PLATFORM", "p1"), split("SUCCEEDED", "SPLIT_MASTER", "m2")]);
    expect(retried).toHaveLength(1);
    expect(retried[0]?.title).toBe(tm.payout.DONE);
    expect([...(retried[0]?.covers ?? [])].sort()).toEqual(["m1", "m2", "p1"]);
  });

  it("возврат покупателю — одна строка без суммы; при разделе по спору — «часть оплаты» и «остаток вернулся»", () => {
    const refund = masterOperationRows([item({ type: "HOLD" }), item({ type: "REFUND", amountTiyn: BUYER_AMOUNT })]);
    expect(refund[0]?.title).toBe(tm.refund.DONE);
    expect(refund[0]).not.toHaveProperty("amount");
    expect(masterOperationRows([item({ type: "REFUND", status: "PENDING" })])[0]?.title).toBe(tm.refund.PENDING);
    expect(masterOperationRows([item({ type: "REFUND", status: "FAILED" })])[0]?.title).toBe(tm.refund.FAILED);
    const split = masterOperationRows([...journal(), item({ id: "r", type: "REFUND", amountTiyn: 40_800_00n })]);
    expect(split.map((r) => r.title)).toEqual(expect.arrayContaining([tm.refund.DONE_REST, tm.payout.DONE_PART]));
    expect(split.find((r) => r.kind === "refund")).not.toHaveProperty("amount");
  });

  it("каждая запись журнала показана или свёрнута ровно в одной строке; суммы покупателя и «2%» не выводятся", () => {
    const history = [...journal(), item({ type: "FREEZE" }), item({ type: "UNFREEZE" }), item({ type: "REFUND", amountTiyn: 40_800_00n })];
    const rows = masterOperationRows(history);
    expect(rows.flatMap((r) => r.covers).sort()).toEqual(history.map((h) => h.id).sort());
    for (const row of rows) expect(`${row.title} ${row.text ?? ""}`).not.toMatch(/комисси|эскроу|тестов|демо|платформ|2%|защит[аыеу] сделки|выплат|договор/i);
  });

  it("пустой журнал — пустой список", () => {
    expect(masterOperationRows([])).toEqual([]);
  });
});
