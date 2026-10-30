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

export function nextStep(d: NextStepInput): NextStep {
  if (d.viewer === "OPERATOR") return { text: n.watch, action: null };
  const viewer = d.viewer;
  const pick = (items: Pending[]): NextStep => {
    const mine = items.find((i) => i.by === viewer);
    if (mine) return mine.mine;
    return { text: items[0]?.theirs ?? n.waitSubmit(d.stages[0]?.title ?? ""), action: null };
  };

  switch (d.status) {
    case "AWAITING_SIGNATURES":
      if (!d.contract || d.contract.signedBy.includes(viewer)) return { text: n.waitSignature, action: null };
      return { text: n.signContract, action: { kind: "signDocument", documentId: d.contract.id } };
    case "AWAITING_DEPOSIT":
      return viewer === "CLIENT" ? { text: n.deposit, action: { kind: "deposit", accountId: d.escrowAccountId } } : { text: n.waitDeposit, action: null };
    case "DISPUTE":
      return { text: n.dispute, action: null };
    case "CANCELLED":
      return { text: n.cancelled, action: null };
    case "TERMINATED":
      return { text: n.terminated, action: null };
    case "COMPLETED":
      return viewer === "CLIENT" && !d.hasReview ? { text: n.leaveReview, action: { kind: "review" } } : { text: n.completed, action: null };
    case "IN_PROGRESS":
      return pick(pendingInProgress(d));
  }
}

function pendingInProgress(d: NextStepInput): Pending[] {
  const items: Pending[] = [];
  const escrow = d.paymentMode !== "MANUAL";

  d.stages.forEach((s, i) => {
    const prev = d.stages[i - 1];
    const previousDone = !prev || prev.status === "ACCEPTED" || prev.status === "CLOSED";

    // Акт принятого этапа: сначала подписи
    if (s.act && s.act.status === "SIGNING") {
      for (const by of ["CLIENT", "EXECUTOR"] as const) {
        if (!s.act.signedBy.includes(by)) {
          items.push({ by, mine: { text: n.signAct(s.title), action: { kind: "signDocument", documentId: s.act.id } }, theirs: n.waitAct(s.title) });
        }
      }
    }

    // Оплата этапа, когда она к оплате
    const payable = isPayable({ dealStatus: d.status, stageStatus: s.status, paymentDue: s.paymentDue, previousDone });
    if (s.payment && payable && s.payment.status !== "CONFIRMED") {
      if (escrow) {
        items.push({ by: "CLIENT", mine: { text: n.waitRelease(s.title), action: null }, theirs: n.waitRelease(s.title) });
      } else if (s.payment.status === "DUE") {
        items.push({ by: "CLIENT", mine: { text: n.markPaid(s.title), action: { kind: "markPaid", stageId: s.id } }, theirs: n.waitMarkPaid(s.title) });
      } else {
        items.push({ by: "EXECUTOR", mine: { text: n.confirmPayment(s.title), action: { kind: "confirmPayment", stageId: s.id } }, theirs: n.waitConfirm(s.title) });
      }
      if (s.paymentDue === "ON_START") return; // этап не начнётся до оплаты
    }

    if (!previousDone) return;
    switch (s.status) {
      case "PENDING":
        items.push({ by: "EXECUTOR", mine: { text: n.start(s.title), action: { kind: "start", stageId: s.id } }, theirs: n.waitStart(s.title) });
        break;
      case "IN_PROGRESS":
      case "REWORK":
        items.push({ by: "EXECUTOR", mine: { text: n.submit(s.title), action: { kind: "submit", stageId: s.id } }, theirs: n.waitSubmit(s.title) });
        break;
      case "SUBMITTED":
        items.push({ by: "CLIENT", mine: { text: n.review(s.title), action: { kind: "accept", stageId: s.id } }, theirs: n.waitReview(s.title) });
        break;
    }
  });
  return items;
}
