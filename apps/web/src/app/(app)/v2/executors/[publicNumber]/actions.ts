"use server";

import { ru } from "@/i18n/ru";
import { requireUser } from "@/modules/identity";
import { inviteExecutor, inviteExecutorSchema } from "@/modules/requests";
import { action } from "@/platform/action";
import { AppError, isAppError } from "@/platform/errors";
import { enforceRateLimit } from "@/platform/rate-limit";

// Приглашение мастера к своему открытому заказу со страницы мастера. Схема zod → `requireUser("CLIENT")` первой строкой →
// лимит → модуль requests (права на заказ, группа, лимит 10, повтор — в нём). Отказы — коды с текстами экрана (`guest.ts`).

const t = ru.app.guest.executor.invite.errors;

/** 20 приглашений в час на покупателя (повтор нажатия тоже считается). */
const INVITE_RATE = { limit: 20, windowSec: 3600 };

/** Отказ модуля → тот же код с текстом экрана по `details.reason` и коду. Прочее — как есть. */
function retext(e: unknown): unknown {
  if (!isAppError(e)) return e;
  const reason = typeof e.details?.reason === "string" ? e.details.reason : null;
  const byReason: Record<string, string> = { otherSegment: t.otherSegment, selfInvite: t.selfInvite, invitationsLimit: t.limit };
  const text = reason ? byReason[reason] : undefined;
  if (text !== undefined) return new AppError(e.code, text, e.details);
  switch (e.code) {
    case "CONFLICT":
      return new AppError(e.code, t.closed);
    case "NOT_FOUND":
      return new AppError(e.code, t.notFound);
    case "VALIDATION":
      return new AppError(e.code, t.failed);
    default:
      return e;
  }
}

/**
 * «Пригласить к заказу №N». Повтор (двойное нажатие, обрыв связи) — тот же успех: `created: false`, записи, уведомления и
 * аудита второй раз нет; экран показывает то же «Приглашение отправлено».
 */
export const inviteExecutorAction = action("app.executor.invite", inviteExecutorSchema, async (input) => {
  const user = await requireUser("CLIENT");
  await enforceRateLimit(`invite:${user.id}`, INVITE_RATE, t.rateLimited);
  try {
    return await inviteExecutor(user, input);
  } catch (e) {
    throw retext(e);
  }
});
