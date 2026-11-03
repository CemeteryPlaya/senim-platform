import type { MoneyTransactionStatus, MoneyTransactionType } from "@/generated/prisma/enums";
import { computeDealMoney } from "./money";

/**
 * Проекции журнала денег (ТЗ п. 4.1, 4.4; ADR-009 раздел 4) — чистые функции. Блок денег, история денег,
 * условия переходов сделки и отчёты строятся только отсюда: статус сделки здесь не читается.
 * Деньги первичны, статус вторичен.
 */

export type LedgerEntry = {
  id: string;
  seq: bigint;
  type: MoneyTransactionType;
  status: MoneyTransactionStatus;
  amountTiyn: bigint;
  isTest: boolean;
  parentId: string | null;
  disputeId: string | null;
  externalRef: string | null;
  basisDocumentId: string | null;
  createdAt: Date;
  settledAt: Date | null;
  /** Доля мастера из цены по решению спора (PARTIAL_SPLIT) — из связанного спора; иначе null. */
  disputeShareTiyn: bigint | null;
};

/** Что известно о деньгах сделки — для условий переходов deal-core и для блока денег. */
export type MoneyFacts = {
  /** Последняя попытка оплаты: none — не начиналась. */
  hold: "none" | "PENDING" | "SUCCEEDED" | "FAILED";
  /** Последняя успешная оплата — когда и под каким номером зарезервировано. */
  heldEntry: LedgerEntry | null;
  /** Заморозка по спору, ещё не снятая. */
  frozenEntry: LedgerEntry | null;
  /** Распоряжение о раскрытии (выплата мастеру и доход платформы), если запрошено и не отклонено. */
  releaseEntry: LedgerEntry | null;
  /** Возврат покупателю, если запрошен и не отклонён. */
  refundEntry: LedgerEntry | null;
  /**
   * Деньги начали уходить из банка (выплата или возврат запрошены, в любом статусе): дальше сделка
   * может только завершиться — начать работу, сдать, открыть спор или отменить уже нельзя.
   * Отказ банка решение не отменяет: оператор повторяет операцию (retryCheck), сделка ждёт.
   */
  exitRequested: boolean;
  /** Выплата завершена: раскрытие и все его части подтверждены, а возврат остатка (если есть) — тоже. */
  payoutSettled: boolean;
  /** Возврат подтверждён, а выплаты не было: деньги целиком вернулись покупателю. */
  refundSettled: boolean;
  paidToMasterTiyn: bigint;
  platformTiyn: bigint;
  refundedTiyn: bigint;
  /** Остаток в банке = HOLD − SPLIT_MASTER − SPLIT_PLATFORM − REFUND по подтверждённым. */
  bankBalanceTiyn: bigint;
  isTest: boolean;
};

const sum = (entries: LedgerEntry[], type: MoneyTransactionType) =>
  entries.filter((e) => e.type === type && e.status === "SUCCEEDED").reduce((acc, e) => acc + e.amountTiyn, 0n);

const lastOf = <T extends Pick<LedgerEntry, "type">>(entries: readonly T[], type: MoneyTransactionType) => entries.filter((e) => e.type === type).at(-1) ?? null;

/** Последняя операция типа, если она не отклонена банком: отклонённая не считается запрошенной. */
const liveOf = (entries: LedgerEntry[], type: MoneyTransactionType) => {
  const last = lastOf(entries, type);
  return last && last.status !== "FAILED" ? last : null;
};

/** FREEZE и UNFREEZE записываются сразу выполненными: заморозка открыта, пока нет UNFREEZE того же спора. */
function openFreeze(entries: LedgerEntry[]): LedgerEntry | null {
  const unfrozen = new Set(entries.filter((e) => e.type === "UNFREEZE").map((e) => e.disputeId));
  return entries.filter((e) => e.type === "FREEZE" && !unfrozen.has(e.disputeId)).at(-1) ?? null;
}

const bySeq = <T extends Pick<LedgerEntry, "seq">>(entries: readonly T[]) => [...entries].sort((a, b) => (a.seq < b.seq ? -1 : 1));

