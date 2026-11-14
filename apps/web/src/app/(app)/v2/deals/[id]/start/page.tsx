import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { formatDays } from "@/features/format/format";
import { ru } from "@/i18n/ru";
import { Card, List, ListRow, Narrow, NowNext, PageTitle, Section, Stack } from "@/kit";
import { getDevice } from "@/platform/device";
import { pageHref, partyDeal, requireV2User } from "../../../../_shell/auth";
import { dealHrefs } from "../_parts/deal-card";
import { StartButton } from "./StartButton";

const t = ru.app.masterSteps.start;

export const metadata: Metadata = { title: t.metaTitle };

type Props = { params: Promise<{ id: string }>; searchParams: Promise<Record<string, string | string[] | undefined>> };

/**
 * «Начать работу» мастером. Ворота — `partyDeal` (сторона в активной роли; в другой своей роли — переключение с возвратом
 * сюда; оператор — v1; чужая — 404). Сейчас не шаг мастера «Начать работу» (покупатель, оплата ещё не в банке, работа уже
 * идёт, спор) — карточка сделки без ошибки. Порядок: «Назад: <сделка>», «Сейчас / Дальше», что изменится (срок по оферте и
 * последствия), одно главное действие с подтверждением. Компьютер — `Narrow`.
 */
export default async function StartPage({ params, searchParams }: Props) {
  const { id } = await params;
  const sp = await searchParams;
  const here = pageHref(`/deals/${encodeURIComponent(id)}/start`, sp);
  const user = await requireV2User(here);
  const { deal, side } = await partyDeal(user, id, { here });
  const card = dealHrefs(deal.id).card;
  if (side !== "EXECUTOR" || deal.next.action !== "startWork" || !deal.next.mine) redirect(card);
  const device = await getDevice();
  const days = formatDays(deal.durationDays);

  return (
    <Narrow>
      <Stack gap="section">
        <PageTitle title={t.title} back={{ href: card, label: deal.title }} />
        <NowNext now={t.now} next={t.next} />
        <Section title={t.section}>
          <Card padded={false}>
            <List>
              <ListRow label={t.duration} value={days} />
            </List>
          </Card>
          <Card>
            <ul className="flex list-disc flex-col gap-2 pl-6 text-body text-ink marker:text-muted">
              {t.points.map((point) => (
                <li key={point}>{point}</li>
              ))}
            </ul>
          </Card>
        </Section>
        <StartButton dealId={deal.id} dealHref={card} days={days} device={device} />
      </Stack>
    </Narrow>
  );
}
