import { describe, expect, it } from "vitest";
import { ru } from "@/i18n/ru";
import type { DealStatus } from "@/generated/prisma/enums";
import type { MoneyBlock } from "@/modules/payments";
import { dealStatusText, dealStepsView, dealTone, payWaitsMaster, paymentWait, progressCaption } from "./deal-summary";

const s = ru.app.buyer.home.deal;

describe("dealStepsView: полный ход сделки", () => {
  it.each([
    ["CREATED", ["current", "todo", "todo", "todo", "todo"]],
    ["PAID_HOLD", ["done", "current", "todo", "todo", "todo"]],
    ["IN_PROGRESS", ["done", "current", "todo", "todo", "todo"]],
    ["READY", ["done", "done", "done", "current", "todo"]],
    ["ACCEPTED", ["done", "done", "done", "done", "current"]],
    ["SPLIT_PAYOUT", ["done", "done", "done", "done", "done"]],
  ] as const)("%s", (status, states) => {
    const view = dealStepsView(status, false, null);
    expect(view.kind === "steps" ? view.items.map((i) => i.state) : null).toEqual(states);
  });

  it("до подписи оферты первый шаг — «Оферта и оплата»", () => {
    const view = dealStepsView("CREATED", false, "signContract");
    expect(view.kind === "steps" ? view.items[0]?.label : null).toBe(s.offerStep);
    const paid = dealStepsView("CREATED", false, "pay");
    expect(paid.kind === "steps" ? paid.items[0]?.label : null).toBe(s.steps[0]);
  });

  it("спор, отмена, возврат — строка вместо шкалы", () => {
    expect(dealStepsView("READY", true, "waitDispute")).toEqual({ kind: "stopped", label: s.stopped.dispute });
    expect(dealStepsView("CANCELLED", false, "cancelled")).toEqual({ kind: "stopped", label: s.stopped.cancelled });
    expect(dealStepsView("REFUNDED", false, "refunded")).toEqual({ kind: "stopped", label: s.stopped.refunded });
  });
});

describe("progressCaption и dealStatusText", () => {
  it("«Шаг N из 5: …», «Все шаги пройдены», остановленный — без строки", () => {
    expect(progressCaption({ kind: "steps", done: 1, total: 5 }, "waitReady")).toBe(s.caption(2, 5, "Изготовление"));
    expect(progressCaption({ kind: "steps", done: 0, total: 5 }, "signContract")).toBe(s.caption(1, 5, s.offerStep));
    expect(progressCaption({ kind: "steps", done: 5, total: 5 }, "done")).toBe(s.allDone);
    expect(progressCaption({ kind: "stopped", reason: "dispute" }, null)).toBeNull();
  });

  it("открытый спор важнее статуса", () => {
    expect(dealStatusText("READY", true)).toBe(ru.app.deal.status.dispute);
    expect(dealStatusText("READY", false)).toBe(ru.app.deal.status.READY);
  });
});

describe("плашка при ожидании оплаты: одно правило для карточки, списка и главной", () => {
  const awaiting = (payment: "none" | "PENDING" | "FAILED"): MoneyBlock => ({ kind: "awaiting", payment, bankBalanceTiyn: 0n, isTest: false });
  const protectedBlock: MoneyBlock = { kind: "protected", amountTiyn: 1n, reservedAt: new Date(), operationRef: null, bankBalanceTiyn: 1n, isTest: false };
  const status = ru.app.deal.status;

  // [статус, блок денег, провайдер, спор, ожидание, текст плашки]
  const TABLE: [string, DealStatus, MoneyBlock, string, boolean, ReturnType<typeof paymentWait>, string][] = [
    ["перевод оформлен, поступления нет", "CREATED", awaiting("PENDING"), "MANUAL", false, "transfer", status.transfer],
    ["онлайн-оплата у банка", "CREATED", awaiting("PENDING"), "FREEDOMPAY", false, "online", status.processing],
    ["онлайн-оплата (тестовый провайдер)", "CREATED", awaiting("PENDING"), "MOCK", false, "online", status.processing],
    ["оплаты ещё не было — как раньше", "CREATED", awaiting("none"), "MANUAL", false, null, status.CREATED],
    ["прошлая оплата не прошла — как раньше", "CREATED", awaiting("FAILED"), "MANUAL", false, null, status.CREATED],
    ["деньги в банке — статус по сделке", "PAID_HOLD", protectedBlock, "MANUAL", false, null, status.PAID_HOLD],
    ["открытый спор важнее ожидания", "CREATED", awaiting("PENDING"), "MANUAL", true, "transfer", status.dispute],
  ];

  it.each(TABLE)("%s", (_name, dealStatus, money, paymentProvider, dispute, wait, text) => {
    expect(paymentWait({ status: dealStatus, money, paymentProvider })).toBe(wait);
    expect(dealStatusText(dealStatus, dispute, wait)).toBe(text);
  });

  it("без признака ожидания текст по статусу, как раньше", () => {
    expect(dealStatusText("CREATED", false)).toBe(status.CREATED);
  });
});

describe("решённый спор, тон и закрытая оплата", () => {
  it("спор решён разделом или возвратом — шкала остановлена; «продолжить» — обычная шкала", () => {
    expect(dealStepsView("SPLIT_PAYOUT", false, "done", "PARTIAL_SPLIT")).toEqual({ kind: "stopped", label: ru.app.deal.card.steps.disputeSplit });
    expect(dealStepsView("READY", false, "waitRefund", "FULL_REFUND")).toEqual({ kind: "stopped", label: ru.app.deal.card.steps.disputeRefund });
    expect(dealStepsView("REFUNDED", false, "refunded", "FULL_REFUND")).toEqual({ kind: "stopped", label: s.stopped.refunded });
    expect(dealStepsView("IN_PROGRESS", false, "waitReady", "CONTINUE").kind).toBe("steps");
  });

  it("dealTone: отзыв и закрытая до согласия мастера оплата — не «внимание»", () => {
    expect(dealTone({ status: "SPLIT_PAYOUT", hasOpenDispute: false, next: { action: "leaveReview", mine: true } })).toBe("accent");
    expect(dealTone({ status: "CREATED", hasOpenDispute: false, next: { action: "pay", mine: true }, payWaitsMaster: true })).toBe("neutral");
    expect(dealTone({ status: "CREATED", hasOpenDispute: false, next: { action: "pay", mine: true } })).toBe("warn");
  });

  it("payWaitsMaster: только оплата покупателя и только без отметки мастера", () => {
    expect(payWaitsMaster({ action: "pay", mine: true }, { other: false })).toBe(true);
    expect(payWaitsMaster({ action: "pay", mine: true }, { other: true })).toBe(false);
    expect(payWaitsMaster({ action: "pay", mine: true }, null)).toBe(false);
    expect(payWaitsMaster({ action: "signContract", mine: true }, { other: false })).toBe(false);
  });
});
