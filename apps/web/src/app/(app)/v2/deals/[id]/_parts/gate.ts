import "server-only";
import { redirect } from "next/navigation";
import { dealPartyOf, type DealView } from "@/modules/deal-core";
import type { CurrentUser } from "@/modules/identity";
import { dealOrSwitch, requireBuyer, requireV2User } from "../../../../_shell/auth";
import { to } from "../../../../_shell/paths";
import { dealHrefs } from "./deal-card";

/**
 * Ворота экранов сделки только покупателя (оплата, отзыв). Экраны, общие для сторон (карточка, подпись, спор, история
 * денег), берут сделку через `partyDeal` из `_shell/auth.ts` (сделка и сторона в активной роли). Здесь:
 * - вошедший в роли оператора — на свою карточку сделки v2 (`/v2/operator/deals/<id>`): оплаты, отзыва, подписи и спора
 *   у оператора нет, всё нужное ему — на карточке (права там проверит модуль: чужое — 404);
 * - вошедший в роли мастера, который в этой сделке мастер, — на карточку сделки v2 (иначе `requireBuyer` переключил бы его
 *   на роль заказчика, а `dealOrSwitch` — обратно на мастера: петля);
 * - остальные — `requireBuyer` (гость — вход, роль заказчика выдана, но не активна — переключение, нет — дом) и
 *   `dealOrSwitch` (своя — экран; сторона в другой выданной роли — переключение роли; чужая и несуществующая — 404).
 * `here` — адрес этой страницы v2 (с параметрами).
 */
export async function buyerDeal(here: string, dealId: string): Promise<{ user: CurrentUser; deal: DealView }> {
  const signedIn = await requireV2User(here);
  if (signedIn.role === "OPERATOR") redirect(to(`/operator/deals/${encodeURIComponent(dealId)}`));
  if (signedIn.role === "EXECUTOR" && (await dealPartyOf(signedIn, dealId)) === "EXECUTOR") redirect(dealHrefs(dealId).card);
  const user = await requireBuyer(here);
  return { user, deal: await dealOrSwitch(user, dealId) };
}
