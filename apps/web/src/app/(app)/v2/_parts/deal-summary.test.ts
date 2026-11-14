import { describe, expect, it } from "vitest";
import { ru } from "@/i18n/ru";
import type { DealStatus } from "@/generated/prisma/enums";
import type { NextAction } from "@/modules/deal-core";
import type { MoneyBlock } from "@/modules/payments";
import { dealChip, dealStepsView, payWaitsMaster, paymentWait, progressCaption, type DealChip } from "./deal-summary";

const s = ru.app.buyer.home.deal;
const st = ru.app.deal.status;
const steps = ru.app.deal.steps;

describe("dealStepsView: полный ход сделки", () => {
  it.each([
    ["CREATED", ["current", "todo", "todo", "todo", "todo"]],
    ["PAID_HOLD", ["done", "current", "todo", "todo", "todo"]],
    ["IN_PROGRESS", ["done", "current", "todo", "todo", "todo"]],
    ["READY", ["done", "done", "done", "current", "todo"]],
    ["ACCEPTED", ["done", "done", "done", "done", "current"]],
    ["SPLIT_PAYOUT", ["done", "done", "done", "done", "done"]],
  ] as const)("%s", (status, states) => {
    const view = dealStepsView(status, false);
    expect(view.kind === "steps" ? view.items.map((i) => i.state) : null).toEqual(states);
  });

  it("подписи шкалы — те же, что в строке «Шаг N из 5»: первый — «Оферта и оплата», последний — «Оплата мастеру»", () => {
    const view = dealStepsView("PAID_HOLD", false);
    expect(view.kind === "steps" ? view.items.map((i) => i.label) : null).toEqual([...steps]);
    expect(steps[0]).toBe("Оферта и оплата");
    expect(steps.at(-1)).toBe("Оплата мастеру");
    expect(view.kind === "steps" ? view.caption : null).toBe(s.caption(2, 5, steps[1]));
    expect(steps.join(" ")).not.toMatch(/выплат/i);
  });

  it("спор, отмена, возврат — строка вместо шкалы; возврат — «Сделка закрыта» (о деньгах говорят плашка и блок денег)", () => {
    expect(dealStepsView("READY", true)).toEqual({ kind: "stopped", label: s.stopped.dispute });
    expect(dealStepsView("CANCELLED", false)).toEqual({ kind: "stopped", label: s.stopped.cancelled });
    expect(dealStepsView("REFUNDED", false)).toEqual({ kind: "stopped", label: "Сделка закрыта" });
  });

  it("спор решён разделом или возвратом — шкала остановлена; «продолжить» — обычная шкала", () => {
    expect(dealStepsView("SPLIT_PAYOUT", false, "PARTIAL_SPLIT")).toEqual({ kind: "stopped", label: ru.app.deal.card.steps.disputeSplit });
    expect(dealStepsView("READY", false, "FULL_REFUND")).toEqual({ kind: "stopped", label: ru.app.deal.card.steps.disputeRefund });
    expect(dealStepsView("REFUNDED", false, "FULL_REFUND")).toEqual({ kind: "stopped", label: s.stopped.refunded });
    expect(dealStepsView("IN_PROGRESS", false, "CONTINUE").kind).toBe("steps");
  });
});

describe("progressCaption", () => {
  it("«Шаг N из 5: …» с подписями шкалы, «Все шаги пройдены», остановленный — без строки", () => {
    expect(progressCaption({ kind: "steps", done: 1, total: 5 })).toBe(s.caption(2, 5, "Изготовление"));
    expect(progressCaption({ kind: "steps", done: 0, total: 5 })).toBe(s.caption(1, 5, "Оферта и оплата"));
    expect(progressCaption({ kind: "steps", done: 5, total: 5 })).toBe(s.allDone);
    expect(progressCaption({ kind: "stopped", reason: "dispute" })).toBeNull();
  });
});

