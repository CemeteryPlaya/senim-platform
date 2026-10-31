import { z } from "zod";
import type { StoredFile, Visualization } from "@/generated/prisma/client";
import type { RequestStatus, VisualizationStatus } from "@/generated/prisma/enums";
import { ru } from "@/i18n/ru";
import { recordAudit, SYSTEM } from "@/modules/audit";
import { attachFiles, fileUrl, saveFile, storageByName } from "@/modules/files";
import { actorOf, type CurrentUser } from "@/modules/identity";
import { db, transaction } from "@/platform/db";
import { env } from "@/platform/env";
import { expectOneUpdated, fail, isAppError } from "@/platform/errors";
import { enqueueJob, type JobContext, type JobHandlers } from "@/platform/jobs";
import { enforceRateLimit } from "@/platform/rate-limit";
import { parseInput } from "@/platform/validation";
import { ownRequestIn, readableRequest } from "./access";
import { aiEnabled, defaultDeps, ensureAiEnabled, type AiDeps } from "./deps";
import { stampAiLabel } from "./label";
import { scrubPii } from "./pii";
import { visualizePromptSchema } from "./schema";
import { ensureWithinDailyBudget, reserveUsage, settleUsage } from "./usage";

/**
 * ИИ-иллюстрация мебели на фото помещения. Запрос ставит Visualization в очередь и задачу
 * ai.visualize; задача рисует, ставит пометку «Иллюстрация ИИ» и сохраняет результат.
 */

export const VISUALIZE_JOB = "ai.visualize";
export const VISUALIZE_ATTEMPTS = 3;
/** Иллюстрацию можно заказать, пока заявку видно заказчику как редактируемую или открытую. */
const VISUALIZABLE: readonly RequestStatus[] = ["DRAFT", "OPEN"];
const VISUALIZATIONS_PER_HOUR = { limit: 10, windowSec: 3600 };

export type VisualizationView = {
  id: string;
  status: VisualizationStatus;
  /** Сообщение для заказчика, если не получилось. */
  error: string | null;
  prompt: string;
  sourceFileId: string | null;
  createdAt: string;
  /** Картинки с пометкой «Иллюстрация ИИ» (вшита в изображение). */
  results: { id: string; url: string }[];
};

export type VisualizationList = { items: VisualizationView[]; limit: number; remaining: number };

const countsTowardLimit = { status: { not: "FAILED" } } as const;

export async function requestVisualization(
  user: CurrentUser,
  requestId: string,
  sourceFileId: string,
  prompt: string,
): Promise<VisualizationView> {
  ensureAiEnabled();
  const parsedPrompt = visualizePromptSchema.safeParse(prompt);
  if (!parsedPrompt.success) return fail.validation(parsedPrompt.error.issues[0].message);
  await ownRequestIn(user, requestId, VISUALIZABLE, ru.ai.errors.requestNotEditable);
  const source = await db.storedFile.findFirst({
    where: { id: sourceFileId, requestId, purpose: "REQUEST_ROOM", contentType: { startsWith: "image/" } },
    select: { id: true },
  });
  if (!source) return fail.validation(ru.ai.errors.notRoomPhoto);
  await enforceRateLimit(`ai.visualize:${user.id}`, VISUALIZATIONS_PER_HOUR);
  await ensureWithinDailyBudget();

  const limit = env().AI_MAX_VISUALIZATIONS_PER_REQUEST;
  const viz = await transaction(async (tx) => {
    // Лимит под блокировкой строки заявки: параллельные запросы по одной заявке идут по очереди.
    await tx.$queryRaw`SELECT "id" FROM "Request" WHERE "id" = ${requestId} FOR UPDATE`;
    const used = await tx.visualization.count({ where: { requestId, ...countsTowardLimit } });
    if (used >= limit) return fail.rateLimited(ru.ai.errors.limitReached(limit));
    const created = await tx.visualization.create({
      data: { requestId, sourceFileId, prompt: scrubPii(parsedPrompt.data) },
    });
    await enqueueJob(tx, {
      kind: VISUALIZE_JOB,
      payload: { visualizationId: created.id },
      dedupeKey: `${VISUALIZE_JOB}:${created.id}`,
      maxAttempts: VISUALIZE_ATTEMPTS,
    });
    await recordAudit(tx, {
      actor: actorOf(user),
      action: "ai.visualization.requested",
      entity: { type: "Visualization", id: created.id },
      scope: `request:${requestId}`,
      after: { status: created.status, sourceFileId },
    });
    return created;
  });
  return toView({ ...viz, results: [] });
}

// ─── задача ─────────────────────────────────────────────────────────────────

const payloadSchema = z.object({ visualizationId: z.string().min(1) });
const finished = (s: VisualizationStatus) => s === "DONE" || s === "FAILED";

/**
 * Обработчик ai.visualize. Идемпотентен: готовая или проваленная визуализация не трогается;
 * результат фиксируется условным переходом RUNNING → DONE, поэтому параллельный или повторный
 * запуск не прикрепит второй набор картинок.
 */
