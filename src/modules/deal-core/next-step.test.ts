import { describe, expect, it } from "vitest";
import { nextStep, type NextStepInput } from "./next-step";

const base: NextStepInput = { status: "CREATED", viewer: "CLIENT", signed: false, contractSignedBy: [], actSignedBy: [], hold: "none", openDispute: false, exitRequested: false, canReview: false };
const step = (patch: Partial<NextStepInput>) => nextStep({ ...base, ...patch });

describe("«что дальше» — одно главное действие", () => {
  it("оферта: подписать, затем ждать вторую подпись", () => {
    expect(step({})).toEqual({ action: "signContract", mine: true });
    expect(step({ contractSignedBy: ["CLIENT"] })).toEqual({ action: "waitContractSignature", mine: false });
    expect(step({ viewer: "EXECUTOR", contractSignedBy: ["CLIENT"] })).toEqual({ action: "signContract", mine: true });
  });

  it("оферта заключена: покупатель платит, мастер ждёт; оплата в банке — ждут оба", () => {
    expect(step({ signed: true })).toEqual({ action: "pay", mine: true });
    expect(step({ signed: true, hold: "FAILED" })).toEqual({ action: "pay", mine: true });
    expect(step({ signed: true, viewer: "EXECUTOR" })).toEqual({ action: "waitPayment", mine: false });
    expect(step({ signed: true, hold: "PENDING" })).toEqual({ action: "waitPaymentConfirmation", mine: false });
  });

  it("работа: мастер начинает и сдаёт, покупатель подписывает акт", () => {
    expect(step({ status: "PAID_HOLD", viewer: "EXECUTOR" })).toEqual({ action: "startWork", mine: true });
    expect(step({ status: "PAID_HOLD" })).toEqual({ action: "waitStart", mine: false });
    expect(step({ status: "IN_PROGRESS", viewer: "EXECUTOR" })).toEqual({ action: "submitReady", mine: true });
    expect(step({ status: "IN_PROGRESS" })).toEqual({ action: "waitReady", mine: false });
    expect(step({ status: "ACCEPTED", viewer: "EXECUTOR" })).toEqual({ action: "waitPayout", mine: false });
  });

  it("акт приёмки подписывают обе стороны в любом порядке: покупатель — акт, мастер — ЭЦП", () => {
    expect(step({ status: "READY" })).toEqual({ action: "signAct", mine: true });
    expect(step({ status: "READY", viewer: "EXECUTOR" })).toEqual({ action: "signActEcp", mine: true });
    // Покупатель подписал — ждёт мастера; мастер подписал — ждёт покупателя.
    expect(step({ status: "READY", actSignedBy: ["CLIENT"] })).toEqual({ action: "waitMasterActSignature", mine: false });
    expect(step({ status: "READY", viewer: "EXECUTOR", actSignedBy: ["CLIENT"] })).toEqual({ action: "signActEcp", mine: true });
    expect(step({ status: "READY", viewer: "EXECUTOR", actSignedBy: ["EXECUTOR"] })).toEqual({ action: "waitAct", mine: false });
    expect(step({ status: "READY", actSignedBy: ["EXECUTOR"] })).toEqual({ action: "signAct", mine: true });
    expect(step({ status: "ACCEPTED", viewer: "EXECUTOR" })).toEqual({ action: "waitPayout", mine: false });
  });

  it("деньги уходят — ждём банк; спор — ждём оператора, у оператора — решить", () => {
    expect(step({ status: "PAID_HOLD", exitRequested: true, viewer: "EXECUTOR" })).toEqual({ action: "waitRefund", mine: false });
    expect(step({ status: "IN_PROGRESS", openDispute: true })).toEqual({ action: "waitDispute", mine: false });
    expect(step({ status: "IN_PROGRESS", openDispute: true, viewer: "OPERATOR" })).toEqual({ action: "resolveDispute", mine: true });
    expect(step({ status: "IN_PROGRESS", viewer: "OPERATOR" })).toEqual({ action: "none", mine: false });
  });

  it("конец: отзыв (если включён), завершена, отменена, возвращена", () => {
    expect(step({ status: "SPLIT_PAYOUT", canReview: true })).toEqual({ action: "leaveReview", mine: true });
    expect(step({ status: "SPLIT_PAYOUT", canReview: true, viewer: "EXECUTOR" })).toEqual({ action: "done", mine: false });
    expect(step({ status: "SPLIT_PAYOUT" })).toEqual({ action: "done", mine: false });
    expect(step({ status: "CANCELLED" })).toEqual({ action: "cancelled", mine: false });
    expect(step({ status: "REFUNDED" })).toEqual({ action: "refunded", mine: false });
  });
});