describe("dealChip: плашка называет текущий шаг — одна функция для главной, списка и карточки", () => {
  const awaiting = (payment: "none" | "PENDING" | "FAILED"): MoneyBlock => ({ kind: "awaiting", payment, bankBalanceTiyn: 0n, isTest: false });
  const protectedBlock: MoneyBlock = { kind: "protected", amountTiyn: 1n, reservedAt: new Date(), operationRef: null, bankBalanceTiyn: 1n, isTest: false };
  const completed = (refundedTiyn: bigint): MoneyBlock => ({
    kind: "completed",
    paidToMasterTiyn: 1n,
    protectionTiyn: 1n,
    refundedTiyn,
    settled: false,
    completedAt: null,
    bankBalanceTiyn: 1n,
    isTest: false,
  });
  const refundedBlock: MoneyBlock = { kind: "refunded", amountTiyn: 1n, settled: true, refundedAt: new Date(), bankBalanceTiyn: 0n, isTest: false };

  type Row = [string, DealStatus, NextAction | null, boolean, MoneyBlock, { dispute?: boolean; waitsMaster?: boolean; provider?: string }, string, DealChip["tone"]];
  const ROWS: Row[] = [
    ["оферта ждёт моей подписи", "CREATED", "signContract", true, awaiting("none"), {}, st.signOffer, "warn"],
    ["ждём подпись мастера", "CREATED", "waitContractSignature", false, awaiting("none"), {}, st.waitOffer, "neutral"],
    ["оферта заключена, ждём согласие мастера банку", "CREATED", "pay", true, awaiting("none"), { waitsMaster: true }, st.waitMasterBank, "neutral"],
    ["можно платить", "CREATED", "pay", true, awaiting("none"), {}, st.pay, "warn"],
    ["прошлая оплата не прошла — снова «Оплатите заказ»", "CREATED", "pay", true, awaiting("FAILED"), {}, st.pay, "warn"],
    ["ждём перевод (ручной провайдер)", "CREATED", "waitPaymentConfirmation", false, awaiting("PENDING"), { provider: "MANUAL" }, st.transfer, "neutral"],
    ["онлайн-оплата у банка", "CREATED", "waitPaymentConfirmation", false, awaiting("PENDING"), { provider: "FREEDOMPAY" }, st.processing, "neutral"],
    ["оплачено, ждём начала", "PAID_HOLD", "waitStart", false, protectedBlock, {}, st.protected, "accent"],
    ["мастер делает мебель", "IN_PROGRESS", "waitReady", false, protectedBlock, {}, st.inWork, "accent"],
    ["готово, нужна моя приёмка", "READY", "signAct", true, protectedBlock, {}, st.accept, "warn"],
    ["я принял(а), ждём подпись мастера на акте", "READY", "waitMasterActSignature", false, protectedBlock, {}, st.waitAct, "neutral"],
    ["ждём выплату", "ACCEPTED", "waitPayout", false, completed(0n), {}, st.finishing, "neutral"],
    ["завершена", "SPLIT_PAYOUT", "done", false, completed(0n), {}, st.done, "accent"],
    ["завершена, ждёт отзыва — всё равно «Завершена»", "SPLIT_PAYOUT", "leaveReview", true, completed(0n), {}, st.done, "accent"],
    ["отмена после оплаты, деньги возвращаются", "PAID_HOLD", "waitRefund", false, protectedBlock, {}, st.refunding, "neutral"],
    ["спор открыт", "IN_PROGRESS", "waitDispute", false, protectedBlock, { dispute: true }, st.dispute, "warn"],
    ["спор открыт важнее ожидания оплаты", "CREATED", "waitPaymentConfirmation", false, awaiting("PENDING"), { dispute: true, provider: "MANUAL" }, st.dispute, "warn"],
    ["спор решён разделом, выплата идёт", "ACCEPTED", "waitPayout", false, completed(5n), {}, st.disputeResolved, "neutral"],
    ["спор решён разделом, сделка закрыта", "SPLIT_PAYOUT", "done", false, completed(5n), {}, st.disputeResolved, "neutral"],
    ["отменена", "CANCELLED", "cancelled", false, awaiting("none"), {}, st.cancelled, "neutral"],
    ["деньги возвращены", "REFUNDED", "refunded", false, refundedBlock, {}, st.refunded, "neutral"],
    ["«что дальше» неизвестно: создана", "CREATED", null, false, awaiting("none"), {}, st.offer, "neutral"],
    ["«что дальше» неизвестно: оплачено", "PAID_HOLD", null, false, protectedBlock, {}, st.protected, "accent"],
    ["«что дальше» неизвестно: работа идёт", "IN_PROGRESS", null, false, protectedBlock, {}, st.inWork, "accent"],
    ["«что дальше» неизвестно: сдана", "READY", null, false, protectedBlock, {}, st.handedOver, "neutral"],
    ["«что дальше» неизвестно: принята", "ACCEPTED", null, false, completed(0n), {}, st.finishing, "neutral"],
    ["«что дальше» неизвестно, но оплата у банка — по журналу", "CREATED", null, false, awaiting("PENDING"), { provider: "MANUAL" }, st.transfer, "neutral"],
    ["шаг мастера (не покупателя) — по статусу", "IN_PROGRESS", "submitReady", true, protectedBlock, {}, st.inWork, "accent"],
  ];

  it.each(ROWS)("%s", (_name, status, action, mine, money, o, text, tone) => {
    const chip = dealChip({
      status,
      hasOpenDispute: o.dispute ?? false,
      next: action ? { action, mine } : null,
      payWaitsMaster: o.waitsMaster ?? false,
      money,
      paymentProvider: o.provider ?? "MOCK",
    });
    expect(chip).toEqual({ text, tone });
  });

  it("один текст — один тон; у каждого текста словаря есть строка таблицы", () => {
    const tones = new Map<string, string>();
    for (const [, , , , , , text, tone] of ROWS) {
      expect(tones.get(text) ?? tone).toBe(tone);
      tones.set(text, tone);
    }
    expect([...tones.keys()].sort()).toEqual(Object.values(st).sort());
  });

  it("paymentWait: ожидание оплаты по журналу — только у CREATED с оплатой в обработке", () => {
    expect(paymentWait({ status: "CREATED", money: awaiting("PENDING"), paymentProvider: "MANUAL" })).toBe("transfer");
    expect(paymentWait({ status: "CREATED", money: awaiting("PENDING"), paymentProvider: "MOCK" })).toBe("online");
    expect(paymentWait({ status: "CREATED", money: awaiting("none"), paymentProvider: "MANUAL" })).toBeNull();
    expect(paymentWait({ status: "PAID_HOLD", money: protectedBlock, paymentProvider: "MANUAL" })).toBeNull();
  });

  it("payWaitsMaster: только оплата покупателя и только без отметки мастера", () => {
    expect(payWaitsMaster({ action: "pay", mine: true }, { other: false })).toBe(true);
    expect(payWaitsMaster({ action: "pay", mine: true }, { other: true })).toBe(false);
    expect(payWaitsMaster({ action: "pay", mine: true }, null)).toBe(false);
    expect(payWaitsMaster({ action: "signContract", mine: true }, { other: false })).toBe(false);
  });
});
