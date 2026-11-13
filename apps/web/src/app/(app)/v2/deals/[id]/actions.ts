"use server";

import { cancelDeal, cancelDealSchema } from "@/modules/deal-core";
import { requireUser } from "@/modules/identity";
import { action } from "@/platform/action";

// Действия карточки сделки покупателя (v2). Свои обёртки над теми же функциями модуля, что и в v1: схема zod, затем
// `requireUser("CLIENT")` первой строкой; права на сделку, допустимость перехода и повтор проверяет модуль (чужая — «не
// найдено», повтор — CONFLICT: эффект один).

/** Отмена сделки: до оплаты — отмена (`CANCELLED`); после оплаты — возврат на карту (`REFUND_REQUESTED`). */
export const cancelDealAction = action("deals.card.cancel", cancelDealSchema, async (input) => {
  const user = await requireUser("CLIENT");
  return cancelDeal(user, input);
});
