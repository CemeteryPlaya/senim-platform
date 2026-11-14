import "server-only";
import { redirect } from "next/navigation";
import { dealPartyOf, type DealView } from "@/modules/deal-core";
import type { CurrentUser } from "@/modules/identity";
import { dealOrSwitch, requireBuyer, requireV2User } from "../../../../_shell/auth";
import { legacy } from "../../../../_shell/paths";
import { dealHrefs } from "./deal-card";

/**
 * Ворота экранов сделки покупателя. Экран v2 есть только у покупателя (мастер — этап 4, оператор — этап 5), поэтому:
 * - вошедший в роли оператора — в v1 (права там проверит модуль: чужое — 404);
 * - вошедший в роли мастера, который в этой сделке мастер, — тоже в v1 (иначе `requireBuyer` переключил бы его на роль
 *   заказчика, а `dealOrSwitch` — обратно на мастера: петля);
 * - остальные — `requireBuyer` (гость — вход, роль заказчика выдана, но не активна — переключение, нет — дом) и
 *   `dealOrSwitch` (своя — экран; сторона в другой выданной роли — переключение роли; чужая и несуществующая — 404).
 * В v1 уходят на карточку сделки: экранов спора, отзыва, подписи и оплаты там нет (подпись, оплата, спор и отзыв — на
 * экране сделки), поэтому тот же адрес дал бы 404. Исключение — `legacyAt: "same"`: экран есть и в v1 под тем же
 * адресом (история денег — `/deals/<id>/money`). `here` — адрес этой страницы v2 (с параметрами).
 */
export async function buyerDeal(
  here: string,
  dealId: string,
  { legacyAt = "card" }: { legacyAt?: "card" | "same" } = {},
): Promise<{ user: CurrentUser; deal: DealView }> {
  const signedIn = await requireV2User(here);
  const v1 = legacy(legacyAt === "same" ? here : dealHrefs(dealId).card);
  if (signedIn.role === "OPERATOR") redirect(v1);
  if (signedIn.role === "EXECUTOR" && (await dealPartyOf(signedIn, dealId)) === "EXECUTOR") redirect(v1);
  const user = await requireBuyer(here);
  return { user, deal: await dealOrSwitch(user, dealId) };
}
