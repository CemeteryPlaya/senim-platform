import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { ru } from "@/i18n/ru";
import { disputePhotos } from "@/modules/deal-core";
import { getDevice } from "@/platform/device";
import { pageHref, partyDeal, requireV2User } from "../../../../_shell/auth";
import { dealHrefs } from "../_parts/deal-card";
import { DisputeForm } from "./DisputeForm";
import { OpenState, ResolvedState } from "./DisputeStates";
import { disputeScreen } from "./dispute-view";

export const metadata: Metadata = { title: ru.app.deal.dispute.metaTitle };

type Props = { params: Promise<{ id: string }>; searchParams: Promise<Record<string, string | string[] | undefined>> };

/**
 * Спор по сделке стороны (покупатель или мастер в активной роли; тексты — по стороне). Экран по состоянию: нет спора и модуль разрешает открыть — форма; спор открыт — его
 * состояние (и форма позиции, если своей нет); решён — итог и деньги; открыть нельзя и спора нет — карточка сделки.
 * Ворота — `partyDeal`: сторона в другой своей роли — переключение роли с возвратом сюда, оператор — карточка v1, чужая
 * и несуществующая сделка — 404.
 */
export default async function DisputePage({ params, searchParams }: Props) {
  const { id } = await params;
  const sp = await searchParams;
  const here = pageHref(`/deals/${encodeURIComponent(id)}/dispute`, sp);
  const user = await requireV2User(here);
  const { deal, side } = await partyDeal(user, id, { here });
  const hrefs = dealHrefs(deal.id);
  const screen = disputeScreen(deal.dispute, deal.can.openDispute);
  if (screen === "back") redirect(hrefs.card);
  if (screen === "form") return <DisputeForm dealId={deal.id} side={side} dealTitle={deal.title} backHref={hrefs.card} device={await getDevice()} />;
  if (!deal.dispute) redirect(hrefs.card);
  return screen === "open" ? <OpenState deal={deal} side={side} dispute={deal.dispute} photos={await disputePhotos(user, deal.id)} /> : <ResolvedState deal={deal} side={side} dispute={deal.dispute} />;
}
