import type { PrismaClient } from "@/generated/prisma/client";
import { recalculateRating } from "@/modules/companies";
import { Prisma, type Tx } from "@/platform/db";
import { logger } from "@/platform/logger";
import type { ReviewSpec } from "./data";
import { resolveWhen } from "./timeline";

/**
 * Время сделок сида по дням (повторный разбор вида, 0.2). Сделки сида идут настоящими сервисами (deals.ts), и каждый сервис
 * пишет «сейчас»: без переноса у всех событий истории, отчётов и операций журнала денег — одна минута засева. Сид отмечает
 * окно стенных часов каждого действия (акцепт, подпись, оплата, отчёт…) и потом одной транзакцией переносит все отметки
 * времени этого окна на день из плана (`DealPlan.at`), сохраняя порядок внутри окна. Сделки засеваются по очереди и
 * больше никто в базу не пишет, поэтому окно однозначно называет действие.
 *
 * В той же транзакции покупатели завершённых сделок оставляют отзывы (номера операций тестовый провайдер сразу выдаёт в виде
 * номеров банка — 12 цифр).
 *
 * Журнал аудита и журнал денег защищены триггерами только-добавления: на время этой транзакции сид отключает их
 * (ALTER TABLE … DISABLE TRIGGER — нужен владелец таблиц, на стенде и в тестах это так) и включает обратно до фиксации.
 * Меняются только строки, созданные сидом в окнах его действий.
 */

/** Окно действия сида: всё, что записано с `from` до начала следующего окна, переносится на `target` (мс UTC). */
export type SeedWindow = { from: number; target: number };

/** Отзыв сида: сделка уже создана сервисами. */
export type SeedReview = ReviewSpec & { dealId: string };

/** Таблицы, где время — не история (сессии, коды, задачи, лимиты, настройки), и столбцы «будущего» — не переносятся. */
const SKIP_TABLES = new Set(["_prisma_migrations", "Session", "OtpCode", "Job", "RateLimitBucket", "PlatformSetting", "PushSubscription", "AiUsage", "Visualization"]);
const SKIP_COLUMN = /expire|desiredDate|scheduledAt/i;

const TRIGGERS = [
  { table: "AuditEvent", trigger: "audit_event_no_update_delete" },
  { table: "MoneyTransaction", trigger: "money_transaction_no_delete_rewrite" },
] as const;

/** Postgres timestamp(3) без пояса — так Prisma хранит DateTime (UTC). */
const pgTs = (ms: number) => new Date(ms).toISOString().slice(0, 23).replace("T", " ");
const ident = (name: string) => Prisma.raw(`"${name.replaceAll('"', '""')}"`);

async function shiftWindows(tx: Tx, windows: SeedWindow[], end: number): Promise<void> {
  await tx.$executeRaw`CREATE TEMP TABLE seed_retime (from_at timestamp(3), to_at timestamp(3), target timestamp(3)) ON COMMIT DROP`;
  const rows = windows.map((w, i) => Prisma.sql`(${pgTs(w.from)}::timestamp(3), ${pgTs(windows[i + 1]?.from ?? end)}::timestamp(3), ${pgTs(w.target)}::timestamp(3))`);
  await tx.$executeRaw`INSERT INTO seed_retime (from_at, to_at, target) VALUES ${Prisma.join(rows)}`;
  const columns = await tx.$queryRaw<{ table_name: string; column_name: string }[]>`
    SELECT table_name, column_name FROM information_schema.columns
    WHERE table_schema = 'public' AND data_type LIKE 'timestamp%'`;
  for (const { table_name: table, column_name: column } of columns) {
    if (SKIP_TABLES.has(table) || SKIP_COLUMN.test(column)) continue;
    const t = ident(table);
    const c = ident(column);
    await tx.$executeRaw`UPDATE ${t} AS t SET ${c} = w.target + (t.${c} - w.from_at) FROM seed_retime w WHERE t.${c} >= w.from_at AND t.${c} < w.to_at`;
  }
}

/** Отзывы — как их пишет deal-core.leaveReview (отзыв, событие аудита, пересчёт рейтинга), но со временем из плана. */
async function seedReviews(tx: Tx, reviews: SeedReview[], now: number): Promise<void> {
  for (const r of reviews) {
    const deal = await tx.deal.findUniqueOrThrow({ where: { id: r.dealId }, select: { id: true, clientId: true, executorId: true, status: true } });
    if (deal.status !== "SPLIT_PAYOUT") throw new Error(`Отзыв сида: сделка ${r.request} не завершена`);
    const createdAt = new Date(resolveWhen(r.at, now));
    await tx.review.create({ data: { dealId: deal.id, executorId: deal.executorId, authorId: deal.clientId, rating: r.rating, text: r.text, createdAt } });
    await tx.auditEvent.create({
      data: { actorId: deal.clientId, actorRole: "CLIENT", action: "review.created", entityType: "deal", entityId: deal.id, scope: `deal:${deal.id}`, after: { rating: r.rating }, createdAt },
    });
  }
  // Рейтинг и число завершённых сделок в профиле — у всех мастеров: сделки сида шли без отзывов и пересчёта.
  for (const { id } of await tx.executorProfile.findMany({ select: { id: true } })) await recalculateRating(tx, id);
}

async function setTriggers(tx: Tx, mode: "DISABLE" | "ENABLE"): Promise<void> {
  for (const { table, trigger } of TRIGGERS) {
    try {
      await tx.$executeRawUnsafe(`ALTER TABLE "${table}" ${mode} TRIGGER "${trigger}"`);
    } catch (error) {
      logger.error("seed retime: cannot toggle append-only trigger", { table, trigger, error });
      throw new Error(`Сид: нет прав на ALTER TABLE "${table}" (${mode} TRIGGER ${trigger}) — DATABASE_URL сида должен быть владельцем таблиц`, { cause: error });
    }
  }
}

/** Перенос времени и отзывы — одной транзакцией: упало — откат целиком, триггеры остаются включёнными. */
export async function retimeSeed(db: PrismaClient, input: { windows: SeedWindow[]; end: number; now: number; reviews: SeedReview[] }): Promise<void> {
  await db.$transaction(
    async (tx) => {
      await setTriggers(tx, "DISABLE");
      await shiftWindows(tx, input.windows, input.end);
      await seedReviews(tx, input.reviews, input.now);
      await setTriggers(tx, "ENABLE");
    },
    { maxWait: 10_000, timeout: 120_000 },
  );
}
