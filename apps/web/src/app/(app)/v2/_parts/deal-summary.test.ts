import { describe, expect, it } from "vitest";
import { ru } from "@/i18n/ru";
import type { DealStatus } from "@/generated/prisma/enums";
import type { NextAction } from "@/modules/deal-core";
import type { MoneyBlock } from "@/modules/payments";
import {
  dealChip,
  dealMoneyLine,
  dealStepsView,
  masterConsentMissing,
  payWaitsMaster,
  paymentWait,
  progressCaption,
  quietChip,
  stoppedLabel,
  type DealChip,
  type DealMoneyLine,
} from "./deal-summary";

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
    const view = dealStepsView(status, false, null, "CLIENT");
    expect(view.kind === "steps" ? view.items.map((i) => i.state) : null).toEqual(states);
  });

  it("подписи шкалы — те же, что в строке «Шаг N из 5»: первый — «Оферта и оплата», последний — «Оплата мастеру»", () => {
    const view = dealStepsView("PAID_HOLD", false, null, "CLIENT");
    expect(view.kind === "steps" ? view.items.map((i) => i.label) : null).toEqual([...steps]);
    expect(steps[0]).toBe("Оферта и оплата");
    expect(steps.at(-1)).toBe("Оплата мастеру");
    expect(view.kind === "steps" ? view.caption : null).toBe(ru.app.deal.stepCaption(2, 5, steps[1]));
    expect(steps.join(" ")).not.toMatch(/выплат/i);
  });

  it("спор, отмена, возврат — строка вместо шкалы; возврат — «Сделка закрыта» (о деньгах говорят плашка и блок денег)", () => {
    expect(dealStepsView("READY", true, null, "CLIENT")).toEqual({ kind: "stopped", label: s.stopped.dispute });
    expect(dealStepsView("CANCELLED", false, null, "CLIENT")).toEqual({ kind: "stopped", label: s.stopped.cancelled });
    expect(dealStepsView("REFUNDED", false, null, "CLIENT")).toEqual({ kind: "stopped", label: "Сделка закрыта" });
  });

  it("спор решён разделом или возвратом — шкала остановлена; «продолжить» — обычная шкала", () => {
    expect(dealStepsView("SPLIT_PAYOUT", false, "PARTIAL_SPLIT", "CLIENT")).toEqual({ kind: "stopped", label: ru.app.deal.card.steps.disputeSplit });
    expect(dealStepsView("READY", false, "FULL_REFUND", "CLIENT")).toEqual({ kind: "stopped", label: ru.app.deal.card.steps.disputeRefund });
    expect(dealStepsView("REFUNDED", false, "FULL_REFUND", "CLIENT")).toEqual({ kind: "stopped", label: s.stopped.refunded });
    expect(dealStepsView("IN_PROGRESS", false, "CONTINUE", "CLIENT").kind).toBe("steps");
  });
});

