import type { PaymentMode } from "@/generated/prisma/enums";

/**
 * Плановая готовность заказа — по пункту 2.2 договора: срок в днях идёт с подписания обеими сторонами,
 * а в эскроу — с поступления всей цены договора на счёт. Нет даты начала — нет и плановой даты:
 * экран её не показывает, а не придумывает.
 */
export type ScheduleInput = {
  paymentMode: PaymentMode;
  signedAt: Date | null;
  durationDays: number;
  totalAmount: number;
  /** Пополнения счёта сделки (операции DEPOSIT). */
  deposits: readonly { status: string; amount: number; completedAt: Date | null }[];
};

const DAY_MS = 24 * 60 * 60 * 1000;

/** Когда счёт пополнен на всю цену договора: дата последнего нужного пополнения или null. */
function fundedAt(input: ScheduleInput): Date | null {
  const done = input.deposits
    .filter((d): d is typeof d & { completedAt: Date } => d.status === "SUCCEEDED" && d.completedAt !== null)
    .toSorted((a, b) => a.completedAt.getTime() - b.completedAt.getTime());
  let sum = 0;
  for (const d of done) {
    sum += d.amount;
    if (sum >= input.totalAmount) return d.completedAt;
  }
  return null;
}

export function plannedReadyAt(input: ScheduleInput): Date | null {
  const start = input.paymentMode === "MANUAL" ? input.signedAt : input.signedAt && fundedAt(input);
  return start ? new Date(start.getTime() + input.durationDays * DAY_MS) : null;
}

/** Сколько полных или начатых дней до плановой даты; срок наступил или прошёл — null. */
export function daysLeft(readyAt: Date, now: Date): number | null {
  const ms = readyAt.getTime() - now.getTime();
  return ms > 0 ? Math.ceil(ms / DAY_MS) : null;
}
