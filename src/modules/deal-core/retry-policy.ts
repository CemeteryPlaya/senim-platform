import type {
  DealStatus,
  DisputeDecision,
  DisputeStatus,
  PaymentOperationKind,
  PaymentOperationStatus,
  StagePaymentStatus,
  StageStatus,
} from "@/generated/prisma/enums";

/**
 * Можно ли повторить отклонённую банком операцию (ADR-002, «Отклонённые операции»). Одно правило
 * для сервиса повтора и для экрана сделки: кнопка видна ровно тогда, когда повтор пройдёт.
 *
 * Семейство ключей — исходный ключ и его повторы `<исходный>:retry:<n>`. Повтор разрешён, если в
 * семействе нет операции в пути или выполненной и операция всё ещё должна быть выполнена:
 *  release:<stageId> — сделка в работе или в споре, этап ACCEPTED, оплата этапа DUE и по этапу нет открытого
 *    спора (решение по нему может вернуть деньги заказчику; спор без этапа — о сделке целиком);
 *  dispute:<id>:release | refund — спор решён и решение требует этой операции (сделка расторгнута);
 *  cancel:<dealId>:refund — сделка отменена; <ключ пополнения>:refund — сделка отменена или расторгнута.
 * Иначе (например, спор расторг сделку после отказа по траншу) повтор отправил бы деньги вопреки решению.
 */

const RETRY_SUFFIX = /:retry:\d+$/;

export const familyOf = (idempotencyKey: string) => idempotencyKey.replace(RETRY_SUFFIX, "");

export type RetryOp = {
  idempotencyKey: string;
  kind: PaymentOperationKind;
  status: PaymentOperationStatus;
};

export type RetryFacts = {
  dealStatus: DealStatus;
  stages: { id: string; status: StageStatus; payment: { status: StagePaymentStatus } | null }[];
  /** Последний спор сделки: после решения с расторжением нового спора быть не может. stageId — этап спора (null — вся сделка). */
  dispute: { id: string; stageId: string | null; status: DisputeStatus; decision: DisputeDecision | null; decisionAmount: number | null } | null;
};

/** Должна ли операция семейства `family` всё ещё быть выполнена. Пополнение (DEPOSIT) не повторяется: ни одна ветка его не допускает. */
export function stillDue(family: string, kind: PaymentOperationKind, facts: RetryFacts): boolean {
  const dispute = /^dispute:(.+):(release|refund)$/.exec(family);
  if (dispute) return disputeRequires(facts, dispute[1], dispute[2] === "release" ? "RELEASE" : "REFUND", kind);
  if (family.startsWith(RELEASE_PREFIX)) return kind === "RELEASE" && releaseDue(facts, family.slice(RELEASE_PREFIX.length));
  return kind === "REFUND" && refundDue(family, facts.dealStatus);
}

const RELEASE_PREFIX = "release:";

/** Транш этапа: сделка в работе или в споре, этап принят, оплата DUE, по этапу (или сделке) нет открытого спора. */
function releaseDue(facts: RetryFacts, stageId: string): boolean {
  const stage = facts.stages.find((s) => s.id === stageId);
  const dealActive = facts.dealStatus === "IN_PROGRESS" || facts.dealStatus === "DISPUTE";
  const d = facts.dispute;
  const disputed = d?.status === "OPEN" && (d.stageId === null || d.stageId === stageId);
  return dealActive && !disputed && stage?.status === "ACCEPTED" && stage.payment?.status === "DUE";
}

/** Возврат: cancel:<dealId>:refund — по отменённой сделке; <ключ пополнения>:refund — по отменённой или расторгнутой. */
function refundDue(family: string, dealStatus: DealStatus): boolean {
  if (!family.endsWith(":refund")) return false;
  if (family.startsWith("cancel:")) return dealStatus === "CANCELLED";
  return dealStatus === "CANCELLED" || dealStatus === "TERMINATED";
}

function disputeRequires(facts: RetryFacts, disputeId: string, wanted: PaymentOperationKind, kind: PaymentOperationKind): boolean {
  const d = facts.dispute;
  if (kind !== wanted || facts.dealStatus !== "TERMINATED" || !d || d.id !== disputeId || d.status !== "RESOLVED") return false;
  if (wanted === "RELEASE") return d.decision === "PARTIAL" && (d.decisionAmount ?? 0) > 0;
  return d.decision === "TERMINATE" || d.decision === "PARTIAL";
}

export type RetryVerdict = "ok" | "notFailed" | "inProgress" | "notDue";

/** Вердикт по операции `op` при операциях её семейства `family` (включая её саму). */
export function retryVerdict(op: RetryOp, family: RetryOp[], facts: RetryFacts): RetryVerdict {
  if (op.kind === "DEPOSIT" || op.status !== "FAILED") return "notFailed";
  if (family.some((o) => o.status !== "FAILED")) return "inProgress";
  return stillDue(familyOf(op.idempotencyKey), op.kind, facts) ? "ok" : "notDue";
}

/**
 * Ключи, которые экран показывает оператору для повтора: в каждом семействе — только последняя
 * операция и только при вердикте «ok». `ops` — операции сделки в порядке создания.
 */
export function retryableKeys(ops: RetryOp[], facts: RetryFacts): Set<string> {
  const families = new Map<string, RetryOp[]>();
  for (const op of ops) {
    const key = familyOf(op.idempotencyKey);
    families.set(key, [...(families.get(key) ?? []), op]);
  }
  const keys = new Set<string>();
  for (const family of families.values()) {
    const last = family[family.length - 1];
    if (retryVerdict(last, family, facts) === "ok") keys.add(last.idempotencyKey);
  }
  return keys;
}
