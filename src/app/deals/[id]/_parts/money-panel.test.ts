import { describe, expect, it } from "vitest";
import type { MoneyBlock } from "@/modules/payments";
import { moneyPanel as panelOf } from "./money-panel";

/** Суммы набраны неразрывными пробелами; в ожиданиях — обычные, ради читаемости. */
const plain = (s: string) => s.replace(/ /g, " ");
const moneyPanel = (...args: Parameters<typeof panelOf>) => {
  const p = panelOf(...args);
  return { ...p, title: plain(p.title), lines: p.lines.map(plain) };
};
const reservedAt = new Date("2026-11-03T07:00:00Z"); // 3 ноября, 12:00 в Астане
const base = { bankBalanceTiyn: 0n, isTest: false };
const block = (b: Omit<MoneyBlock, "bankBalanceTiyn" | "isTest"> & Partial<MoneyBlock>): MoneyBlock => ({ ...base, ...b }) as MoneyBlock;
const payout = 9_600_000n; // 96 000 ₸ мастеру

describe("блок денег — первый блок карточки сделки (ТЗ п. 4.1)", () => {
  it("до оплаты покупатель видит серый «Ожидает оплаты — деньги ещё не внесены»", () => {
    const p = moneyPanel(block({ kind: "awaiting", payment: "none" }), "CLIENT", payout);
    expect(p).toMatchObject({ tone: "neutral", icon: "clock", title: "Ожидает оплаты", lines: ["Деньги ещё не внесены"] });
  });

  it("до оплаты мастер видит зеркальный текст о резервировании в банке (ТЗ п. 4.2)", () => {
    const p = moneyPanel(block({ kind: "awaiting", payment: "none" }), "EXECUTOR", payout);
    expect(p.lines).toEqual(["Деньги покупателя будут зарезервированы в банке до начала работ"]);
  });

  it("оплата в обработке банка и отказ банка — свои заголовки", () => {
    expect(moneyPanel(block({ kind: "awaiting", payment: "PENDING" }), "CLIENT", payout)).toMatchObject({ tone: "neutral", title: "Оплата в обработке" });
    expect(moneyPanel(block({ kind: "awaiting", payment: "FAILED" }), "CLIENT", payout)).toMatchObject({
      tone: "warning",
      icon: "alert",
      title: "Оплата не прошла",
      lines: ["Деньги не списаны. Попробуйте оплатить ещё раз"],
    });
  });

  it("после оплаты покупатель видит зелёный блок с замком, датой резервирования и номером операции", () => {
    const p = moneyPanel(block({ kind: "protected", amountTiyn: 10_200_000n, reservedAt, operationRef: "HOLD-77" }), "CLIENT", payout);
    expect(p).toMatchObject({ tone: "success", icon: "lock" });
    expect(p.title).toBe("102 000 ₸ — под защитой банка. Недоступны мастеру до вашей подписи акта");
    expect(p.lines).toEqual(["Зарезервировано 3 ноября 2026", "Операция № HOLD-77"]);
  });

  it("мастеру после оплаты — сумма к его выплате, а не сумма оплаты покупателя", () => {
    const p = moneyPanel(block({ kind: "protected", amountTiyn: 10_200_000n, reservedAt, operationRef: null }), "EXECUTOR", payout);
    expect(p.title).toBe("Деньги зарезервированы: 96 000 ₸ — получите после подписания акта покупателем");
    expect(p.lines).toEqual(["Зарезервировано 3 ноября 2026"]);
  });

  it("открыт спор — жёлтый «Выплата заморожена до решения спора»", () => {
    const p = moneyPanel(block({ kind: "frozen", amountTiyn: payout, frozenAt: reservedAt }), "CLIENT", payout);
    expect(p).toMatchObject({ tone: "warning", icon: "pause", title: "Выплата заморожена до решения спора", lines: ["Сумма к выплате: 96 000 ₸"] });
  });

  it("выплата подтверждена — «Сделка завершена», выплачено мастеру и защита сделки", () => {
    const done = block({ kind: "completed", paidToMasterTiyn: payout, protectionTiyn: 200_000n, refundedTiyn: 0n, settled: true, completedAt: reservedAt });
    expect(moneyPanel(done, "CLIENT", payout)).toMatchObject({
      tone: "success",
      icon: "check",
      title: "Сделка завершена",
      lines: ["Выплачено мастеру: 96 000 ₸", "Защита сделки: 2 000 ₸"],
    });
    expect(moneyPanel(done, "EXECUTOR", payout).lines).toEqual(["Выплачено вам: 96 000 ₸"]);
  });

  it("выплата в банке ещё не подтверждена — «Банк проводит выплату», суммы к выплате", () => {
    const p = moneyPanel(block({ kind: "completed", paidToMasterTiyn: payout, protectionTiyn: 200_000n, refundedTiyn: 0n, settled: false, completedAt: null }), "EXECUTOR", payout);
    expect(p).toMatchObject({ icon: "clock", title: "Банк проводит выплату", lines: ["К выплате вам: 96 000 ₸"] });
  });

  it("частичный раздел по спору — ещё и возврат покупателю", () => {
    const p = moneyPanel(block({ kind: "completed", paidToMasterTiyn: 4_800_000n, protectionTiyn: 100_000n, refundedTiyn: 5_100_000n, settled: true, completedAt: reservedAt }), "CLIENT", payout);
    expect(p.lines).toEqual(["Выплачено мастеру: 48 000 ₸", "Защита сделки: 1 000 ₸", "Возвращено покупателю: 51 000 ₸"]);
  });

  it("возврат: подтверждён — «Деньги вернулись покупателю», в банке — «Деньги вернутся на вашу карту»", () => {
    expect(moneyPanel(block({ kind: "refunded", amountTiyn: 10_200_000n, settled: true, refundedAt: reservedAt }), "CLIENT", payout)).toMatchObject({
      tone: "neutral",
      icon: "undo",
      title: "Деньги вернулись покупателю: 102 000 ₸",
      lines: [],
    });
    expect(moneyPanel(block({ kind: "refunded", amountTiyn: 10_200_000n, settled: false, refundedAt: null }), "CLIENT", payout)).toMatchObject({
      icon: "clock",
      title: "Деньги вернутся на вашу карту",
      lines: ["Сумма возврата: 102 000 ₸"],
    });
    expect(moneyPanel(block({ kind: "refunded", amountTiyn: 10_200_000n, settled: false, refundedAt: null }), "EXECUTOR", payout).title).toBe("Банк возвращает деньги покупателю");
  });

  it("тестовые деньги честно помечены, настоящие — без пометки", () => {
    const test = moneyPanel(block({ kind: "protected", amountTiyn: 1n, reservedAt, operationRef: null, isTest: true }), "CLIENT", payout);
    expect(test.testNote).toBe("Тестовый платёж — настоящие деньги не списываются");
    expect(moneyPanel(block({ kind: "awaiting", payment: "none" }), "CLIENT", payout).testNote).toBeNull();
  });
});
