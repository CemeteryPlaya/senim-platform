/** Сроки сделки для «Подробнее о заказе»: готовность — от начала работ (или оплаты) плюс срок по отклику. */

const DAY_MS = 24 * 3600 * 1000;

export type ScheduleInput = { durationDays: number; paidAt: Date | null; startedAt: Date | null };

/** Плановая готовность; null — отсчёт ещё не начался (не оплачено). */
export function plannedReadyAt(s: ScheduleInput): Date | null {
  const from = s.startedAt ?? s.paidAt;
  return from ? new Date(from.getTime() + s.durationDays * DAY_MS) : null;
}

/** Сколько полных дней осталось до даты (0 — сегодня или уже прошла). */
export function daysLeft(until: Date, now: Date = new Date()): number {
  return Math.max(0, Math.ceil((until.getTime() - now.getTime()) / DAY_MS));
}
