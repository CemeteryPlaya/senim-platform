import { ru } from "@/i18n/ru";
import type { CurrentUser } from "@/modules/identity";
import { db } from "@/platform/db";
import { fail, isAppError } from "@/platform/errors";
import { logger } from "@/platform/logger";
import { enforceRateLimit } from "@/platform/rate-limit";
import { suggestSegment, type SegmentSuggestion } from "@/verticals/furniture";
import { ownRequestIn } from "./access";
import { defaultDeps, ensureAiEnabled, type AiDeps } from "./deps";
import { scrubPii } from "./pii";
import { assistTextSchema, parseDraftSuggestion, toDraft, type RequestDraft } from "./schema";
import { ensureWithinDailyBudget, recordUsage } from "./usage";

export type AssistResult = {
  /** Поля для мастера заявки в формате Request.details; заказчик подтверждает их перед переносом. */
  draft: RequestDraft;
  /** Подсказка сегмента по правилам вертикали (не ИИ) с объяснением для «Почему?». */
  segment: SegmentSuggestion;
};

const ASSISTS_PER_HOUR = { limit: 20, windowSec: 3600 };

/**
 * «Опишите своими словами»: текст заказчика → черновик полей заявки.
 * Заявку не меняет — экран мастера сам переносит подтверждённые поля в черновик (requests).
 */
export async function assistRequest(
  user: CurrentUser,
  requestId: string,
  text: string,
  deps: AiDeps = defaultDeps,
): Promise<AssistResult> {
  ensureAiEnabled();
  const parsedText = assistTextSchema.safeParse(text);
  if (!parsedText.success) return fail.validation(parsedText.error.issues[0].message);
  await ownRequestIn(user, requestId, ["DRAFT"], ru.ai.errors.requestNotEditable);
  await enforceRateLimit(`ai.assist:${user.id}`, ASSISTS_PER_HOUR);
  await ensureWithinDailyBudget();

  const furnitureTypes = await db.furnitureType.findMany({
    where: { active: true },
    select: { slug: true, name: true },
    orderBy: { sortOrder: "asc" },
  });
  const provider = deps.provider();
  const answer = await callProvider(() => provider.structureRequest({ text: scrubPii(parsedText.data), furnitureTypes }));
  await recordUsage(db, { provider: provider.name, operation: "request.assist", usage: answer.usage, requestId, userId: user.id });

  const parsed = parseDraftSuggestion(answer.raw);
  if (!parsed.ok) {
    logger.warn("ai.assist.bad_answer", { provider: provider.name, model: answer.usage.model, issues: parsed.issues });
    return fail.unavailable(ru.ai.errors.badAnswer);
  }
  const draft = toDraft(
    parsed.suggestion,
    furnitureTypes.map((t) => t.slug),
  );
  return { draft, segment: suggestSegment(draft.details) };
}

/** Сбой сети или провайдера — «недоступно» для пользователя, подробности — в лог. */
async function callProvider<T>(call: () => Promise<T>): Promise<T> {
  try {
    return await call();
  } catch (e) {
    if (isAppError(e)) throw e;
    logger.warn("ai.provider.failed", { error: e });
    return fail.unavailable(ru.ai.errors.providerFailed);
  }
}
