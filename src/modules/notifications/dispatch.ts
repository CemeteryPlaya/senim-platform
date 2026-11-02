import { after } from "next/server";
import { db } from "@/platform/db";
import type { JobHandlers } from "@/platform/jobs";
import { errorMessage, logger } from "@/platform/logger";

/**
 * Доставка SMS и push сразу после ответа, а не при следующем проходе очереди (cron на Vercel — раз в сутки).
 *
 * Задачи ставятся в транзакции события (notify): откат транзакции убирает их, и доставлять нечего.
 * После ответа (after из next/server) транзакция уже закоммичена или откатилась — забираем свои задачи
 * по dedupeKey. Задача, которую взял кто-то другой (параллельный проход очереди), не берётся второй раз.
 * Неудача — задача возвращается в очередь с отложенным повтором, её доведёт обычный проход.
 */
export function deliverAfterResponse(handlers: () => JobHandlers, dedupeKeys: readonly string[]): void {
  if (dedupeKeys.length === 0) return;
  try {
    after(() => runQueuedNow(handlers(), dedupeKeys));
  } catch {
    // Вне запроса Next (фоновые задачи, скрипты, тесты) after недоступен: задачи заберёт очередь.
  }
}

const RETRY_IN_MS = 60_000;

/**
 * INTEGRATOR: перенести в platform/jobs как runJobNow(handlers, dedupeKey) рядом с runJob — тот же учёт
 * попыток и ошибок; сейчас это рабочий адаптер в модуле notifications.
 */
export async function runQueuedNow(handlers: JobHandlers, dedupeKeys: readonly string[]): Promise<void> {
  for (const dedupeKey of dedupeKeys) {
    const [job] = await db.job.updateManyAndReturn({
      where: { dedupeKey, status: "PENDING" },
      data: { status: "RUNNING", lockedAt: new Date(), attempts: { increment: 1 } },
    });
    const handler = job && handlers[job.kind];
    if (!job || !handler) continue;
    const log = logger.child({ jobId: job.id, kind: job.kind, attempt: job.attempts });
    try {
      await handler(job.payload, { jobId: job.id, attempt: job.attempts, log });
      await db.job.update({ where: { id: job.id }, data: { status: "DONE", finishedAt: new Date(), lastError: null } });
    } catch (e) {
      const final = job.attempts >= job.maxAttempts;
      await db.job.update({
        where: { id: job.id },
        data: final
          ? { status: "FAILED", finishedAt: new Date(), lastError: errorMessage(e) }
          : { status: "PENDING", runAt: new Date(Date.now() + RETRY_IN_MS), lastError: errorMessage(e) },
      });
      log.warn("job.deliver_now_failed", { error: e });
    }
  }
}
