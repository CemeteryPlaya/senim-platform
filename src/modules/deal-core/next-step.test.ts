import { describe, expect, it } from "vitest";
import { nextStep, type NextStepInput } from "./next-step";

type Stage = NextStepInput["stages"][number];
const stage = (s: Partial<Stage> & { order: number }): Stage => ({
  id: `s${s.order}`,
  title: `Этап ${s.order}`,
  status: "PENDING",
  paymentDue: "ON_ACCEPTANCE",
  payment: null,
  act: null,
  ...s,
});

const base = (over: Partial<NextStepInput> = {}): NextStepInput => ({
  status: "IN_PROGRESS",
  paymentMode: "MANUAL",
  viewer: "CLIENT",
  contract: { id: "c1", status: "SIGNED", signedBy: ["CLIENT", "EXECUTOR"] },
  hasReview: false,
  escrowAccountId: null,
  stages: [
    stage({ order: 1, paymentDue: "ON_START", payment: { status: "DUE" } }),
    stage({ order: 2 }),
  ],
  ...over,
});

describe("что дальше: одно главное действие для того, кто смотрит", () => {
  it("договор: подписать, если ещё не подписал; иначе ждать вторую сторону", () => {
    const awaiting = { status: "AWAITING_SIGNATURES" as const, contract: { id: "c1", status: "SIGNING" as const, signedBy: ["EXECUTOR" as const] } };
    expect(nextStep(base({ ...awaiting, viewer: "CLIENT" }))).toMatchObject({ action: { kind: "signDocument", documentId: "c1" } });
    expect(nextStep(base({ ...awaiting, viewer: "EXECUTOR" }))).toMatchObject({ action: null, text: expect.stringMatching(/второй стороны/) });
  });

  it("аванс в manual: заказчик платит, исполнитель ждёт; после отметки — исполнитель подтверждает", () => {
    expect(nextStep(base())).toMatchObject({ action: { kind: "markPaid", stageId: "s1" } });
    expect(nextStep(base({ viewer: "EXECUTOR" }))).toMatchObject({ action: null });
    const marked = base({ viewer: "EXECUTOR", stages: [stage({ order: 1, paymentDue: "ON_START", payment: { status: "MARKED_PAID" } })] });
    expect(nextStep(marked)).toMatchObject({ action: { kind: "confirmPayment", stageId: "s1" } });
  });

  it("в эскроу заказчик ничего не отмечает: оплату раскрывает банк", () => {
    expect(nextStep(base({ paymentMode: "ESCROW_SIMULATOR" }))).toMatchObject({ action: null, text: expect.stringMatching(/Банк/) });
  });

  it("этап: исполнитель начинает и сдаёт, заказчик принимает", () => {
    const paid = [stage({ order: 1, paymentDue: "ON_START", payment: { status: "CONFIRMED" } })];
    expect(nextStep(base({ viewer: "EXECUTOR", stages: paid }))).toMatchObject({ action: { kind: "start" } });
    const working = [stage({ order: 1, status: "IN_PROGRESS" })];
    expect(nextStep(base({ viewer: "EXECUTOR", stages: working }))).toMatchObject({ action: { kind: "submit" } });
    const submitted = [stage({ order: 1, status: "SUBMITTED" })];
    expect(nextStep(base({ stages: submitted }))).toMatchObject({ action: { kind: "accept" } });
    expect(nextStep(base({ viewer: "EXECUTOR", stages: submitted }))).toMatchObject({ action: null });
  });

  it("принятый этап: сначала моя подпись акта, потом оплата после приёмки", () => {
    const accepted = [stage({ order: 1, status: "ACCEPTED", payment: { status: "DUE" }, act: { id: "a1", status: "SIGNING", signedBy: [] } })];
    expect(nextStep(base({ stages: accepted }))).toMatchObject({ action: { kind: "signDocument", documentId: "a1" } });
    const signed = [stage({ order: 1, status: "ACCEPTED", payment: { status: "DUE" }, act: { id: "a1", status: "SIGNING", signedBy: ["CLIENT"] } })];
    expect(nextStep(base({ stages: signed }))).toMatchObject({ action: { kind: "markPaid", stageId: "s1" } });
  });

  it("пополнение счёта в эскроу — главное действие заказчика", () => {
    const r = nextStep(base({ status: "AWAITING_DEPOSIT", paymentMode: "ESCROW_SIMULATOR", escrowAccountId: "acc1" }));
    expect(r).toMatchObject({ action: { kind: "deposit", accountId: "acc1" } });
  });

  it("завершённая сделка: заказчик оставляет отзыв один раз", () => {
    expect(nextStep(base({ status: "COMPLETED" }))).toMatchObject({ action: { kind: "review" } });
    expect(nextStep(base({ status: "COMPLETED", hasReview: true }))).toMatchObject({ action: null });
    expect(nextStep(base({ status: "COMPLETED", viewer: "EXECUTOR" }))).toMatchObject({ action: null });
  });

  it("оператор только наблюдает", () => {
    expect(nextStep(base({ viewer: "OPERATOR" }))).toMatchObject({ action: null });
  });
});
