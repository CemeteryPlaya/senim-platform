import "server-only";
import { cache } from "react";
import type { CurrentUser } from "@/modules/identity";
import { partyDeal } from "../../../../_shell/auth";

/**
 * `partyDeal` один раз на запрос (React `cache`): ворота карточки (layout.tsx) читают сделку до каркаса, страница берёт
 * то же прочитанное, а не читает второй раз. Ключ — тот же объект пользователя (`getCurrentUser` тоже под `cache`) и id;
 * отказ (404, переключение роли) запоминается так же — страница его уже не увидит, его бросили ворота.
 */
export const partyDealOnce = cache((user: CurrentUser, dealId: string) => partyDeal(user, dealId));
