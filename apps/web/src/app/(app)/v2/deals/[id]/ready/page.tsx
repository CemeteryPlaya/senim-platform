import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { ru } from "@/i18n/ru";
import { Narrow, PageTitle, Stack } from "@/kit";
import { getDevice } from "@/platform/device";
import { pageHref, partyDeal, requireV2User } from "../../../../_shell/auth";
import { dealHrefs } from "../_parts/deal-card";
import { ReadyForm } from "./ReadyForm";

const t = ru.app.masterSteps.ready;

export const metadata: Metadata = { title: t.metaTitle };

type Props = { params: Promise<{ id: string }>; searchParams: Promise<Record<string, string | string[] | undefined>> };

/**
 * Сдача работы мастером. Ворота — `partyDeal`; сейчас не шаг мастера «Сдать работу» (покупатель, работа ещё не начата или
 * уже сдана, спор) — карточка сделки без ошибки. Порядок: «Назад: <сделка>», подзаголовок — что будет после, фото готовой мебели, место
 * сдачи с пояснением, одно главное действие «Сдать работу». Компьютер — `Narrow`.
 */
export default async function ReadyPage({ params, searchParams }: Props) {
  const { id } = await params;
  const sp = await searchParams;
  const here = pageHref(`/deals/${encodeURIComponent(id)}/ready`, sp);
  const user = await requireV2User(here);
  const { deal, side } = await partyDeal(user, id, { here });
  const card = dealHrefs(deal.id).card;
  if (side !== "EXECUTOR" || deal.next.action !== "submitReady" || !deal.next.mine) redirect(card);
  const device = await getDevice();

  return (
    <Narrow>
      <Stack gap="section">
        <PageTitle title={t.title} back={{ href: card, label: deal.title }} lead={t.lead} />
        <ReadyForm dealId={deal.id} dealHref={card} device={device} />
      </Stack>
    </Narrow>
  );
}
