import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { ru } from "@/i18n/ru";
import { getDealShowcase, isEndedSigned } from "@/modules/deal-core";
import { getDevice } from "@/platform/device";
import { pageHref } from "../../../../_shell/auth";
import { dealHrefs } from "../_parts/deal-card";
import { buyerDeal } from "../_parts/gate";
import { ShowcaseForm } from "./_parts/ShowcaseForm";

export const metadata: Metadata = { title: ru.app.deal.showcase.metaTitle };

type Props = { params: Promise<{ id: string }>; searchParams: Promise<Record<string, string | string[] | undefined>> };

/**
 * Выбор покупателя: что из сделки видно в профиле мастера. Только покупатель оконченной сделки с офертой (иначе —
 * карточка сделки); чужая и несуществующая — 404 (`buyerDeal`). Варианты адреса — только те, что есть в заявке.
 */
export default async function ShowcasePage({ params, searchParams }: Props) {
  const { id } = await params;
  const sp = await searchParams;
  const { user, deal } = await buyerDeal(pageHref(`/deals/${encodeURIComponent(id)}/showcase`, sp), id);
  const hrefs = dealHrefs(deal.id);
  if (!isEndedSigned({ status: deal.status, signedAt: deal.dates.signedAt })) redirect(hrefs.card);
  const view = await getDealShowcase(user, deal.id);
  if (!view.changeable) redirect(hrefs.card);
  return (
    <ShowcaseForm
      dealId={deal.id}
      dealTitle={deal.title}
      backHref={hrefs.card}
      initial={{ photos: view.photos, price: view.price, address: view.address, signature: view.signature }}
      addressOptions={view.addressOptions}
      device={await getDevice()}
    />
  );
}
