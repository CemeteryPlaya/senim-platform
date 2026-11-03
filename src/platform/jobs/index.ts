import type { Job } from "@/generated/prisma/client";
import { db, Prisma, type Db } from "../db";
import { errorMessage, logger, type Logger } from "../logger";

/**
 * Фоновые задачи на таблице Job. Совместимо с Vercel: задачи забирает
 * /api/cron/run по расписанию или `npm run jobs` локально.
 *
 * Обработчик обязан быть идемпотентным: задача может выполниться повторно
 * после сбоя посередине или при одновременном запуске двух воркеров.
 */
export type JobContext = { jobId: string; attempt: number; log: Logger };
export type JobHandler = (payload: unknown, ctx: JobContext) => Promise<void>;
export type JobHandlers = Readonly<Record<string, JobHandler>>;

export type EnqueueInput = {
  kind: string;
  payload?: Prisma.InputJsonValue;
  runAt?: Date;
  /** Повторная постановка с тем же ключом не создаёт дубль. */
  dedupeKey?: string;
  maxAttempts?: number;
};

export async function enqueueJob(client: Db, input: EnqueueInput): Promise<void> {
  await client.job.createMany({
    data: [
      {
        kind: input.kind,
        payload: input.payload ?? {},
        runAt: input.runAt ?? new Date(),
        dedupeKey: input.dedupeKey,
        maxAttempts: input.maxAttempts ?? 5,
      },
    ],
    skipDuplicates: true,
  });
}

const STALE_LOCK_MINUTES = 10;

/** Атомарно забирает готовые задачи (и зависшие дольше 10 минут). */
async function claim(limit: number): Promise<Job[]> {
  return db.$queryRaw<Job[]>`
    UPDATE "Job" SET "status" = 'RUNNING', "lockedAt" = now(), "attempts" = "attempts" + 1
    WHERE "id" IN (
      SELECT "id" FROM "Job"
      WHERE ("status" = 'PENDING' AND "runAt" <= now())
         OR ("status" = 'RUNNING' AND "lockedAt" < now() - make_interval(mins => ${STALE_LOCK_MINUTES}))
      ORDER BY "runAt"
      LIMIT ${limit}
      FOR UPDATE SKIP LOCKED
    )
    RETURNING *`;
}

function backoff(attempt: number): Date {
  const seconds = Math.min(60 * 60, 30 * 2 ** (attempt - 1));
  return new Date(Date.now() + seconds * 1000);
}

export type RunSummary = { claimed: number; done: number; retried: number; failed: number };

export type RunOptions = {
  limit?: number;
  /** Момент (мс от эпохи), после которого новая задача не берётся: задача уже в работе доделывается. */
  deadline?: number;
  clock?: () => number;
};

/**
 * Выполняет до `limit` готовых задач. Задачи забираются по одной: взятая, но не начатая задача
 * висела бы RUNNING до снятия блокировки (10 минут), если функцию остановят по лимиту времени.
 */
export async function runDueJobs(handlers: JobHandlers, opts: RunOptions = {}): Promise<RunSummary> {
  const limit = opts.limit ?? 25;
  const clock = opts.clock ?? Date.now;
  const summary: RunSummary = { claimed: 0, done: 0, retried: 0, failed: 0 };
  while (summary.claimed < limit && (opts.deadline === undefined || clock() < opts.deadline)) {
    const [job] = await claim(1);
    if (!job) break;
    summary.claimed++;
    await runJob(handlers, job, summary);
  }
  return summary;
}

/**
 * Выполнить одну задачу сейчас, не дожидаясь прохода очереди (например, доставка SMS и push сразу после ответа).
 * Берётся только PENDING-задача с этим dedupeKey (срок runAt не важен): параллельный вызов или проход очереди
 * второй раз её не возьмут. Учёт попыток, ошибок и повторов — тот же, что у runDueJobs.
 * true — задача взята и выполнена (или ушла на повтор); false — брать нечего.
 */
export async function runJobNow(handlers: JobHandlers, dedupeKey: string): Promise<boolean> {
  const [job] = await db.job.updateManyAndReturn({
    where: { dedupeKey, status: "PENDING" },
    data: { status: "RUNNING", lockedAt: new Date(), attempts: { increment: 1 } },
  });
  if (!job) return false;
  await runJob(handlers, job, { claimed: 1, done: 0, retried: 0, failed: 0 });
  return true;
}

async function runJob(handlers: JobHandlers, job: Job, summary: RunSummary): Promise<void> {
  const log = logger.child({ jobId: job.id, kind: job.kind, attempt: job.attempts });
  const handler = handlers[job.kind];
  try {
    if (!handler) throw new Error(`Нет обработчика для задачи ${job.kind}`);
    await handler(job.payload, { jobId: job.id, attempt: job.attempts, log });
    await db.job.update({ where: { id: job.id }, data: { status: "DONE", finishedAt: new Date(), lastError: null } });
    summary.done++;
  } catch (e) {
    // Текст ошибки виден в панели оператора и в дампе БД — по тем же правилам, что лог (без ИИН, телефонов, аргументов Prisma).
    const message = errorMessage(e);
    const final = !handler || job.attempts >= job.maxAttempts;
    await db.job.update({
      where: { id: job.id },
      data: final
        ? { status: "FAILED", finishedAt: new Date(), lastError: message }
        : { status: "PENDING", runAt: backoff(job.attempts), lastError: message },
    });
    if (final) {
      summary.failed++;
      log.error("job failed", { error: e });
    } else {
      summary.retried++;
      log.warn("job will retry", { error: e });
    }
  }
}
