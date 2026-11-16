import { formatDate, formatDateTime } from "@/features/format/format";
import { ru } from "@/i18n/ru";
import type { StatusTone, TimelineItem } from "@/kit";
import type { AuditView } from "@/modules/operator";
import type { MoneyBlock, MoneyHistoryItem } from "@/modules/payments";

const t = ru.app.operatorDisputes;

/** Открытый спор — «от человека нужно действие» (warn), решённый — нейтрально. */
export function disputeTone(status: "OPEN" | "RESOLVED"): StatusTone {
  return status === "OPEN" ? "warn" : "neutral";
}

/** Блок денег сделки по журналу (не по статусу сделки): тон панели, подпись, главная сумма и строки. Суммы — тиыны. */
export type DisputeMoney = {
  tone: "awaiting" | "protected" | "frozen" | "completed" | "refunded";
  title: string;
  amount: bigint;
  rows: { label: string; amount: bigint }[];
  note?: string;
};

/**
 * Панель денег карточки спора. Главная сумма — то, что называет блок (остаток под защитой, выплата мастеру, возврат);
 * внизу всегда остаток на счёте сделки по журналу. Пометка тестовой операции — только оператору (эта страница).
 */
export function disputeMoney(money: MoneyBlock): DisputeMoney {
  const m = t.money;
  const balance = [{ label: m.bankBalance, amount: money.bankBalanceTiyn }];
  const note = money.isTest ? m.test : undefined;
  const base = (() => {
    switch (money.kind) {
      case "awaiting":
        return { tone: "awaiting" as const, title: m.awaiting, amount: 0n };
      case "protected":
        return { tone: "protected" as const, title: m.protected, amount: money.amountTiyn };
      case "frozen":
        return { tone: "frozen" as const, title: m.frozen, amount: money.amountTiyn };
      case "completed":
        return { tone: "completed" as const, title: money.settled ? m.completed : m.completedPending, amount: money.paidToMasterTiyn };
      case "refunded":
        return { tone: "refunded" as const, title: money.settled ? m.refunded : m.refundedPending, amount: money.amountTiyn };
    }
  })();
  return { ...base, rows: balance, ...(note ? { note } : {}) };
}

/** Журнал денег сделки лентой: тип операции, статус и время; сумма справа; «тестовая» — пометка для оператора. */
export function moneyTimeline(items: readonly MoneyHistoryItem[]): TimelineItem[] {
  return items.map((item) => ({
    title: `${t.money.types[item.type]}, ${t.money.status[item.status]}`,
    time: formatDateTime(item.at),
    amount: item.amountTiyn,
    ...(item.isTest ? { text: t.money.testMark } : {}),
  }));
}

/** Название события журнала аудита: сделки — из общих текстов сделки, неизвестный код — как есть. */
export const auditTitle = (code: string): string => (ru.deal.history.action as Record<string, string>)[code] ?? code;

/** Над чем событие: слово по типу записи (без учёта регистра и «_»); неизвестный тип — `null` (в ленте только роль). */
export function entityLabel(entityType: string): string | null {
  return t.card.entities[entityType.replace(/[_\s]/g, "").toLowerCase()] ?? null;
}

/** История сделки из журнала аудита лентой: событие, время, кто и над чем. */
export function historyTimeline(events: readonly AuditView[]): TimelineItem[] {
  const actors = ru.deal.history.actor as Record<string, string>;
  return events.map((e) => ({
    title: auditTitle(e.action),
    time: formatDateTime(e.createdAt),
    text: t.card.historyActor(actors[e.actorRole] ?? e.actorRole, entityLabel(e.entityType)),
  }));
}

/** «Открыт 12 марта 2026. Этап сделки при открытии: …». */
export function openedLine(createdAt: Date, openedInStatus: keyof typeof t.dealStatus): string {
  return t.card.openedAt(formatDate(createdAt), t.dealStatus[openedInStatus].toLowerCase());
}
