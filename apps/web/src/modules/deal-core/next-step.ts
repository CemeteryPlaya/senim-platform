import type { DealStatus } from "@/generated/prisma/enums";

/**
 * «Что дальше» — одно главное действие экрана сделки для того, кто смотрит (чистая функция).
 * Подписи — ru.deal.next[action]. mine: true — действие этого человека (кнопка), false — ждём другого.
 */

export type NextAction =
  | "signContract"
  | "waitContractSignature"
  | "pay"
  | "waitPayment"
  | "waitPaymentConfirmation"
  | "startWork"
  | "waitStart"
  | "submitReady"
  | "waitReady"
  | "signAct"
  | "signActEcp"
  | "waitAct"
  | "waitMasterActSignature"
  | "waitPayout"
  | "waitRefund"
  | "waitDispute"
  | "resolveDispute"
  | "leaveReview"
  | "done"
  | "cancelled"
  | "refunded"
  | "none";

export type NextStep = { action: NextAction; mine: boolean };

export type NextStepInput = {
  status: DealStatus;
  viewer: "CLIENT" | "EXECUTOR" | "OPERATOR";
  signed: boolean;
  /** Кто уже подписал действующую оферту. */
  contractSignedBy: readonly ("CLIENT" | "EXECUTOR")[];
  /** Кто уже поставил все свои подписи на действующем акте приёмки. */
  actSignedBy: readonly ("CLIENT" | "EXECUTOR")[];
  hold: "none" | "PENDING" | "SUCCEEDED" | "FAILED";
  openDispute: boolean;
  exitRequested: boolean;
  canReview: boolean;
};

const mine = (action: NextAction): NextStep => ({ action, mine: true });
const wait = (action: NextAction): NextStep => ({ action, mine: false });

function created(i: NextStepInput, party: "CLIENT" | "EXECUTOR"): NextStep {
  if (!i.signed) return i.contractSignedBy.includes(party) ? wait("waitContractSignature") : mine("signContract");
  if (i.hold === "PENDING") return wait("waitPaymentConfirmation");
  return party === "CLIENT" ? mine("pay") : wait("waitPayment");
}

/**
 * Акт приёмки (решение 2.2.4): покупатель — собственноручно и ЭЦП, мастер — ЭЦП, в любом порядке; ACCEPTED —
 * когда собраны все подписи. Своё не подписал — подписать; подписал — ждать другую сторону.
 */
function ready(i: NextStepInput, party: "CLIENT" | "EXECUTOR"): NextStep {
  const signedByMe = i.actSignedBy.includes(party);
  if (party === "CLIENT") return signedByMe ? wait("waitMasterActSignature") : mine("signAct");
  return signedByMe ? wait("waitAct") : mine("signActEcp");
}

const ACTIVE: Record<"PAID_HOLD" | "IN_PROGRESS" | "READY", (i: NextStepInput, party: "CLIENT" | "EXECUTOR") => NextStep> = {
  PAID_HOLD: (_i, party) => (party === "EXECUTOR" ? mine("startWork") : wait("waitStart")),
  IN_PROGRESS: (_i, party) => (party === "EXECUTOR" ? mine("submitReady") : wait("waitReady")),
  READY: ready,
};

const FINAL: Partial<Record<DealStatus, (i: NextStepInput) => NextStep>> = {
  CANCELLED: () => wait("cancelled"),
  REFUNDED: () => wait("refunded"),
  SPLIT_PAYOUT: (i) => (i.viewer === "CLIENT" && i.canReview ? mine("leaveReview") : wait("done")),
};

export function nextStep(i: NextStepInput): NextStep {
  const final = FINAL[i.status];
  if (final) return final(i);
  if (i.openDispute) return i.viewer === "OPERATOR" ? mine("resolveDispute") : wait("waitDispute");
  if (i.viewer === "OPERATOR") return wait("none");
  if (i.status === "CREATED") return created(i, i.viewer);
  if (!isActive(i.status)) return wait("waitPayout"); // ACCEPTED: банк проводит выплату
  // Деньги уже уходят (отмена после оплаты, решение спора): ждём банк.
  return i.exitRequested ? wait("waitRefund") : ACTIVE[i.status](i, i.viewer);
}

function isActive(status: DealStatus): status is keyof typeof ACTIVE {
  return status in ACTIVE;
}