export async function runVisualization(payload: unknown, ctx: JobContext, deps: AiDeps = defaultDeps): Promise<void> {
  const { visualizationId: id } = parseInput(payloadSchema, payload);
  const viz = await db.visualization.findUnique({
    where: { id },
    include: { request: { select: { clientId: true } }, sourceFile: true },
  });
  if (!viz || finished(viz.status)) return;
  if (!aiEnabled()) return markFailed(id, ru.ai.errors.disabled);
  if (!viz.sourceFile) return markFailed(id, ru.ai.errors.notRoomPhoto);

  await db.visualization.updateMany({ where: { id, status: "QUEUED" }, data: { status: "RUNNING" } });
  try {
    await generate({ ...viz, sourceFile: viz.sourceFile, clientId: viz.request.clientId }, deps);
  } catch (e) {
    const now = await db.visualization.findUnique({ where: { id }, select: { status: true } });
    if (!now || finished(now.status)) return; // параллельный запуск уже закончил
    const last = isAppError(e) || ctx.attempt >= VISUALIZE_ATTEMPTS;
    if (!last) throw e;
    ctx.log.warn("ai.visualize.failed", { visualizationId: id, error: e });
    await markFailed(id, isAppError(e) ? e.message : ru.ai.errors.visualizationFailed);
  }
}

type Job = Visualization & { sourceFile: StoredFile; clientId: string };

async function generate(viz: Job, deps: AiDeps): Promise<void> {
  const image = await (await storageByName(viz.sourceFile.provider)).get(viz.sourceFile.storageKey);
  if (!image) return fail.unavailable(ru.ai.errors.notRoomPhoto);
  // Бюджет — и здесь (резервом): задача могла ждать в очереди, пока платформа тратила дневной лимит.
  const provider = deps.provider();
  const reservation = await reserveUsage({ provider: provider.name, operation: "request.visualize", requestId: viz.requestId, userId: viz.clientId });
  const result = await provider.visualizeRoom({ image, contentType: viz.sourceFile.contentType, prompt: viz.prompt });
  const cost = await settleUsage(reservation, result.usage);
  if (result.images.length === 0) return fail.unavailable(ru.ai.errors.visualizationFailed);

  const fileIds: string[] = [];
  for (const img of result.images) {
    const bytes = await stampAiLabel(img.data);
    const file = await saveFile({ purpose: "VISUALIZATION", bytes, uploadedById: viz.clientId, isAiGenerated: true });
    fileIds.push(file.id);
  }

  await transaction(async (tx) => {
    const done = await tx.visualization.updateMany({
      where: { id: viz.id, status: "RUNNING" },
      data: { status: "DONE", finishedAt: new Date(), costUsdMicros: cost, error: null },
    });
    expectOneUpdated(done);
    await attachFiles(tx, { fileIds, uploadedById: viz.clientId, owner: { visualizationId: viz.id } });
    await recordAudit(tx, {
      actor: SYSTEM(VISUALIZE_JOB),
      action: "ai.visualization.done",
      entity: { type: "Visualization", id: viz.id },
      scope: `request:${viz.requestId}`,
      after: { status: "DONE", results: fileIds.length, costUsdMicros: cost },
    });
  });
}

async function markFailed(id: string, message: string): Promise<void> {
  await db.visualization.updateMany({
    where: { id, status: { in: ["QUEUED", "RUNNING"] } },
    data: { status: "FAILED", error: message, finishedAt: new Date() },
  });
}

export const jobHandlers = {
  [VISUALIZE_JOB]: (payload, ctx) => runVisualization(payload, ctx),
} as const satisfies JobHandlers;

// ─── просмотр ───────────────────────────────────────────────────────────────

async function toView(viz: Visualization & { results: StoredFile[] }): Promise<VisualizationView> {
  const results = [...viz.results].sort((a, b) => a.sortOrder - b.sortOrder);
  return {
    id: viz.id,
    status: viz.status,
    error: viz.error,
    prompt: viz.prompt,
    sourceFileId: viz.sourceFileId,
    createdAt: viz.createdAt.toISOString(),
    results: await Promise.all(results.map(async (f) => ({ id: f.id, url: await fileUrl(f) }))),
  };
}

/** Одна визуализация — для опроса статуса. Заказчик видит только свои, оператор — все. */
export async function getVisualization(user: CurrentUser, visualizationId: string): Promise<VisualizationView> {
  ensureAiEnabled();
  const viz = await db.visualization.findUnique({ where: { id: visualizationId }, include: { results: true } });
  if (!viz) return fail.notFound();
  await readableRequest(user, viz.requestId);
  return toView(viz);
}

export async function listVisualizations(user: CurrentUser, requestId: string): Promise<VisualizationList> {
  ensureAiEnabled();
  await readableRequest(user, requestId);
  const items = await db.visualization.findMany({
    where: { requestId },
    include: { results: true },
    orderBy: { createdAt: "desc" },
  });
  const limit = env().AI_MAX_VISUALIZATIONS_PER_REQUEST;
  const used = items.filter((v) => v.status !== "FAILED").length;
  return { items: await Promise.all(items.map(toView)), limit, remaining: Math.max(0, limit - used) };
}
