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
};

/**
 * Панель денег карточки спора. Главная сумма — то, что называет блок (остаток под защитой, выплата мастеру, возврат);
 * внизу всегда остаток на счёте сделки по журналу. Тестовую сделку называет одна строка — «Провайдер оплаты: Тестовый
 * (mock)» в «Сторонах»: провайдер у всех операций сделки один, пометки в панели и у каждой операции её повторяли.
 */
export function disputeMoney(money: MoneyBlock): DisputeMoney {
  const m = t.money;
  const balance = [{ label: m.bankBalance, amount: money.bankBalanceTiyn }];
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
  return { ...base, rows: balance };
}

/** Журнал денег сделки лентой: тип операции, статус и время; сумма справа. */
export function moneyTimeline(items: readonly MoneyHistoryItem[]): TimelineItem[] {
  return items.map((item) => ({
    title: `${t.money.types[item.type]}, ${t.money.status[item.status]}`,
    time: formatDateTime(item.at),
    amount: item.amountTiyn,
  }));
}

/** Название события журнала аудита: сделки — из общих текстов сделки, остальные — из текстов журнала, неизвестный код — как есть. */
export const auditTitle = (code: string): string =>
  (ru.deal.history.action as Record<string, string>)[code] ?? ru.app.operatorDeals.audit.actions[code] ?? code;

/**
 * История сделки из журнала аудита лентой: событие и строка «время · кто» (две строки на событие, а не три). Над чем
 * событие, не пишем: это видно из названия; полная запись — в журнале аудита.
 */
export function historyTimeline(events: readonly AuditView[]): TimelineItem[] {
  const actors = ru.deal.history.actor as Record<string, string>;
  return events.map((e) => ({
    title: auditTitle(e.action),
    time: t.card.historyWhen(formatDateTime(e.createdAt), actors[e.actorRole] ?? e.actorRole),
  }));
}

type DealStatus = keyof typeof t.dealStatus;

/**
 * Строка под чипами «что сейчас»: «С 12 марта 2026». Этап при открытии называем, только если сделка с тех пор на другом
 * этапе: иначе его уже говорит чип этапа рядом.
 */
export function openedLine(createdAt: Date, openedInStatus: DealStatus, currentStatus: DealStatus): string {
  const date = formatDate(createdAt);
  return openedInStatus === currentStatus ? t.card.openedAt(date) : t.card.openedAtStage(date, t.dealStatus[openedInStatus].toLowerCase());
}
