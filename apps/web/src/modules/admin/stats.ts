// Статистика платформы для администратора (спека, цель 3): заявки, сделки и мастера по статусам, деньги и воронка за
// период. Деньги — только журнал денег (MoneyTransaction), не статусы и не снимки сумм сделки: проведённые операции
// (SUCCEEDED) по типам, суммы — тиыны BigInt. Период записей — по createdAt; операции журнала — по settledAt (момент,
// когда деньги действительно двинулись, как в отчёте дохода оператора).
import { DealStatus, MoneyTransactionType, RegistrationStatus, RequestStatus } from "@/generated/prisma/enums";
import { ru } from "@/i18n/ru";
import type { CurrentUser } from "@/modules/identity";
import { db, type Prisma } from "@/platform/db";
import { fail } from "@/platform/errors";
import { assertAdmin } from "./access";

export const ADMIN_PERIODS = ["month", "7d", "30d", "all"] as const;
export type AdminPeriod = (typeof ADMIN_PERIODS)[number];

const DAY = 86_400_000;
const DAYS: Record<Exclude<AdminPeriod, "month">, number | null> = { "7d": 7, "30d": 30, all: null };

/**
 * Начало периода. «Этот месяц» — с 1-го числа по Алматы (+05:00), как «Доход платформы» оператора по умолчанию: на двух
 * экранах один и тот же доход; остальные — скользящие N дней от «сейчас»; «всё время» — без границы.
 */
function periodStart(period: AdminPeriod, now: Date): Date | null {
  if (period === "month") {
    const today = new Intl.DateTimeFormat("sv-SE", { timeZone: "Asia/Almaty" }).format(now);
    return new Date(`${today.slice(0, 8)}01T00:00:00.000+05:00`);
  }
  const days = DAYS[period];
  return days === null ? null : new Date(now.getTime() - days * DAY);
}

export type StatusCount<S extends string> = { status: S; count: number };

export type AdminStats = {
  requests: StatusCount<RequestStatus>[];
  deals: StatusCount<DealStatus>[];
  masters: StatusCount<RegistrationStatus>[];
  /** Проведённые операции журнала: оплата покупателей (HOLD), выплата мастерам (SPLIT_MASTER), возвраты (REFUND), доход (SPLIT_PLATFORM). */
  money: { paidTiyn: bigint; payoutTiyn: bigint; refundTiyn: bigint; incomeTiyn: bigint };
  /** Заявки периода, дошедшие до шага; каждый шаг включает предыдущие (числа не растут вниз по воронке). */
  funnel: { published: number; withOffer: number; dealCreated: number; paid: number; accepted: number; paidOut: number };
};

export function isAdminPeriod(value: unknown): value is AdminPeriod {
  return typeof value === "string" && (ADMIN_PERIODS as readonly string[]).includes(value);
}

/** Все значения перечисления по порядку схемы, с нулями для отсутствующих. */
function byStatus<S extends string>(all: Record<string, S>, groups: readonly { status: S; _count: { _all: number } }[]): StatusCount<S>[] {
  return Object.values(all).map((status) => ({ status, count: groups.find((g) => g.status === status)?._count._all ?? 0 }));
}

const succeeded = (type: MoneyTransactionType): Prisma.DealWhereInput => ({ transactions: { some: { type, status: "SUCCEEDED" } } });

export async function adminStats(user: CurrentUser, period: AdminPeriod, now: Date = new Date()): Promise<AdminStats> {
  assertAdmin(user);
  // Вход сверяется с typeof, а не с типом TS: неизвестный период — отказ, а не «всё время».
  if (!isAdminPeriod(period)) return fail.validation(ru.common.errors.invalid);
  const start = periodStart(period, now);
  const since = start === null ? undefined : { gte: start };
  const created = since ? { createdAt: since } : {};

  // Воронка: заявки периода; шаг — условие на заявку вместе со всеми прежними шагами.
  const published: Prisma.RequestWhereInput = { ...created, publishedAt: { not: null } };
  const withOffer: Prisma.RequestWhereInput = { ...published, offers: { some: {} } };
  const dealCreated: Prisma.RequestWhereInput = { ...withOffer, deal: { isNot: null } };
  const paid: Prisma.RequestWhereInput = { ...withOffer, deal: { is: succeeded("HOLD") } };
  const accepted: Prisma.RequestWhereInput = { ...withOffer, deal: { is: { ...succeeded("HOLD"), acceptedAt: { not: null } } } };
  const paidOut: Prisma.RequestWhereInput = {
    ...withOffer,
    deal: { is: { AND: [succeeded("HOLD"), { acceptedAt: { not: null } }, succeeded("SPLIT_MASTER")] } },
  };

  const [requests, deals, masters, operations, funnel] = await Promise.all([
    db.request.groupBy({ by: ["status"], where: created, _count: { _all: true } }),
    db.deal.groupBy({ by: ["status"], where: created, _count: { _all: true } }),
    db.executorProfile.groupBy({ by: ["status"], where: created, _count: { _all: true } }),
    db.moneyTransaction.groupBy({ by: ["type"], where: { status: "SUCCEEDED", ...(since ? { settledAt: since } : {}) }, _sum: { amountTiyn: true } }),
    Promise.all([published, withOffer, dealCreated, paid, accepted, paidOut].map((where) => db.request.count({ where }))),
  ]);
  const sum = (type: MoneyTransactionType): bigint => operations.find((o) => o.type === type)?._sum.amountTiyn ?? 0n;

  return {
    requests: byStatus(RequestStatus, requests),
    deals: byStatus(DealStatus, deals),
    masters: byStatus(RegistrationStatus, masters),
    money: { paidTiyn: sum("HOLD"), payoutTiyn: sum("SPLIT_MASTER"), refundTiyn: sum("REFUND"), incomeTiyn: sum("SPLIT_PLATFORM") },
    funnel: { published: funnel[0], withOffer: funnel[1], dealCreated: funnel[2], paid: funnel[3], accepted: funnel[4], paidOut: funnel[5] },
  };
}
