import "server-only";
import { redirect } from "next/navigation";
import { dealPartyOf, type DealView } from "@/modules/deal-core";
import type { CurrentUser } from "@/modules/identity";
import { dealOrSwitch, requireBuyer, requireV2User } from "../../../../_shell/auth";
import { legacy } from "../../../../_shell/paths";

/**
 * Ворота карточки сделки покупателя. Экран v2 есть только у покупателя (мастер — этап 4, оператор — этап 5), поэтому:
 * - вошедший в роли оператора — на экран этой сделки в v1 (права там проверит модуль: чужое — 404);
 * - вошедший в роли мастера, который в этой сделке мастер, — тоже на экран v1 (иначе `requireBuyer` переключил бы его на роль
 *   заказчика, а `dealOrSwitch` — обратно на мастера: петля);
 * - остальные — `requireBuyer` (гость — вход, роль заказчика выдана, но не активна — переключение, нет — дом) и
 *   `dealOrSwitch` (своя — экран; сторона в другой выданной роли — переключение роли; чужая и несуществующая — 404).
 * `here` — адрес этой страницы v2 (с параметрами).
 */
export async function buyerDeal(here: string, dealId: string): Promise<{ user: CurrentUser; deal: DealView }> {
  const signedIn = await requireV2User(here);
  if (signedIn.role === "OPERATOR") redirect(legacy(here));
  if (signedIn.role === "EXECUTOR" && (await dealPartyOf(signedIn, dealId)) === "EXECUTOR") redirect(legacy(here));
  const user = await requireBuyer(here);
  return { user, deal: await dealOrSwitch(user, dealId) };
}