/** Части раскрытия — последняя попытка каждой (повтор после отказа банка — та же часть с новым ключом). */
export function partsOf<T extends Pick<LedgerEntry, "type" | "parentId">>(entries: readonly T[], release: { id: string }): T[] {
  return (["SPLIT_MASTER", "SPLIT_PLATFORM"] as const).flatMap((type) => entries.filter((e) => e.parentId === release.id && e.type === type).slice(-1));
}

function payoutDone(entries: LedgerEntry[], release: LedgerEntry | null, refund: LedgerEntry | null): boolean {
  if (release?.status !== "SUCCEEDED") return false;
  const parts = partsOf(entries, release);
  const partsDone = parts.some((e) => e.type === "SPLIT_MASTER") && parts.every((e) => e.status === "SUCCEEDED");
  return partsDone && (refund === null || refund.status === "SUCCEEDED");
}

/** Записи — в любом порядке: факты считаются по порядку журнала (seq). */
export function moneyFacts(entries: readonly LedgerEntry[]): MoneyFacts {
  return factsOf(bySeq(entries));
}

function factsOf(list: LedgerEntry[]): MoneyFacts {
  const lastHold = lastOf(list, "HOLD");
  const releaseEntry = liveOf(list, "RELEASE");
  const refundEntry = liveOf(list, "REFUND");
  const paidToMasterTiyn = sum(list, "SPLIT_MASTER");
  const platformTiyn = sum(list, "SPLIT_PLATFORM");
  const refundedTiyn = sum(list, "REFUND");
  return {
    hold: lastHold?.status ?? "none",
    heldEntry: list.filter((e) => e.type === "HOLD" && e.status === "SUCCEEDED").at(-1) ?? null,
    frozenEntry: openFreeze(list),
    releaseEntry,
    refundEntry,
    exitRequested: list.some((e) => e.type === "RELEASE" || e.type === "REFUND"),
    payoutSettled: payoutDone(list, releaseEntry, refundEntry),
    // Раскрытия не было ни в одной попытке: отклонённое раскрытие при разделе по спору ждёт повтора, это не возврат целиком.
    refundSettled: lastOf(list, "RELEASE") === null && refundEntry?.status === "SUCCEEDED",
    paidToMasterTiyn,
    platformTiyn,
    refundedTiyn,
    bankBalanceTiyn: sum(list, "HOLD") - paidToMasterTiyn - platformTiyn - refundedTiyn,
    isTest: list.some((e) => e.isTest),
  };
}

/**
 * Можно ли повторить операцию после отказа банка (ADR-009, «Повторы операций»): только отклонённую, только
 * раскрытие, его части и возврат, только последнюю попытку своего типа (иначе её уже повторили), а часть
 * выплаты — только при подтверждённом раскрытии (отклонённое раскрытие повторяется целиком, с частями).
 */
export type RetryCheck = "retriable" | "superseded" | "notFailed" | "notRetriable" | "parentNotSettled";

type RetryFields = Pick<LedgerEntry, "id" | "seq" | "type" | "status" | "parentId">;

export function retryCheck(entries: readonly RetryFields[], op: Omit<RetryFields, "seq">): RetryCheck {
  if (op.status !== "FAILED") return "notFailed";
  if (op.type === "HOLD" || op.type === "FREEZE" || op.type === "UNFREEZE") return "notRetriable";
  const list = bySeq(entries);
  if (lastOf(list, op.type)?.id !== op.id) return "superseded";
  if (op.parentId && list.find((e) => e.id === op.parentId)?.status !== "SUCCEEDED") return "parentNotSettled";
  return "retriable";
}

/**
 * Блок денег — первый блок карточки сделки (ТЗ п. 4.1): серый «ожидает оплаты», зелёный «под защитой банка»,
 * жёлтый «выплата заморожена», итог «сделка завершена» и возврат. `settled: false` — операция ещё в банке.
 */
export type MoneyView =
  | { kind: "awaiting"; payment: "none" | "PENDING" | "FAILED" }
  | { kind: "protected"; amountTiyn: bigint; reservedAt: Date; operationRef: string | null }
  | { kind: "frozen"; amountTiyn: bigint; frozenAt: Date }
  | { kind: "completed"; paidToMasterTiyn: bigint; protectionTiyn: bigint; refundedTiyn: bigint; settled: boolean; completedAt: Date | null }
  | { kind: "refunded"; amountTiyn: bigint; settled: boolean; refundedAt: Date | null };

