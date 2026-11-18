"use server";

import { ru } from "@/i18n/ru";
import { requireUser, type CurrentUser } from "@/modules/identity";
import { acceptPrice, declineInvitation, getIncomingRequest, getNegotiation, listMyOffers, proposePrice, sendOffer, withdrawOffer, withdrawPrice } from "@/modules/requests";
import { kztToTiyn } from "@/modules/payments";
import { action } from "@/platform/action";
import { AppError, isAppError, type ErrorCode } from "@/platform/errors";
import { acceptSchema, declineSchema, proposeSchema, sendSchema, withdrawOfferSchema, withdrawPriceSchema } from "./_parts/schema";

// Предложение мастера и торг (ТЗ п. 9, решение 2.2.3) — обёртки v2 над модулем requests (действия v1 в (legacy) не
// меняются). Вход — zod-схема (_parts/schema.ts), первая строка обработчика — роль мастера; что мастер одобрен, видит
// заявку и что это его предложение, проверяет модуль (иначе FORBIDDEN `notApproved` или NOT_FOUND). Отказы модуля — коды;
// текст для мастера — из ru.app.masterOffer.errors (в модуле тексты v1 со словом «отклик»). Входы «сессия истекла» и
// «нужно согласие» (requireUser) проходят как есть: их разбирает outcomeOf на экране.

const t = ru.app.masterOffer.errors;

/** Отказ модуля → тот же код с текстом экрана; `field` — ошибка у поля формы. Чужие коды и не-AppError — как есть. */
function retext(e: unknown, texts: Partial<Record<ErrorCode, string>>, field?: { name: string; codes: readonly ErrorCode[] }): unknown {
  if (!isAppError(e)) return e;
  // Мастер не одобрен (снято одобрение, пока экран был открыт) — модуль отличает этот FORBIDDEN только текстом.
  if (e.code === "FORBIDDEN" && e.message === ru.requests.errors.notApproved) return new AppError(e.code, t.notApproved);
  const text = texts[e.code];
  if (text === undefined) return e;
  const details = field?.codes.includes(e.code) ? { fieldErrors: { [field.name]: [text] } } : undefined;
  return new AppError(e.code, text, details);
}

type SendInput = { requestId: string; price: number; days: number; warranty: number; comment: string };

/**
 * Своё предложение по заявке уже есть с теми же ценой, сроком и гарантией (повтор после обрыва связи, вторая вкладка) — тот
 * же ответ, что у первой отправки. Иначе — `null`. Комментарий не сравнивается: модуль маскирует в нём контакты, и повтор
 * с телефоном в тексте иначе выглядел бы другим предложением.
 */
async function sameOffer(user: CurrentUser, input: SendInput): Promise<{ offerId: string } | null> {
  const r = await getIncomingRequest(user, input.requestId);
  const mine = r.myOffer;
  if (!mine || mine.status !== "SENT" || r.canOffer) return null;
  const same =
    mine.priceTiyn === kztToTiyn(input.price) &&
    mine.durationDays === input.days &&
    mine.warrantyMonths === input.warranty;
  return same ? { offerId: mine.id } : null;
}

/**
 * «Отправить предложение»: цена (первое предложение торга), срок, гарантия, комментарий. Условия замера не передаются —
 * модуль берёт их из профиля (сценарии до оферты в v2 не переносятся). Двойное нажатие гасит форма; повтор с теми же
 * условиями после того, как первое дошло (модуль отвечает CONFLICT «уже отправлено»), — тот же ответ, второго предложения
 * нет. Заявка закрылась или скрыта от мастера — NOT_FOUND; мастер не одобрен — FORBIDDEN.
 */
export const sendOfferAction = action("app.masterOffer.send", sendSchema, async (input) => {
  const user = await requireUser("EXECUTOR");
  try {
    return await sendOffer(user, {
      requestId: input.requestId,
      priceKzt: input.price,
      durationDays: input.days,
      warrantyMonths: input.warranty,
      comment: input.comment,
    });
  } catch (e) {
    if (isAppError(e) && e.code === "CONFLICT") {
      const earlier = await sameOffer(user, input).catch(() => null);
      if (earlier) return earlier;
    }
    throw retext(e, { CONFLICT: t.alreadySent, NOT_FOUND: t.unavailable, FORBIDDEN: t.notApproved, VALIDATION: t.sendFailed });
  }
});

/**
 * «Отказаться от заявки» — отозвать предложение целиком: только своё и только пока заявка открыта и торг идёт. Повтор
 * (двойное нажатие, вторая вкладка), когда предложение уже отозвано этим мастером, — тот же ответ `ok`; иначе CONFLICT
 * «экран устарел» (покупатель успел принять цену или закрыть заявку).
 */
