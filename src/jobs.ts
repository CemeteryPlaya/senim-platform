import "server-only";
import { jobHandlers as ai } from "@/modules/ai";
import { jobHandlers as companies } from "@/modules/companies";
import { jobHandlers as dealCore, onMoneySettled } from "@/modules/deal-core";
import { jobHandlers as documents } from "@/modules/documents";
import { jobHandlers as files } from "@/modules/files";
import { jobHandlers as identity } from "@/modules/identity";
import { jobHandlers as notifications } from "@/modules/notifications";
import { jobHandlers as operator } from "@/modules/operator";
import { JOB_POLL_PENDING, paymentJobHandlers } from "@/modules/payments";
import { jobHandlers as requests } from "@/modules/requests";
import { db } from "@/platform/db";
import { enqueueJob, runDueJobs, type JobHandlers, type RunSummary } from "@/platform/jobs";
import { registerPorts } from "@/ports";

// Процесс `npm run jobs` не выполняет instrumentation Next: без портов акт и оферта ушли бы без PDF.
registerPorts();

/**
 * Все обработчики фоновых задач. Каждый модуль экспортирует свои `jobHandlers`
 * с ключами вида «<модуль>.<задача>», поэтому они не пересекаются.
 * Задачи payments получают хук итога операции от deal-core: payments не импортирует deal-core.
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
  ...paymentJobHandlers(onMoneySettled),
  ...requests,
};

/** Обслуживающие задачи раз в сутки. Ставятся перед каждым проходом; повтор за те же сутки отсекает dedupeKey. */
const DAILY = ["files.cleanupOrphans"] as const;
/** Опрос ждущих операций провайдеров — раз в 10 минут (вебхук мог не дойти). */
const POLL_BUCKET_MS = 10 * 60_000;

export async function enqueueDailyJobs(now = new Date()): Promise<void> {
  const day = now.toISOString().slice(0, 10);
  for (const kind of DAILY) await enqueueJob(db, { kind, dedupeKey: `${kind}:${day}` });
  const bucket = Math.floor(now.getTime() / POLL_BUCKET_MS);
  await enqueueJob(db, { kind: JOB_POLL_PENDING, dedupeKey: `${JOB_POLL_PENDING}:${bucket}`, maxAttempts: 1 });
}

/**
 * Сколько cron-вызов берёт новые задачи. Функция на Vercel живёт до 60 с (maxDuration маршрута),
 * а самая долгая задача — визуализация с вызовом шлюза ИИ до 40 с (AI_CALL_TIMEOUT_MS) и запасом
 * на фото: задача, взятая на 15-й секунде, успевает завершиться до остановки функции.
 */
export const DRAIN_BUDGET_MS = 15_000;

/**
 * Разбирает очередь проходами по 25 задач, пока она не опустеет или не истечёт бюджет времени:
 * один проход за вызов cron не успевал за очередью. После бюджета новая задача не берётся даже
 * посреди прохода. Задача, ушедшая на повтор, получает runAt в будущем и в этом же вызове не берётся снова.
 */
export async function drainJobs(
  handlers: JobHandlers = jobHandlers,
  opts: { budgetMs?: number; clock?: () => number } = {},
): Promise<RunSummary & { passes: number }> {
  const clock = opts.clock ?? Date.now;
  const budget = opts.budgetMs ?? DRAIN_BUDGET_MS;
  const deadline = clock() + budget;
  const total = { claimed: 0, done: 0, retried: 0, failed: 0, passes: 0 };
  for (;;) {
    const pass = await runDueJobs(handlers, { deadline, clock });
    total.passes++;
    total.claimed += pass.claimed;
    total.done += pass.done;
    total.retried += pass.retried;
    total.failed += pass.failed;
    if (pass.claimed === 0 || clock() >= deadline) return total;
  }
}
