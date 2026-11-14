import "server-only";
import { redirect } from "next/navigation";
import { dealPartyOf, type DealView } from "@/modules/deal-core";
import type { CurrentUser } from "@/modules/identity";
import { dealOrSwitch, requireBuyer, requireV2User } from "../../../../../_shell/auth";
import { legacy, to } from "../../../../../_shell/paths";

/** Адрес карточки сделки v2. */
export const dealCardHref = (dealId: string): string => to(`/deals/${encodeURIComponent(dealId)}`);

/**
 * Ворота экранов шага сделки покупателя (подпись документа, оплата). То же, что у карточки (`buyerDeal`), но вошедший в
 * роли оператора или мастер этой сделки уходит на карточку сделки в v1, а не на тот же адрес в v1: экранов
 * `/deals/<id>/sign/…` и `/deals/<id>/pay` в v1 нет (там подпись и оплата — на экране сделки). Остальные — `requireBuyer`
 * (гость — вход с возвратом сюда) и `dealOrSwitch` (своя — экран; сторона в другой роли — переключение; чужая — 404).
 * `here` — адрес этой страницы v2 (с параметрами).
 */
export async function buyerDealStep(here: string, dealId: string): Promise<{ user: CurrentUser; deal: DealView }> {
  const signedIn = await requireV2User(here);
  if (signedIn.role === "OPERATOR") redirect(legacy(dealCardHref(dealId)));
  if (signedIn.role === "EXECUTOR" && (await dealPartyOf(signedIn, dealId)) === "EXECUTOR") redirect(legacy(dealCardHref(dealId)));
  const user = await requireBuyer(here);
  return { user, deal: await dealOrSwitch(user, dealId) };
}