export const withdrawOfferAction = action("app.masterOffer.withdrawOffer", withdrawOfferSchema, async ({ offerId }) => {
  const user = await requireUser("EXECUTOR");
  try {
    await withdrawOffer(user, { offerId });
  } catch (e) {
    if (isAppError(e) && e.code === "CONFLICT") {
      const mine = await listMyOffers(user).catch(() => []);
      if (mine.some((o) => o.id === offerId && o.status === "WITHDRAWN")) return;
    }
    throw retext(e, { CONFLICT: t.changed, NOT_FOUND: t.notFound, FORBIDDEN: t.notApproved });
  }
});

/**
 * «Предложить свою цену» (встречная на цену покупателя или новая после отзыва). Своё открытое предложение сначала
 * отзывают (FORBIDDEN), та же цена, что у покупателя, — не встречная (VALIDATION с текстом sameAmount модуля, у поля),
 * торг закрыт или гонка двух встречных — CONFLICT.
 */
export const proposePriceAction = action("app.masterOffer.proposePrice", proposeSchema, async ({ offerId, amount }) => {
  const user = await requireUser("EXECUTOR");
  try {
    return await proposePrice(user, { offerId, amountKzt: amount });
  } catch (e) {
    // «Та же цена» модуль отличает только текстом отказа (ru.requests.errors.sameAmount); прочие отказы проверки — общий текст.
    const same = isAppError(e) && e.code === "VALIDATION" && e.message === ru.requests.errors.sameAmount;
    throw retext(
      e,
      { VALIDATION: same ? t.sameAmount : t.proposeFailed, FORBIDDEN: t.waitAnswer, CONFLICT: t.changed, NOT_FOUND: t.notFound },
      { name: "amount", codes: ["VALIDATION"] },
    );
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
 * «Принять цену покупателя»: принимается ровно то предложение, что было на экране (`proposalId` — сумма неизменна).
 * Покупатель успел заменить или отозвать его — модуль отвечает CONFLICT, сделки по устаревшей цене нет. Повтор и двойное
 * нажатие: модуль создаёт одну сделку (условные обновления), а этот обработчик отвечает на повтор той же сделкой —
 * сначала до вызова модуля (уже принято), затем после CONFLICT гонки. Предложение цены должно принадлежать предложению
 * мастера `offerId` (иначе NOT_FOUND).
 */
export const acceptPriceAction = action("app.masterOffer.acceptPrice", acceptSchema, async ({ offerId, proposalId }) => {
  const user = await requireUser("EXECUTOR");
  try {
    const earlier = await acceptedDeal(user, offerId, proposalId);
    if (earlier) return earlier;
    return await acceptPrice(user, { proposalId });
  } catch (e) {
    if (isAppError(e) && e.code === "CONFLICT") {
      const raced = await acceptedDeal(user, offerId, proposalId).catch(() => null);
      if (raced) return raced;
    }
    // FORBIDDEN — своя цена: на экране такой кнопки нет, значит экран устарел.
    throw retext(e, { CONFLICT: t.changed, FORBIDDEN: t.changed, NOT_FOUND: t.notFound });
  }
});

/**
 * «Отозвать мою цену»: только свою открытую (чужую — FORBIDDEN). Повтор, когда эта своя цена уже отозвана, — тот же ответ
 * `ok`; цену успели принять или торг закрыт — CONFLICT. Цена должна принадлежать предложению `offerId` (иначе NOT_FOUND).
 */
export const withdrawPriceAction = action("app.masterOffer.withdrawPrice", withdrawPriceSchema, async ({ offerId, proposalId }) => {
  const user = await requireUser("EXECUTOR");
  try {
    await withdrawPrice(user, { proposalId });
  } catch (e) {
    if (isAppError(e) && e.code === "CONFLICT") {
      const view = await getNegotiation(user, { offerId }).catch(() => null);
      if (view?.rounds.some((r) => r.id === proposalId && r.mine && r.status === "WITHDRAWN")) return;
    }
    throw retext(e, { FORBIDDEN: t.notYours, CONFLICT: t.changed, NOT_FOUND: t.notFound });
  }
});

/**
 * «Отказаться от приглашения» с причиной (3..300 знаков; короткая — ошибка у поля, схема). Отказ окончателен: повтор —
 * CONFLICT «уже ответили»; приглашения нет — NOT_FOUND; мастер не одобрен — FORBIDDEN. Предложение по заявке отказ не
 * закрывает: заявка видна мастеру как прежде.
 */
export const declineInvitationAction = action("app.masterOffer.declineInvitation", declineSchema, async (input) => {
  const user = await requireUser("EXECUTOR");
  try {
    await declineInvitation(user, input);
  } catch (e) {
    throw retext(
      e,
      { VALIDATION: t.declineReason, CONFLICT: t.declineDecided, NOT_FOUND: t.declineNotFound, FORBIDDEN: t.notApproved },
      { name: "reason", codes: ["VALIDATION"] },
    );
  }
});
