"use server";

import { z } from "zod";
import { ru } from "@/i18n/ru";
import { leaveReview, reviewSchema } from "@/modules/deal-core";
import { requireUser } from "@/modules/identity";
import { action } from "@/platform/action";

// Отзыв о мастере (v2): схема zod, затем `requireUser("CLIENT")` первой строкой. Флаг `reviews`, «сделка завершена»,
// «ваша сделка» и «один отзыв на сделку» (повтор и двойное нажатие — CONFLICT) проверяет модуль. Согласие на портфолио
// (флаг `dealPortfolio`) в v2 не переносится: схема принимает только оценку и текст, поле согласия здесь не передаётся.

const schema = reviewSchema.omit({ portfolioConsent: true }).extend({
  rating: z.number(ru.app.deal.review.errors.rating).int(ru.app.deal.review.errors.rating).min(1, ru.app.deal.review.errors.rating).max(5, ru.app.deal.review.errors.rating),
});

/** «Оставить отзыв»: оценка 1–5 и необязательный текст (имя мастера и контакты в нём скрывает модуль при показе). */
export const leaveReviewAction = action("app.deal.review", schema, async (input) => {
  const user = await requireUser("CLIENT");
  await leaveReview(user, input);
});
