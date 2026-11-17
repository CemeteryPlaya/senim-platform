"use server";

import { setDealShowcase, showcaseSchema } from "@/modules/deal-core";
import { requireUser } from "@/modules/identity";
import { action } from "@/platform/action";

// Выбор покупателя: что из оконченной сделки видно в профиле мастера. Схема zod, затем `requireUser("CLIENT")` первой
// строкой; «ваша сделка», «окончена с офертой» и доступность адреса проверяет модуль (deal-core). Повтор с тем же
// содержимым ничего не пишет.

/** «Сохранить»: фото, стоимость, адрес (город / район / ЖК) и подпись отзыва. */
export const saveShowcaseAction = action("app.deal.showcase", showcaseSchema, async (input) => {
  const user = await requireUser("CLIENT");
  await setDealShowcase(user, input);
});
