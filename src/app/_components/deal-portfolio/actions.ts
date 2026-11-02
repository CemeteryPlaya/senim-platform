"use server";

import { consentSchema, setPortfolioConsent } from "@/modules/companies";
import { requireUser } from "@/modules/identity";
import { action } from "@/platform/action";

/** Согласие заказчика показать фото мебели в портфолио исполнителя (или его отзыв). Сделку проверяет companies. */
export const setPortfolioConsentAction = action("companies.setPortfolioConsent", consentSchema, async (input) => {
  const user = await requireUser("CLIENT");
  return setPortfolioConsent(user, input);
});