describe("progressCaption", () => {
  it("«Шаг N из 5: …» с подписями шкалы, «Все шаги пройдены», остановленный — без строки", () => {
    expect(progressCaption({ kind: "steps", done: 1, total: 5 }, "CLIENT")).toBe(ru.app.deal.stepCaption(2, 5, "Изготовление"));
    expect(progressCaption({ kind: "steps", done: 0, total: 5 }, "CLIENT")).toBe(ru.app.deal.stepCaption(1, 5, "Оферта и оплата"));
    expect(progressCaption({ kind: "steps", done: 5, total: 5 }, "CLIENT")).toBe(ru.app.deal.allStepsDone);
    expect(progressCaption({ kind: "stopped", reason: "dispute" }, "CLIENT")).toBeNull();
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
    ["мастер делает мебель", "IN_PROGRESS", "waitReady", false, protectedBlock, {}, st.inWork, "neutral"],
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
    ["«что дальше» неизвестно: работа идёт", "IN_PROGRESS", null, false, protectedBlock, {}, st.inWork, "neutral"],
    ["«что дальше» неизвестно: сдана", "READY", null, false, protectedBlock, {}, st.handedOver, "neutral"],
    ["«что дальше» неизвестно: принята", "ACCEPTED", null, false, completed(0n), {}, st.finishing, "neutral"],
    ["«что дальше» неизвестно, но оплата у банка — по журналу", "CREATED", null, false, awaiting("PENDING"), { provider: "MANUAL" }, st.transfer, "neutral"],
    ["шаг мастера (не покупателя) — по статусу", "IN_PROGRESS", "submitReady", true, protectedBlock, {}, st.inWork, "neutral"],
  ];

  it.each(ROWS)("%s", (_name, status, action, mine, money, o, text, tone) => {
    const chip = dealChip({
      side: "CLIENT",
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

describe("сторона мастера: плашка, ход, строка денег", () => {
  const ms = ru.app.master.deal.status;
  const awaiting = (payment: "none" | "PENDING" | "FAILED"): MoneyBlock => ({ kind: "awaiting", payment, bankBalanceTiyn: 0n, isTest: false });
  const protectedBlock: MoneyBlock = { kind: "protected", amountTiyn: 102_000_00n, reservedAt: new Date(), operationRef: null, bankBalanceTiyn: 102_000_00n, isTest: false };
  const frozen: MoneyBlock = { kind: "frozen", amountTiyn: 102_000_00n, frozenAt: new Date(), bankBalanceTiyn: 102_000_00n, isTest: false };
  const completed = (refundedTiyn: bigint, settled = false): MoneyBlock => ({
    kind: "completed",
    paidToMasterTiyn: 96_000_00n,
    protectionTiyn: 2_000_00n,
    refundedTiyn,
    settled,
    completedAt: null,
    paidTiyn: 102_000_00n,
    bankBalanceTiyn: 0n,
    isTest: false,
  });
  const refundedBlock = (settled: boolean): MoneyBlock => ({ kind: "refunded", amountTiyn: 102_000_00n, settled, refundedAt: null, bankBalanceTiyn: 0n, isTest: false });

  type Row = [string, DealStatus, NextAction | null, boolean, MoneyBlock, { dispute?: boolean; consentMissing?: boolean; provider?: string }, string, DealChip["tone"]];
  /** По строке на каждое действие, которое модуль отдаёт мастеру, и на каждое состояние журнала, меняющее плашку. */
  const ROWS: Row[] = [
    ["оферта ждёт моей подписи", "CREATED", "signContract", true, awaiting("none"), {}, ms.signOffer, "warn"],
    ["я подписал, ждём покупателя", "CREATED", "waitContractSignature", false, awaiting("none"), {}, ms.waitOffer, "neutral"],
    ["оферта заключена, ждём оплату", "CREATED", "waitPayment", false, awaiting("none"), {}, ms.waitPay, "neutral"],
    ["прошлая оплата не прошла — всё равно ждём оплату", "CREATED", "waitPayment", false, awaiting("FAILED"), {}, ms.waitPay, "neutral"],
    ["оферта заключена, моего согласия для банка нет — мой шаг", "CREATED", "waitPayment", false, awaiting("none"), { consentMissing: true }, ms.bankConsent, "warn"],
    ["онлайн-оплата у банка", "CREATED", "waitPaymentConfirmation", false, awaiting("PENDING"), { provider: "FREEDOMPAY" }, ms.processing, "neutral"],
    ["перевод по реквизитам — ждём оплату покупателя (не «ваш перевод»)", "CREATED", "waitPaymentConfirmation", false, awaiting("PENDING"), { provider: "MANUAL" }, ms.waitPay, "neutral"],
    ["оплачено — начните работу", "PAID_HOLD", "startWork", true, protectedBlock, {}, ms.start, "warn"],
    ["работа идёт — сдать, когда готово", "IN_PROGRESS", "submitReady", true, protectedBlock, {}, ms.inWork, "neutral"],
    ["работа сдана, подпишите акт", "READY", "signActEcp", true, protectedBlock, {}, ms.signAct, "warn"],
    ["акт подписан мной, ждём приёмку", "READY", "waitAct", false, protectedBlock, {}, ms.waitAct, "neutral"],
    ["банк переводит оплату", "ACCEPTED", "waitPayout", false, completed(0n), {}, ms.finishing, "neutral"],
    ["завершена", "SPLIT_PAYOUT", "done", false, completed(0n, true), {}, ms.done, "accent"],
    ["отмена после оплаты, деньги возвращаются покупателю", "PAID_HOLD", "waitRefund", false, protectedBlock, {}, ms.refunding, "neutral"],
    ["спор открыт", "IN_PROGRESS", "waitDispute", false, frozen, { dispute: true }, ms.dispute, "warn"],
    ["спор решён разделом", "SPLIT_PAYOUT", "done", false, completed(5n, true), {}, ms.disputeResolved, "neutral"],
    ["отменена", "CANCELLED", "cancelled", false, awaiting("none"), {}, ms.cancelled, "neutral"],
    ["деньги возвращены покупателю", "REFUNDED", "refunded", false, refundedBlock(true), {}, ms.refunded, "neutral"],
    ["«что дальше» неизвестно: создана", "CREATED", null, false, awaiting("none"), {}, ms.offer, "neutral"],
    ["«что дальше» неизвестно: оплачено", "PAID_HOLD", null, false, protectedBlock, {}, ms.protected, "accent"],
    ["«что дальше» неизвестно: в работе", "IN_PROGRESS", null, false, protectedBlock, {}, ms.inWork, "neutral"],
    ["«что дальше» неизвестно: сдана", "READY", null, false, protectedBlock, {}, ms.handedOver, "neutral"],
    ["«что дальше» неизвестно: принята", "ACCEPTED", null, false, completed(0n), {}, ms.finishing, "neutral"],
    ["шаг покупателя (не мастера) — по статусу", "CREATED", "pay", true, awaiting("none"), {}, ms.offer, "neutral"],
  ];

  it.each(ROWS)("%s", (_name, status, action, mine, money, o, text, tone) => {
    const chip = dealChip({
      side: "EXECUTOR",
      status,
      hasOpenDispute: o.dispute ?? false,
      next: action ? { action, mine } : null,
      consentMissing: o.consentMissing ?? false,
      money,
      paymentProvider: o.provider ?? "MOCK",
    });
    expect(chip).toEqual({ text, tone });
  });

  it("один текст — один тон; у каждого текста словаря мастера есть строка таблицы", () => {
    const tones = new Map<string, string>();
    for (const [, , , , , , text, tone] of ROWS) {
      expect(tones.get(text) ?? tone).toBe(tone);
      tones.set(text, tone);
    }
    expect([...tones.keys()].sort()).toEqual(Object.values(ms).sort());
  });

  it("шаги покупателя и оператора мастеру не дают «вашего шага»: плашка по статусу", () => {
    for (const action of ["pay", "waitStart", "waitReady", "signAct", "waitMasterActSignature", "leaveReview", "resolveDispute", "none"] as const) {
      const chip = dealChip({ side: "EXECUTOR", status: "IN_PROGRESS", hasOpenDispute: false, next: { action, mine: true }, money: protectedBlock, paymentProvider: "MOCK" });
      expect(chip).toEqual({ text: ms.inWork, tone: "neutral" });
    }
  });

  it("признак покупателя «ждём согласие мастера» мастеру ничего не меняет, а согласие мастера — покупателю", () => {
    const base = { status: "CREATED" as const, hasOpenDispute: false, money: awaiting("none"), paymentProvider: "MOCK" };
    expect(dealChip({ ...base, side: "EXECUTOR", next: { action: "waitPayment", mine: false }, payWaitsMaster: true }).text).toBe(ms.waitPay);
    expect(dealChip({ ...base, side: "CLIENT", next: { action: "pay", mine: true }, consentMissing: true }).text).toBe(st.pay);
  });

  it("masterConsentMissing: только ожидание оплаты и только без своей отметки", () => {
    expect(masterConsentMissing({ action: "waitPayment" }, { mine: false })).toBe(true);
    expect(masterConsentMissing({ action: "waitPayment" }, { mine: true })).toBe(false);
    expect(masterConsentMissing({ action: "waitPayment" }, null)).toBe(false);
    expect(masterConsentMissing({ action: "signContract" }, { mine: false })).toBe(false);
    expect(masterConsentMissing(null, { mine: false })).toBe(false);
  });

  it("ход: те же пять этапов, последний — «Оплата вам»; спор — «оплата вам приостановлена»", () => {
    const view = dealStepsView("PAID_HOLD", false, null, "EXECUTOR");
    expect(view.kind === "steps" ? view.items.map((i) => i.label) : null).toEqual([...ru.app.master.deal.steps]);
    expect(ru.app.master.deal.steps.at(-1)).toBe("Оплата вам");
    expect(view.kind === "steps" ? view.caption : null).toBe(ru.app.deal.stepCaption(2, 5, "Изготовление"));
    expect(progressCaption({ kind: "steps", done: 4, total: 5 }, "EXECUTOR")).toBe(ru.app.deal.stepCaption(5, 5, "Оплата вам"));
    expect(dealStepsView("READY", true, null, "EXECUTOR")).toEqual({ kind: "stopped", label: ru.app.master.deal.stopped.dispute });
    expect(stoppedLabel("dispute", "EXECUTOR")).toBe("Открыт спор — оплата вам приостановлена");
    expect(stoppedLabel("cancelled", "EXECUTOR")).toBe(ru.app.master.deal.stopped.cancelled);
    expect(dealStepsView("READY", false, "FULL_REFUND", "EXECUTOR")).toEqual({ kind: "stopped", label: ru.app.master.deal.stepsStopped.disputeRefund });
    expect(dealStepsView("SPLIT_PAYOUT", false, "PARTIAL_SPLIT", "EXECUTOR")).toEqual({ kind: "stopped", label: ru.app.master.deal.stepsStopped.disputeSplit });
  });

  describe("строка денег мастера: без сумм покупателя", () => {
    const l = ru.app.master.deal.line;
    /** Смета мастера из модуля (`partyEstimate("EXECUTOR")`): 100 000 ₸ − гарантия 4% = 96 000 ₸. */
    const estimate = { totalTiyn: 96_000_00n };
    it.each<[string, MoneyBlock, DealMoneyLine]>([
      ["до оплаты — вы получите (смета мастера)", awaiting("none"), { amountTiyn: 96_000_00n, label: l.awaiting }],
      ["деньги в банке — вы получите, а не сумма покупателя в банке", protectedBlock, { amountTiyn: 96_000_00n, label: l.protected }],
      ["спор — без суммы", frozen, { amountTiyn: null, label: l.frozen }],
      ["банк переводит — его часть из журнала", completed(0n), { amountTiyn: 96_000_00n, label: l.payoutPending }],
      ["получено", completed(0n, true), { amountTiyn: 96_000_00n, label: l.payoutDone }],
      ["возврат покупателю — без суммы", refundedBlock(false), { amountTiyn: null, label: l.refundPending }],
      ["возвращено покупателю — без суммы", refundedBlock(true), { amountTiyn: null, label: l.refundDone }],
    ])("%s", (_name, money, line) => {
      expect(dealMoneyLine(money, estimate, "EXECUTOR")).toEqual(line);
      // Сумма покупателя (цена с защитой 2%) мастеру не показывается ни в одном состоянии.
      expect(dealMoneyLine(money, estimate, "EXECUTOR").amountTiyn).not.toBe(102_000_00n);
    });

    it("покупателю строка прежняя: к оплате и в банке — его суммы", () => {
      expect(dealMoneyLine(awaiting("none"), { totalTiyn: 102_000_00n }, "CLIENT")).toEqual({ amountTiyn: 102_000_00n, label: ru.app.deal.line.toPay });
      expect(dealMoneyLine(protectedBlock, { totalTiyn: 102_000_00n }, "CLIENT")).toEqual({ amountTiyn: 102_000_00n, label: ru.app.deal.line.inBank });
      expect(dealMoneyLine(completed(0n), { totalTiyn: 102_000_00n }, "CLIENT")).toEqual({ amountTiyn: null, label: ru.app.deal.line.payoutPending });
    });
  });
});

describe("quietChip: плашки обычного хода в списке и на главной не показываются", () => {
  it("обычный ход — без плашки; оплата в обработке, перевод и ожидание другой стороны — остаются", () => {
    expect(quietChip({ text: st.inWork, tone: "neutral" })).toBeNull();
    expect(quietChip({ text: st.protected, tone: "accent" })).toBeNull();
    expect(quietChip({ text: ru.app.master.deal.status.inWork, tone: "neutral" })).toBeNull();
    for (const text of [st.processing, st.transfer, st.waitAct, st.waitMasterBank]) {
      expect(quietChip({ text, tone: "neutral" })).toEqual({ text, tone: "neutral" });
    }
  });
});