export type MoneyBlock = MoneyView & { bankBalanceTiyn: bigint; isTest: boolean };

const at = (e: LedgerEntry) => e.settledAt ?? e.createdAt;

/**
 * Защита сделки (2%), которую покупатель заплатил по итогу: от цены X, а при разделе по спору — от доли мастера Y
 * (та же формула computeDealMoney). Цена X — снимок сделки, не её статус.
 */
function protectionOf(release: LedgerEntry, priceTiyn: bigint): bigint {
  return computeDealMoney(release.disputeShareTiyn ?? priceTiyn).protectionTiyn;
}

function viewOf(facts: MoneyFacts, list: LedgerEntry[], priceTiyn: bigint): MoneyView {
  const { releaseEntry: release, refundEntry: refund } = facts;
  if (release) {
    const parts = partsOf(list, release);
    const masterTiyn = parts.find((e) => e.type === "SPLIT_MASTER")?.amountTiyn ?? 0n;
    return {
      kind: "completed",
      paidToMasterTiyn: masterTiyn,
      protectionTiyn: protectionOf(release, priceTiyn),
      refundedTiyn: refund?.amountTiyn ?? 0n,
      settled: facts.payoutSettled,
      completedAt: facts.payoutSettled ? [release, ...parts, ...(refund ? [refund] : [])].map(at).reduce((a, b) => (a > b ? a : b)) : null,
    };
  }
  // Возврат целиком — только без раскрытия: при разделе по спору отклонённое раскрытие ждёт повтора.
  if (refund && !list.some((e) => e.type === "RELEASE")) return { kind: "refunded", amountTiyn: refund.amountTiyn, settled: refund.status === "SUCCEEDED", refundedAt: refund.settledAt };
  if (facts.frozenEntry) return { kind: "frozen", amountTiyn: facts.frozenEntry.amountTiyn, frozenAt: facts.frozenEntry.createdAt };
  if (facts.heldEntry) return { kind: "protected", amountTiyn: facts.heldEntry.amountTiyn, reservedAt: at(facts.heldEntry), operationRef: facts.heldEntry.externalRef };
  return { kind: "awaiting", payment: facts.hold === "SUCCEEDED" ? "none" : facts.hold };
}

export function projectMoney(entries: readonly LedgerEntry[], snapshot: { priceTiyn: bigint }): MoneyBlock {
  const list = bySeq(entries);
  const facts = factsOf(list);
  return { ...viewOf(facts, list, snapshot.priceTiyn), bankBalanceTiyn: facts.bankBalanceTiyn, isTest: facts.isTest };
}

/**
 * История денег (ТЗ п. 4.1, тап по блоку денег): зарезервировано → удержано на время спора → выплачено или
 * возвращено — со ссылками на документы-основания. RELEASE — служебная группа выплаты: в историю идут его части.
 */
export type MoneyHistoryItem = {
  id: string;
  type: Exclude<MoneyTransactionType, "RELEASE">;
  status: MoneyTransactionStatus;
  amountTiyn: bigint;
  at: Date;
  basisDocumentId: string | null;
  operationRef: string | null;
  isTest: boolean;
};

export function moneyHistoryOf(entries: readonly LedgerEntry[]): MoneyHistoryItem[] {
  const list = bySeq(entries);
  // Родитель части выплаты — всегда RELEASE: основание части — основание раскрытия (акт приёмки).
  const basisOf = new Map(list.map((e) => [e.id, e.basisDocumentId]));
  return list.flatMap((e) =>
    e.type === "RELEASE"
      ? []
      : [
          {
            id: e.id,
            type: e.type,
            status: e.status,
            amountTiyn: e.amountTiyn,
            at: at(e),
            basisDocumentId: e.basisDocumentId ?? (e.parentId ? (basisOf.get(e.parentId) ?? null) : null),
            operationRef: e.externalRef,
            isTest: e.isTest,
          },
        ],
  );
}
