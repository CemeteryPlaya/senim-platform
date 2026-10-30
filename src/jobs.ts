import "server-only";
import { jobHandlers as ai } from "@/modules/ai";
import { jobHandlers as companies } from "@/modules/companies";
import { jobHandlers as dealCore, onPaymentSettled } from "@/modules/deal-core";
import { jobHandlers as documents } from "@/modules/documents";
import { jobHandlers as files } from "@/modules/files";
import { jobHandlers as identity } from "@/modules/identity";
import { jobHandlers as notifications } from "@/modules/notifications";
import { jobHandlers as operator } from "@/modules/operator";
import { JOB_RESEND_PENDING, paymentJobHandlers } from "@/modules/payments";
import { jobHandlers as requests } from "@/modules/requests";
import { db } from "@/platform/db";
import { enqueueJob, runDueJobs, type JobHandlers, type RunSummary } from "@/platform/jobs";

/**
 * Все обработчики фоновых задач. Каждый модуль экспортирует свои `jobHandlers`
 * с ключами вида «<модуль>.<задача>», поэтому они не пересекаются.
 */
export const jobHandlers: JobHandlers = {
  ...ai,
  ...companies,
  ...dealCore,
  ...documents,
  ...files,
  ...identity,
  ...notifications,
  ...operator,
  ...paymentJobHandlers(onPaymentSettled),
  ...requests,
};

/** Обслуживающие задачи раз в сутки. Ставятся перед каждым проходом; повтор за те же сутки отсекает dedupeKey. */
const DAILY = ["files.cleanupOrphans", JOB_RESEND_PENDING] as const;

export async function enqueueDailyJobs(now = new Date()): Promise<void> {
  const day = now.toISOString().slice(0, 10);
  for (const kind of DAILY) await enqueueJob(db, { kind, dedupeKey: `${kind}:${day}` });
}

/** Сколько cron-вызов разбирает очередь: функция на Vercel живёт до 60 с (maxDuration маршрута). */
export const DRAIN_BUDGET_MS = 50_000;

/**
 * Разбирает очередь проходами по 25 задач, пока она не опустеет или не истечёт бюджет времени:
 * один проход за вызов cron не успевал за очередью. Задача, ушедшая на повтор, получает runAt
 * в будущем и в этом же вызове не берётся снова.
 */
export async function drainJobs(
  handlers: JobHandlers = jobHandlers,
  opts: { budgetMs?: number; clock?: () => number } = {},
): Promise<RunSummary & { passes: number }> {
  const clock = opts.clock ?? Date.now;
  const budget = opts.budgetMs ?? DRAIN_BUDGET_MS;
  const start = clock();
  const total = { claimed: 0, done: 0, retried: 0, failed: 0, passes: 0 };
  for (;;) {
    const pass = await runDueJobs(handlers);
    total.passes++;
    total.claimed += pass.claimed;
    total.done += pass.done;
    total.retried += pass.retried;
    total.failed += pass.failed;
    if (pass.claimed === 0 || clock() - start >= budget) return total;
  }
}
