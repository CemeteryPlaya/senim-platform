import { describe, expect, it } from "vitest";
import { DealStatus, StagePaymentStatus, StageStatus } from "@/generated/prisma/enums";
import {
  DEAL_TRANSITIONS,
  PAYMENT_TRANSITIONS,
  STAGE_TRANSITIONS,
  resolveTransition,
  type DealContext,
  type PaymentContext,
  type StageContext,
} from "./transitions";

// Контекст, в котором все условия выполнены: проверяем только «откуда» и «кто».
const okDeal: DealContext = { mode: "MANUAL", fullyFunded: true, allStagesClosed: true };
const okStage = (dealStatus: StageContext["dealStatus"]): StageContext => ({
  dealStatus,
  previousDone: true,
  paymentDue: "ON_ACCEPTANCE",
  hasPayment: true,
  paymentStatus: "CONFIRMED",
  actSigned: true,
  autoAcceptDue: true,
});
const okPayment = (mode: PaymentContext["mode"]): PaymentContext => ({
  mode,
  dealStatus: "IN_PROGRESS",
  stageStatus: "ACCEPTED",
  paymentDue: "ON_ACCEPTANCE",
  previousDone: true,
});

describe("таблица переходов сделки: каждый статус × каждое событие", () => {
  const events = [...new Set(DEAL_TRANSITIONS.map((t) => t.event))];
  for (const event of events) {
    const rows = DEAL_TRANSITIONS.filter((t) => t.event === event);
    for (const from of Object.values(DealStatus)) {
      const row = rows.find((r) => r.from.includes(from));
      const who = row?.who[0] ?? rows[0].who[0];
      const ctx = { ...okDeal, mode: event === "contractSigned" && row?.to === "AWAITING_DEPOSIT" ? "ESCROW_SIMULATOR" : "MANUAL" } as const;
      it(`${event} из ${from}: ${row ? `→ ${row.to}` : "запрещён"}`, () => {
        const result = resolveTransition(DEAL_TRANSITIONS, { event, from, who, ctx });
        if (row) expect(result).toEqual({ ok: true, to: row.to });
        else expect(result).toEqual({ ok: false, reason: "notAllowedNow" });
      });
    }
  }

  it("договор подписан: manual сразу в работу, эскроу — ждём пополнения", () => {
    const signed = (mode: DealContext["mode"]) =>
      resolveTransition(DEAL_TRANSITIONS, { event: "contractSigned", from: "AWAITING_SIGNATURES", who: "SYSTEM", ctx: { ...okDeal, mode } });
    expect(signed("MANUAL")).toEqual({ ok: true, to: "IN_PROGRESS" });
    expect(signed("ESCROW_SIMULATOR")).toEqual({ ok: true, to: "AWAITING_DEPOSIT" });
    expect(signed("BANK")).toEqual({ ok: true, to: "AWAITING_DEPOSIT" });
  });

  it("пополнение не на всю сумму не запускает работы", () => {
    const r = resolveTransition(DEAL_TRANSITIONS, {
      event: "depositReceived",
      from: "AWAITING_DEPOSIT",
      who: "SYSTEM",
      ctx: { ...okDeal, mode: "ESCROW_SIMULATOR", fullyFunded: false },
    });
    expect(r).toEqual({ ok: false, reason: "notFullyFunded" });
  });

  it("сделка завершается, только когда все этапы закрыты", () => {
    const r = resolveTransition(DEAL_TRANSITIONS, {
      event: "complete",
      from: "IN_PROGRESS",
      who: "SYSTEM",
      ctx: { ...okDeal, allStagesClosed: false },
    });
    expect(r).toEqual({ ok: false, reason: "stagesNotClosed" });
  });

  it("отменить сделку может сторона, но не оператор и не система", () => {
    const cancel = (who: "CLIENT" | "EXECUTOR" | "OPERATOR" | "SYSTEM") =>
      resolveTransition(DEAL_TRANSITIONS, { event: "cancel", from: "AWAITING_SIGNATURES", who, ctx: okDeal });
    expect(cancel("CLIENT").ok).toBe(true);
    expect(cancel("EXECUTOR").ok).toBe(true);
    expect(cancel("OPERATOR")).toEqual({ ok: false, reason: "notYourAction" });
    expect(cancel("SYSTEM")).toEqual({ ok: false, reason: "notYourAction" });
  });

  it("спор решает только оператор", () => {
    const r = resolveTransition(DEAL_TRANSITIONS, { event: "resolveContinue", from: "DISPUTE", who: "CLIENT", ctx: okDeal });
    expect(r).toEqual({ ok: false, reason: "notYourAction" });
  });
});

