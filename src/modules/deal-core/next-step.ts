import type { DealStatus, DocumentStatus, PaymentDue, PaymentMode, StagePaymentStatus, StageStatus } from "@/generated/prisma/enums";
import { ru } from "@/i18n/ru";
import { isPayable } from "./transitions";

/**
 * «Что дальше» на экране сделки: одна подсказка и не больше одного главного действия
 * для того, кто смотрит. Чистая функция от состояния сделки.
 */

type Party = "CLIENT" | "EXECUTOR";
type Doc = { id: string; status: DocumentStatus; signedBy: Party[] };

export type NextStepInput = {
  status: DealStatus;
  paymentMode: PaymentMode;
  viewer: Party | "OPERATOR";
  contract: Doc | null;
  hasReview: boolean;
  escrowAccountId: string | null;
  stages: {
    id: string;
    order: number;
    title: string;
    status: StageStatus;
    paymentDue: PaymentDue;
    payment: { status: StagePaymentStatus } | null;
    act: Doc | null;
  }[];
};

export type NextAction =
  | { kind: "signDocument"; documentId: string }
  | { kind: "deposit"; accountId: string | null }
  | { kind: "markPaid" | "confirmPayment" | "start" | "submit" | "accept"; stageId: string }
  | { kind: "review" };

export type NextStep = { text: string; action: NextAction | null };

const n = ru.deal.next;

/** Шаг, ожидающий одну из сторон. */
type Pending = { by: Party; mine: NextStep; theirs: string };
type StageInput = NextStepInput["stages"][number];

/** Сделка остановлена: подсказка без действия. */
const STOPPED = { DISPUTE: n.dispute, CANCELLED: n.cancelled, TERMINATED: n.terminated } as const;

export function nextStep(d: NextStepInput): NextStep {
  if (d.viewer === "OPERATOR") return { text: n.watch, action: null };
  switch (d.status) {
    case "AWAITING_SIGNATURES":
      return contractStep(d.contract, d.viewer);
    case "AWAITING_DEPOSIT":
      return depositStep(d.viewer, d.escrowAccountId);
    case "COMPLETED":
      return completedStep(d.viewer, d.hasReview);
    case "IN_PROGRESS":
      return pick(d.viewer, pendingInProgress(d), d.stages[0]?.title ?? "");
    default:
      return { text: STOPPED[d.status], action: null };
  }
}

function contractStep(contract: Doc | null, viewer: Party): NextStep {
  if (!contract || contract.signedBy.includes(viewer)) return { text: n.waitSignature, action: null };
  return { text: n.signContract, action: { kind: "signDocument", documentId: contract.id } };
}

function depositStep(viewer: Party, accountId: string | null): NextStep {
  return viewer === "CLIENT" ? { text: n.deposit, action: { kind: "deposit", accountId } } : { text: n.waitDeposit, action: null };
}

function completedStep(viewer: Party, hasReview: boolean): NextStep {
  return viewer === "CLIENT" && !hasReview ? { text: n.leaveReview, action: { kind: "review" } } : { text: n.completed, action: null };
}

/** Мой первый шаг; если моих нет — чего ждём от другой стороны. */
function pick(viewer: Party, items: Pending[], firstStageTitle: string): NextStep {
  const mine = items.find((i) => i.by === viewer);
  if (mine) return mine.mine;
  return { text: items[0]?.theirs ?? n.waitSubmit(firstStageTitle), action: null };
}

function pendingInProgress(d: NextStepInput): Pending[] {
  const escrow = d.paymentMode !== "MANUAL";
  return d.stages.flatMap((s, i) => stageItems(d.status, s, previousDone(d.stages[i - 1]), escrow));
}

const previousDone = (prev: StageInput | undefined) => !prev || prev.status === "ACCEPTED" || prev.status === "CLOSED";

function stageItems(dealStatus: DealStatus, s: StageInput, prevDone: boolean, escrow: boolean): Pending[] {
  const items = actItems(s);
  const payable = isPayable({ dealStatus, stageStatus: s.status, paymentDue: s.paymentDue, previousDone: prevDone });
  if (s.payment && payable && s.payment.status !== "CONFIRMED") {
    // Аванс: этап не начнётся до оплаты. Оплата после приёмки: этап уже принят, работы по нему нет.
    items.push(paymentItem(s.id, s.title, s.payment.status, escrow));
    return items;
  }
  const work = prevDone ? workItem(s) : null;
  return work ? [...items, work] : items;
}

/** Акт принятого этапа: сначала подписи. */
function actItems(s: StageInput): Pending[] {
  const act = s.act;
  if (act?.status !== "SIGNING") return [];
  return (["CLIENT", "EXECUTOR"] as const)
    .filter((by) => !act.signedBy.includes(by))
    .map((by) => ({ by, mine: { text: n.signAct(s.title), action: { kind: "signDocument", documentId: act.id } }, theirs: n.waitAct(s.title) }));
}

/** Оплата этапа, когда она к оплате: в эскроу раскрывает банк, в manual — отметка и подтверждение. */
function paymentItem(stageId: string, title: string, status: StagePaymentStatus, escrow: boolean): Pending {
  if (escrow) return { by: "CLIENT", mine: { text: n.waitRelease(title), action: null }, theirs: n.waitRelease(title) };
  if (status === "DUE") return { by: "CLIENT", mine: { text: n.markPaid(title), action: { kind: "markPaid", stageId } }, theirs: n.waitMarkPaid(title) };
  return { by: "EXECUTOR", mine: { text: n.confirmPayment(title), action: { kind: "confirmPayment", stageId } }, theirs: n.waitConfirm(title) };
}

/** Работа над этапом, когда предыдущий принят. */
function workItem(s: StageInput): Pending | null {
  switch (s.status) {
    case "PENDING":
      return { by: "EXECUTOR", mine: { text: n.start(s.title), action: { kind: "start", stageId: s.id } }, theirs: n.waitStart(s.title) };
    case "IN_PROGRESS":
    case "REWORK":
      return { by: "EXECUTOR", mine: { text: n.submit(s.title), action: { kind: "submit", stageId: s.id } }, theirs: n.waitSubmit(s.title) };
    case "SUBMITTED":
      return { by: "CLIENT", mine: { text: n.review(s.title), action: { kind: "accept", stageId: s.id } }, theirs: n.waitReview(s.title) };
    default:
      return null;
  }
}
