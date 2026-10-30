import "server-only";
import { jobHandlers as ai } from "@/modules/ai";
import { jobHandlers as companies } from "@/modules/companies";
import { jobHandlers as dealCore } from "@/modules/deal-core";
import { jobHandlers as documents } from "@/modules/documents";
import { jobHandlers as files } from "@/modules/files";
import { jobHandlers as identity } from "@/modules/identity";
import { jobHandlers as notifications } from "@/modules/notifications";
import { jobHandlers as operator } from "@/modules/operator";
import { jobHandlers as payments } from "@/modules/payments";
import { jobHandlers as requests } from "@/modules/requests";
import { db } from "@/platform/db";
import { enqueueJob, type JobHandlers } from "@/platform/jobs";

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
  ...payments,
  ...requests,
};

/** Обслуживающие задачи раз в сутки. Ставятся перед каждым проходом; повтор за те же сутки отсекает dedupeKey. */
const DAILY = ["files.cleanupOrphans"] as const;

export async function enqueueDailyJobs(now = new Date()): Promise<void> {
  const day = now.toISOString().slice(0, 10);
  for (const kind of DAILY) await enqueueJob(db, { kind, dedupeKey: `${kind}:${day}` });
}
