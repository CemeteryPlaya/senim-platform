import { describe, expect, it } from "vitest";
import { ru } from "@/i18n/ru";
import { nextStep, type NextStepInput } from "./next-step";

const n = ru.deal.next;

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

describe("что дальше: точный текст и действие", () => {
  const none = (text: string) => ({ text, action: null });

  it("оператор, спор, отмена и расторжение — подсказка без действия", () => {
    expect(nextStep(base({ viewer: "OPERATOR" }))).toEqual(none(n.watch));
    expect(nextStep(base({ status: "DISPUTE" }))).toEqual(none(n.dispute));
    expect(nextStep(base({ status: "CANCELLED", viewer: "EXECUTOR" }))).toEqual(none(n.cancelled));
    expect(nextStep(base({ status: "TERMINATED" }))).toEqual(none(n.terminated));
  });

  it("договор ещё не выпущен или уже подписан мной — ждём; иначе подписать", () => {
    expect(nextStep(base({ status: "AWAITING_SIGNATURES", contract: null }))).toEqual(none(n.waitSignature));
    const contract = { id: "c1", status: "SIGNING" as const, signedBy: [] };
    expect(nextStep(base({ status: "AWAITING_SIGNATURES", contract }))).toEqual({ text: n.signContract, action: { kind: "signDocument", documentId: "c1" } });
  });

  it("пополнение: заказчик пополняет, исполнитель ждёт", () => {
    const awaiting = base({ status: "AWAITING_DEPOSIT", paymentMode: "BANK", escrowAccountId: "acc1" });
    expect(nextStep(awaiting)).toEqual({ text: n.deposit, action: { kind: "deposit", accountId: "acc1" } });
    expect(nextStep({ ...awaiting, viewer: "EXECUTOR" })).toEqual(none(n.waitDeposit));
  });

  it("завершена: отзыв или благодарность", () => {
    expect(nextStep(base({ status: "COMPLETED" }))).toEqual({ text: n.leaveReview, action: { kind: "review" } });
    expect(nextStep(base({ status: "COMPLETED", hasReview: true }))).toEqual(none(n.completed));
    expect(nextStep(base({ status: "COMPLETED", viewer: "EXECUTOR" }))).toEqual(none(n.completed));
  });

  it("аванс в manual: точные тексты сторон до и после отметки", () => {
    expect(nextStep(base())).toEqual({ text: n.markPaid("Этап 1"), action: { kind: "markPaid", stageId: "s1" } });
    expect(nextStep(base({ viewer: "EXECUTOR" }))).toEqual(none(n.waitMarkPaid("Этап 1")));
    const marked = [stage({ order: 1, paymentDue: "ON_START", payment: { status: "MARKED_PAID" } })];
    expect(nextStep(base({ viewer: "EXECUTOR", stages: marked }))).toEqual({ text: n.confirmPayment("Этап 1"), action: { kind: "confirmPayment", stageId: "s1" } });
    expect(nextStep(base({ stages: marked }))).toEqual(none(n.waitConfirm("Этап 1")));
  });

  it("аванс в эскроу: обе стороны видят, что банк раскрывает оплату", () => {
    expect(nextStep(base({ paymentMode: "BANK" }))).toEqual(none(n.waitRelease("Этап 1")));
    expect(nextStep(base({ paymentMode: "BANK", viewer: "EXECUTOR" }))).toEqual(none(n.waitRelease("Этап 1")));
  });

  it("неоплаченный аванс не даёт начать этап", () => {
    expect(nextStep(base({ viewer: "EXECUTOR" })).action).toBeNull();
  });

  it("оплата после приёмки не к оплате, пока этап не принят", () => {
    const submitted = [stage({ order: 1, status: "SUBMITTED", payment: { status: "DUE" } })];
    expect(nextStep(base({ stages: submitted }))).toEqual({ text: n.review("Этап 1"), action: { kind: "accept", stageId: "s1" } });
    expect(nextStep(base({ viewer: "EXECUTOR", stages: submitted }))).toEqual(none(n.waitReview("Этап 1")));
  });

  it("подтверждённая оплата больше не предлагается", () => {
    const closed = [stage({ order: 1, status: "ACCEPTED", payment: { status: "CONFIRMED" } }), stage({ order: 2 })];
    expect(nextStep(base({ viewer: "EXECUTOR", stages: closed }))).toEqual({ text: n.start("Этап 2"), action: { kind: "start", stageId: "s2" } });
    expect(nextStep(base({ stages: closed }))).toEqual(none(n.waitStart("Этап 2")));
  });

  it("следующий этап — только после принятого или закрытого предыдущего", () => {
    const afterClosed = [stage({ order: 1, status: "CLOSED" }), stage({ order: 2 })];
    expect(nextStep(base({ viewer: "EXECUTOR", stages: afterClosed })).action).toEqual({ kind: "start", stageId: "s2" });
    const afterSubmitted = [stage({ order: 1, status: "SUBMITTED" }), stage({ order: 2 })];
    expect(nextStep(base({ viewer: "EXECUTOR", stages: afterSubmitted }))).toEqual(none(n.waitReview("Этап 1")));
    const afterRework = [stage({ order: 1, status: "REWORK" }), stage({ order: 2 })];
    expect(nextStep(base({ viewer: "EXECUTOR", stages: afterRework }))).toEqual({ text: n.submit("Этап 1"), action: { kind: "submit", stageId: "s1" } });
    expect(nextStep(base({ stages: afterRework }))).toEqual(none(n.waitSubmit("Этап 1")));
  });

  it("акт: подписывает тот, кто ещё не подписал; подписанный акт ничего не ждёт", () => {
    const act = (signedBy: ("CLIENT" | "EXECUTOR")[], status: "SIGNING" | "SIGNED" = "SIGNING") => [
      stage({ order: 1, status: "ACCEPTED", act: { id: "a1", status, signedBy } }),
    ];
    expect(nextStep(base({ viewer: "EXECUTOR", stages: act(["CLIENT"]) }))).toEqual({ text: n.signAct("Этап 1"), action: { kind: "signDocument", documentId: "a1" } });
    expect(nextStep(base({ stages: act(["CLIENT"]) }))).toEqual(none(n.waitAct("Этап 1")));
    expect(nextStep(base({ stages: act(["CLIENT", "EXECUTOR"], "SIGNED") }))).toEqual(none(n.waitSubmit("Этап 1")));
  });

  it("ждать нечего (все этапы закрыты) — нейтральная подсказка по первому этапу; без этапов — пустое название", () => {
    expect(nextStep(base({ stages: [stage({ order: 1, status: "CLOSED" })] }))).toEqual(none(n.waitSubmit("Этап 1")));
    expect(nextStep(base({ stages: [] }))).toEqual(none(n.waitSubmit("")));
  });

  it("эскроу: ожидание раскрытия транша — шаг заказчика, он идёт раньше приёмки следующего этапа", () => {
    const stages = [stage({ order: 1, status: "ACCEPTED", payment: { status: "DUE" } }), stage({ order: 2, status: "SUBMITTED" })];
    expect(nextStep(base({ paymentMode: "BANK", stages }))).toEqual(none(n.waitRelease("Этап 1")));
    expect(nextStep(base({ paymentMode: "BANK", viewer: "EXECUTOR", stages }))).toEqual(none(n.waitRelease("Этап 1")));
  });
});
