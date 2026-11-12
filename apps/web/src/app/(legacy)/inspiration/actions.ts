"use server";

import { featuredSchema, setPortfolioFeatured } from "@/modules/companies";
import { requireUser } from "@/modules/identity";
import { action } from "@/platform/action";

/** «В подборку» / «Убрать из подборки» на карточке «Вдохновения» — только оператор. */
export const setFeaturedAction = action("companies.setPortfolioFeatured", featuredSchema, async (input) => {
  const user = await requireUser("OPERATOR");
  await setPortfolioFeatured(user, input);
  return null;
});
