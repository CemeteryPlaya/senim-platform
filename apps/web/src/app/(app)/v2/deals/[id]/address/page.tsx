import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { ru } from "@/i18n/ru";
import { getDealAddress } from "@/modules/requests";
import { getDevice } from "@/platform/device";
import { pageHref } from "../../../../_shell/auth";
import { dealEnded, dealHrefs } from "../_parts/deal-card";
import { buyerDeal } from "../_parts/gate";
import { AddressForm } from "./_parts/AddressForm";

export const metadata: Metadata = { title: ru.app.deal.address.metaTitle };

type Props = { params: Promise<{ id: string }>; searchParams: Promise<Record<string, string | string[] | undefined>> };

/**
 * Адрес сделки (ADR-016): указывает покупатель, пока сделка не окончена (оконченная — на карточку сделки); мастер видит его
 * после заключения оферты. Чужая и несуществующая сделка — 404, мастер сделки — на карточку (`buyerDeal`).
 */
export default async function DealAddressPage({ params, searchParams }: Props) {
  const { id } = await params;
  const sp = await searchParams;
  const { user, deal } = await buyerDeal(pageHref(`/deals/${encodeURIComponent(id)}/address`, sp), id);
  const hrefs = dealHrefs(deal.id);
  if (dealEnded(deal.status)) redirect(hrefs.card);
  const saved = await getDealAddress(user, deal.id);
  return (
    <AddressForm
      dealId={deal.id}
      dealTitle={deal.title}
      backHref={hrefs.card}
      city={deal.subject.city ?? ""}
      initial={{ address: saved.address ?? "", location: saved.location }}
      device={await getDevice()}
    />
  );
}
