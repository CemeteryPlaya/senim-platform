"use server";

import { ru } from "@/i18n/ru";
import { requireUser, type CurrentUser } from "@/modules/identity";
import { acceptPrice, getNegotiation, proposePrice, withdrawPrice } from "@/modules/requests";
import { action } from "@/platform/action";
import { AppError, isAppError, type ErrorCode } from "@/platform/errors";
import { acceptSchema, proposeSchema, withdrawSchema } from "./_parts/schema";

// Торг по предложению мастера (ТЗ п. 9, решение 2.2.3) — обёртки над модулем requests. Вход — zod-схема (_parts/schema.ts),
// первая строка обработчика — роль покупателя; что это сторона именно этого отклика, проверяет модуль (иначе NOT_FOUND).
// Отказы модуля — коды; текст для покупателя — из ru.app.offer.errors (в модуле тексты v1 со словом «отклик»).
// Входы «сессия истекла» и «нужно согласие» (requireUser) проходят как есть: их разбирает outcomeOf на экране.

const t = ru.app.offer.errors;

/** Отказ модуля → тот же код с текстом экрана; `field` — ошибка у поля формы. Чужие коды и не-AppError — как есть. */
function retext(e: unknown, texts: Partial<Record<ErrorCode, string>>, field?: { name: string; codes: readonly ErrorCode[] }): unknown {
  if (!isAppError(e)) return e;
  const text = texts[e.code];
  if (text === undefined) return e;
  const details = field?.codes.includes(e.code) ? { fieldErrors: { [field.name]: [text] } } : undefined;
  return new AppError(e.code, text, details);
}

/**
 * «Предложить свою цену» (и встречная на цену мастера). Своё открытое предложение сначала отзывают (FORBIDDEN), та же
 * цена, что у мастера, — не встречная (VALIDATION, у поля), торг закрыт или гонка двух встречных — CONFLICT.
 */
export const proposePriceAction = action("app.offer.proposePrice", proposeSchema, async ({ offerId, amount }) => {
  const user = await requireUser("CLIENT");
  try {
    return await proposePrice(user, { offerId, amountKzt: amount });
  } catch (e) {
    throw retext(e, { VALIDATION: t.sameAmount, FORBIDDEN: t.waitAnswer, CONFLICT: t.changed, NOT_FOUND: t.notFound }, { name: "amount", codes: ["VALIDATION"] });
  }
});

/** Сделка, если именно это предложение цены уже принято (повтор, двойное нажатие, вторая вкладка). */
async function acceptedDeal(user: CurrentUser, offerId: string, proposalId: string): Promise<{ dealId: string } | null> {
  const view = await getNegotiation(user, { offerId });
  const round = view.rounds.find((r) => r.id === proposalId);
  if (!round) throw new AppError("NOT_FOUND", t.notFound);
  return round.status === "ACCEPTED" && view.dealId ? { dealId: view.dealId } : null;
}

/**
 * «Принять цену»: принимается ровно то предложение, что было на экране (`proposalId` — сумма предложения неизменна).
 * Мастер успел заменить или отозвать его — модуль отвечает CONFLICT, сделки по устаревшей цене нет. Повтор и двойное
 * нажатие: модуль создаёт одну сделку (условные обновления), а этот обработчик отвечает на повтор той же сделкой —
 * сначала до вызова модуля (уже принято), затем после CONFLICT гонки (параллельный вызов успел первым).
 * Предложение должно принадлежать отклику `offerId` (иначе NOT_FOUND).
 */
export const acceptPriceAction = action("app.offer.acceptPrice", acceptSchema, async ({ offerId, proposalId }) => {
  const user = await requireUser("CLIENT");
  try {
    const earlier = await acceptedDeal(user, offerId, proposalId);
    if (earlier) return earlier;
    return await acceptPrice(user, { proposalId });
  } catch (e) {
    if (isAppError(e) && e.code === "CONFLICT") {
      const raced = await acceptedDeal(user, offerId, proposalId).catch(() => null);
      if (raced) return raced;
    }
    // FORBIDDEN — своё предложение: на экране такой кнопки нет, значит экран устарел.
    throw retext(e, { CONFLICT: t.changed, FORBIDDEN: t.changed, NOT_FOUND: t.notFound });
  }
});

/** «Отозвать предложение»: только своё открытое (чужое — FORBIDDEN), уже решённое — CONFLICT. */
export const withdrawPriceAction = action("app.offer.withdrawPrice", withdrawSchema, async ({ proposalId }) => {
  const user = await requireUser("CLIENT");
  try {
    await withdrawPrice(user, { proposalId });
  } catch (e) {
    throw retext(e, { FORBIDDEN: t.notYours, CONFLICT: t.changed, NOT_FOUND: t.notFound });
  }
});
