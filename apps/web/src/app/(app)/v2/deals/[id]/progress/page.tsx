import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { ru } from "@/i18n/ru";
import { Narrow, NowNext, PageTitle, Stack } from "@/kit";
import { getDevice } from "@/platform/device";
import { pageHref, partyDeal, requireV2User } from "../../../../_shell/auth";
import { dealHrefs } from "../_parts/deal-card";
import { ProgressForm } from "./ProgressForm";

const t = ru.app.masterSteps.progress;

export const metadata: Metadata = { title: t.metaTitle };

type Props = { params: Promise<{ id: string }>; searchParams: Promise<Record<string, string | string[] | undefined>> };

/**
 * Отчёт о ходе работ мастера. Ворота — `partyDeal`; отчёт можно добавить, пока идут работы (`can.addProgress` модуля) —
 * иначе (покупатель, до начала работ, спор, сделка закрыта) карточка сделки без ошибки. Порядок: «Назад: <сделка>»,
 * «Сейчас / Дальше», форма отчёта, одно главное действие. Компьютер — `Narrow`.
 */
export default async function ProgressPage({ params, searchParams }: Props) {
  const { id } = await params;
  const sp = await searchParams;
  const here = pageHref(`/deals/${encodeURIComponent(id)}/progress`, sp);
  const user = await requireV2User(here);
  const { deal, side } = await partyDeal(user, id, { here });
  const card = dealHrefs(deal.id).card;
  if (side !== "EXECUTOR" || !deal.can.addProgress) redirect(card);

  return (
    <Narrow>
      <Stack gap="section">
        <PageTitle title={t.title} back={{ href: card, label: deal.title }} />
        <NowNext now={t.now} next={t.next} />
        <ProgressForm dealId={deal.id} dealHref={card} device={await getDevice()} />
      </Stack>
    </Narrow>
  );
}
