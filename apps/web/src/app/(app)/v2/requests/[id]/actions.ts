"use server";

import { redirect } from "next/navigation";
import { z } from "zod";
import { requireUser } from "@/modules/identity";
import { cancelRequest, cancelRequestSchema, OFFER_SORTS, type OfferSort } from "@/modules/requests";
import { action } from "@/platform/action";
import { sortHref } from "./_parts/card-view";

// Действия карточки заявки покупателя (v2). Свои обёртки над теми же функциями модуля, что и в v1: схема zod,
// затем `requireUser("CLIENT")` первой строкой; права на конкретную заявку проверяет модуль.

/** Отмена заявки; повтор (двойное нажатие, вторая вкладка) модуль отвечает CONFLICT: эффект один. */
export const cancelRequestAction = action("requests.card.cancel", cancelRequestSchema, async (input) => {
  const user = await requireUser("CLIENT");
  await cancelRequest(user, input);
});

const sortSchema = z.strictObject({ requestId: cancelRequestSchema.shape.requestId, sort: z.enum(OFFER_SORTS) });

const sortRedirect = action("requests.card.sort", sortSchema, async ({ requestId, sort }) => {
  await requireUser("CLIENT");
  redirect(sortHref(requestId, sort));
});

/**
 * Выбор сортировки предложений: сегмент переключателя — кнопка формы (`bind(null, заявка, сортировка)`; вторым
 * аргументом приходит FormData формы, он не нужен). Сортировка живёт в адресе (`?sort=`) — ссылкой можно поделиться,
 * «Назад» возвращает к прежнему порядку.
 */
export async function chooseOfferSort(requestId: string, sort: OfferSort): Promise<void> {
  await sortRedirect({ requestId, sort });
}
