"use server";

import { z } from "zod";
import { ru } from "@/i18n/ru";
import { leaveReview, reviewSchema, setDealShowcase, showcaseSchema } from "@/modules/deal-core";
import { requireUser } from "@/modules/identity";
import { action } from "@/platform/action";
import { isAppError } from "@/platform/errors";

// Отзыв о мастере (v2): схема zod, затем `requireUser("CLIENT")` первой строкой. Флаг `reviews`, «сделка завершена»,
// «ваша сделка» и «один отзыв на сделку» проверяет модуль. Согласие на портфолио (флаг `dealPortfolio`) в v2 не
// переносится: схема не принимает поле согласия. Выбор «что видно в профиле мастера» (необязательный) уходит той же
// отправкой, но отдельной транзакцией: сначала отзыв, затем выбор (идемпотентен по содержимому). С `clientKey` повтор
// отправки, когда отзыв уже записан (обрыв связи между двумя записями), не падает, а доводит до сохранения выбора.

const schema = reviewSchema.omit({ portfolioConsent: true }).extend({
  rating: z.number(ru.app.deal.review.errors.rating).int(ru.app.deal.review.errors.rating).min(1, ru.app.deal.review.errors.rating).max(5, ru.app.deal.review.errors.rating),
  showcase: showcaseSchema.omit({ dealId: true, clientKey: true }).optional(),
  clientKey: z.uuid().optional(),
});

/** «Оставить отзыв»: оценка 1–5, необязательный текст и выбор показа (имя мастера и контакты в тексте скрывает модуль при показе). */
export const leaveReviewAction = action("app.deal.review", schema, async ({ showcase, clientKey, ...review }) => {
  const user = await requireUser("CLIENT");
  try {
    await leaveReview(user, review);
  } catch (error) {
    const replay = clientKey !== undefined && showcase !== undefined && isAppError(error) && error.code === "CONFLICT" && error.message === ru.deal.errors.reviewExists;
    if (!replay) throw error;
  }
  if (showcase) await setDealShowcase(user, { ...showcase, dealId: review.dealId, ...(clientKey ? { clientKey } : {}) });
});
