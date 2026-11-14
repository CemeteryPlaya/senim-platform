import type { Metadata } from "next";
import { ru } from "@/i18n/ru";
import { Card, Chips, EmptyState, List, ListRow, Money, Narrow, PageTitle, Stack, StatusChip, TextLink } from "@/kit";
import { listMyOffers } from "@/modules/requests";
import { getDevice } from "@/platform/device";
import { pageHref, requireMaster } from "../../../_shell/auth";
import { to } from "../../../_shell/paths";
import { readForMaster } from "../_parts/approved";
import { MasterGate } from "../_parts/MasterGate";
import { offersView, type OfferCardView, type OffersView } from "../_parts/offers-view";

const t = ru.app.masterRequests.offers;

export const metadata: Metadata = { title: t.metaTitle };

type Props = { searchParams: Promise<Record<string, string | string[] | undefined>> };

/** Строка предложения — ссылка: заявка, статус, цена («Ваша цена» — сумма из предложения) и сведения. */
function OfferRow({ card }: { card: OfferCardView }) {
  return (
    <ListRow
      href={card.href}
      label={
        <span className="flex flex-col items-start gap-1">
          <span className="text-card wrap-break-word text-ink">{card.title}</span>
          <StatusChip tone={card.status.tone}>{card.status.text}</StatusChip>
          <span className="text-body text-ink">
            <span className="text-sub text-muted">{t.card.price}: </span>
            <Money tiyn={card.priceTiyn} />
          </span>
          <span className="text-sub text-muted">{card.meta.join(" · ")}</span>
        </span>
      }
    />
  );
}

function Offers({ view }: { view: OffersView }) {
  return (
    <Stack>
      <Chips label={t.chipsLabel} items={view.chips} />
      {view.empty === "filter" ? (
        <Stack gap="tight">
          <EmptyState title={t.emptyFilter.title} body={t.emptyFilter.body} />
          <TextLink href={to("/executor/offers")}>{t.emptyFilter.showAll}</TextLink>
        </Stack>
      ) : (
        <Card padded={false}>
          <List>
            {view.cards.map((card) => (
              <OfferRow key={card.id} card={card} />
            ))}
          </List>
        </Card>
      )}
    </Stack>
  );
}

/**
 * «Мои предложения» мастера: все его предложения по заявкам — группами (ждут ответа, выбраны, закрыты), у каждого
 * заявка, статус и цена. Раздел — чипом в адресе (`?show=`). Выбранное со сделкой ведёт в сделку. Пусто — обучающий
 * экран; неодобренный мастер — экран статуса. «Назад» — «Заявки».
 */
export default async function MyOffersPage({ searchParams }: Props) {
  const params = await searchParams;
  const { user, status } = await requireMaster(pageHref("/executor/offers", params));
  const device = await getDevice();
  const read = await readForMaster(user, status, () => listMyOffers(user));
  if ("gate" in read) return <MasterGate status={read.gate} title={t.title} device={device} />;

  const view = offersView(read.data, typeof params.show === "string" ? params.show : undefined);
  const title = <PageTitle title={t.title} back={{ href: to("/executor/requests"), label: t.back }} />;
  if (view.empty === "none") {
    return (
      <Stack gap="section">
        {title}
        <EmptyState title={t.empty.title} body={t.empty.body} action={{ href: to("/executor/requests"), label: t.empty.action }} />
      </Stack>
    );
  }
  return (
    <Stack gap="section">
      {title}
      <Narrow>
        <Offers view={view} />
      </Narrow>
    </Stack>
  );
}
