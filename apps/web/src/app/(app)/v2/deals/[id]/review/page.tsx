import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { ru } from "@/i18n/ru";
import { pageHref } from "../../../../_shell/auth";
import { dealHrefs } from "../_parts/deal-card";
import { buyerDeal } from "../_parts/gate";
import { ReviewForm } from "./ReviewForm";

export const metadata: Metadata = { title: ru.app.deal.review.metaTitle };

type Props = { params: Promise<{ id: string }>; searchParams: Promise<Record<string, string | string[] | undefined>> };

/**
 * Отзыв о мастере. Форма — только когда модуль говорит «оставьте отзыв» покупателю (`next`: флаг `reviews` включён, сделка
 * завершена, отзыва ещё нет); иначе (флаг выключен, отзыв уже есть, сделка не завершена) — карточка сделки.
 * Чужая и несуществующая сделка — 404 (`buyerDeal`).
 */
export default async function ReviewPage({ params, searchParams }: Props) {
  const { id } = await params;
  const sp = await searchParams;
  const { deal } = await buyerDeal(pageHref(`/deals/${encodeURIComponent(id)}/review`, sp), id);
  const hrefs = dealHrefs(deal.id);
  if (deal.next.action !== "leaveReview" || !deal.next.mine) redirect(hrefs.card);
  return <ReviewForm dealId={deal.id} dealTitle={deal.title} number={deal.number} backHref={hrefs.card} />;
}