describe("таблица переходов этапа: каждый статус × каждое событие", () => {
  const events = [...new Set(STAGE_TRANSITIONS.map((t) => t.event))];
  for (const event of events) {
    const row = STAGE_TRANSITIONS.find((t) => t.event === event)!;
    const dealStatus = event.startsWith("dispute") ? "DISPUTE" : "IN_PROGRESS";
    for (const from of Object.values(StageStatus)) {
      const allowed = row.from.includes(from);
      it(`${event} из ${from}: ${allowed ? `→ ${row.to}` : "запрещён"}`, () => {
        const result = resolveTransition(STAGE_TRANSITIONS, { event, from, who: row.who[0], ctx: okStage(dealStatus) });
        expect(result).toEqual(allowed ? { ok: true, to: row.to } : { ok: false, reason: "notAllowedNow" });
      });
    }
  }

  const start = (ctx: Partial<StageContext>) =>
    resolveTransition(STAGE_TRANSITIONS, { event: "start", from: "PENDING", who: "EXECUTOR", ctx: { ...okStage("IN_PROGRESS"), ...ctx } });

  it("этап не начинается, пока предыдущий не принят", () => {
    expect(start({ previousDone: false })).toEqual({ ok: false, reason: "previousStageOpen" });
  });

  it("этап с авансом не начинается, пока оплата не подтверждена", () => {
    expect(start({ paymentDue: "ON_START", paymentStatus: "MARKED_PAID" })).toEqual({ ok: false, reason: "advanceNotConfirmed" });
    expect(start({ paymentDue: "ON_START", paymentStatus: "CONFIRMED" })).toEqual({ ok: true, to: "IN_PROGRESS" });
    expect(start({ paymentDue: "ON_START", hasPayment: false, paymentStatus: null })).toEqual({ ok: true, to: "IN_PROGRESS" });
  });

  it("во время спора стороны не двигают этапы", () => {
    expect(start({ dealStatus: "DISPUTE" })).toEqual({ ok: false, reason: "dealNotActive" });
    const accept = resolveTransition(STAGE_TRANSITIONS, {
      event: "accept",
      from: "SUBMITTED",
      who: "CLIENT",
      ctx: okStage("DISPUTE"),
    });
    expect(accept).toEqual({ ok: false, reason: "dealNotActive" });
  });

  it("автоприёмка — только когда срок вышел", () => {
    const r = resolveTransition(STAGE_TRANSITIONS, {
      event: "autoAccept",
      from: "SUBMITTED",
      who: "SYSTEM",
      ctx: { ...okStage("IN_PROGRESS"), autoAcceptDue: false },
    });
    expect(r).toEqual({ ok: false, reason: "autoAcceptNotDue" });
  });

  it("этап закрывается, только когда акт подписан и оплата подтверждена (или суммы нет)", () => {
    const close = (ctx: Partial<StageContext>) =>
      resolveTransition(STAGE_TRANSITIONS, { event: "close", from: "ACCEPTED", who: "SYSTEM", ctx: { ...okStage("IN_PROGRESS"), ...ctx } });
    expect(close({ actSigned: false })).toEqual({ ok: false, reason: "actNotSigned" });
    expect(close({ paymentStatus: "MARKED_PAID" })).toEqual({ ok: false, reason: "paymentNotConfirmed" });
    expect(close({ hasPayment: false, paymentStatus: null })).toEqual({ ok: true, to: "CLOSED" });
  });

  it("принимает этап заказчик, сдаёт — исполнитель", () => {
    const accept = resolveTransition(STAGE_TRANSITIONS, { event: "accept", from: "SUBMITTED", who: "EXECUTOR", ctx: okStage("IN_PROGRESS") });
    const submit = resolveTransition(STAGE_TRANSITIONS, { event: "submit", from: "IN_PROGRESS", who: "CLIENT", ctx: okStage("IN_PROGRESS") });
    expect(accept).toEqual({ ok: false, reason: "notYourAction" });
    expect(submit).toEqual({ ok: false, reason: "notYourAction" });
  });
});

describe("таблица переходов оплаты этапа: каждый статус × каждое событие", () => {
  const events = [...new Set(PAYMENT_TRANSITIONS.map((t) => t.event))];
  for (const event of events) {
    const row = PAYMENT_TRANSITIONS.find((t) => t.event === event)!;
    const mode = event === "release" ? "ESCROW_SIMULATOR" : "MANUAL";
    for (const from of Object.values(StagePaymentStatus)) {
      const allowed = row.from.includes(from);
      it(`${event} из ${from}: ${allowed ? `→ ${row.to}` : "запрещён"}`, () => {
        const result = resolveTransition(PAYMENT_TRANSITIONS, { event, from, who: row.who[0], ctx: okPayment(mode) });
        expect(result).toEqual(allowed ? { ok: true, to: row.to } : { ok: false, reason: "notAllowedNow" });
      });
    }
  }

  const mark = (ctx: Partial<PaymentContext>) =>
    resolveTransition(PAYMENT_TRANSITIONS, { event: "markPaid", from: "DUE", who: "CLIENT", ctx: { ...okPayment("MANUAL"), ...ctx } });

  it("в эскроу отметок сторон нет — деньги раскрывает банк", () => {
    expect(mark({ mode: "ESCROW_SIMULATOR" })).toEqual({ ok: false, reason: "escrowNoMarks" });
    const release = resolveTransition(PAYMENT_TRANSITIONS, { event: "release", from: "DUE", who: "SYSTEM", ctx: okPayment("MANUAL") });
    expect(release).toEqual({ ok: false, reason: "manualNoRelease" });
  });

  it("оплата после приёмки доступна только после приёмки этапа", () => {
    expect(mark({ stageStatus: "SUBMITTED" })).toEqual({ ok: false, reason: "notPayableYet" });
    expect(mark({ stageStatus: "ACCEPTED" })).toEqual({ ok: true, to: "MARKED_PAID" });
  });

  it("аванс доступен, когда предыдущий этап принят", () => {
    expect(mark({ paymentDue: "ON_START", stageStatus: "PENDING", previousDone: false })).toEqual({ ok: false, reason: "notPayableYet" });
    expect(mark({ paymentDue: "ON_START", stageStatus: "PENDING", previousDone: true })).toEqual({ ok: true, to: "MARKED_PAID" });
  });

  it("подтверждает получение исполнитель, а не заказчик", () => {
    const r = resolveTransition(PAYMENT_TRANSITIONS, { event: "confirm", from: "MARKED_PAID", who: "CLIENT", ctx: okPayment("MANUAL") });
    expect(r).toEqual({ ok: false, reason: "notYourAction" });
  });
});
