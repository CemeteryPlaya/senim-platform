import { ru } from "@/i18n/ru";
import { ActionDock, ButtonLink, Card, EmptyState, List, ListRow, Money, Notice, NowNext, PageTitle, PhotoSlot, Rating, Section, Segmented, Split, Stack, StatusChip } from "@/kit";
import type { Device } from "@/platform/device";
import { to } from "../../../../_shell/paths";
import { chooseOfferSort } from "../actions";
import { sortOptions, type DetailRow, type NowView, type OffersView } from "./card-view";
import { RequestActions } from "./RequestActions";

const t = ru.app.requestCard;

/** Всё, что нужно показать, готовым: страница читает модули, вид ничего не читает и не считает. */
export type CardView = {
  id: string;
  title: string;
  number: number;
  sent: { title: string; text: string } | null;
  now: NowView;
  offers: OffersView;
  details: DetailRow[];
  photos: { id: string; src: string; alt: string }[];
  /** Отмена разрешена: показываем «Действия»; число предложений — для текста последствий. */
  cancel: { offersCount: number } | null;
};

function Offers({ view }: { view: CardView }) {
  const { offers } = view;
  if (!offers.shown) return null;
  if (offers.empty) return <EmptyState title={offers.empty.title} body={offers.empty.body} />;
  return (
    <Section title={t.offers.section(offers.rows.length)}>
      {offers.sortable && (
        <form>
          <Segmented
            legend={t.offers.sortLegend}
            value={offers.sort}
            options={sortOptions().map((o) => ({ ...o, formAction: chooseOfferSort.bind(null, view.id, o.value) }))}
          />
        </form>
      )}
      <Card padded={false}>
        <List>
          {offers.rows.map((row) => (
            <ListRow
              key={row.id}
              href={row.href}
              label={
                <span className="flex flex-col gap-1">
                  <span className="text-card wrap-break-word text-ink">{row.label}</span>
                  <Rating value={row.rating.value} count={row.rating.count} />
                  <span className="text-sub text-muted">{row.terms}</span>
                  {row.chip && (
                    <span>
                      <StatusChip tone={row.chip.tone}>{row.chip.text}</StatusChip>
                    </span>
                  )}
                </span>
              }
              value={<Money tiyn={row.priceTiyn} />}
            />
          ))}
        </List>
      </Card>
    </Section>
  );
}

function Details({ view }: { view: CardView }) {
  return (
    <Section title={t.details.section}>
      <Card padded={false}>
        <List>
          {view.details.map((row) => (
            <ListRow key={row.label} label={row.label} value={row.value} stacked={row.stacked} />
          ))}
        </List>
      </Card>
      {view.photos.length > 0 && (
        <Card>
          <Stack>
            <h3 className="text-sub text-muted">{t.details.photos}</h3>
            <ul className="grid grid-cols-3 gap-2">
              {view.photos.map((photo) => (
                <li key={photo.id}>
                  <PhotoSlot ratio="1/1" src={photo.src} alt={photo.alt} />
                </li>
              ))}
            </ul>
          </Stack>
        </Card>
      )}
    </Section>
  );
}

/**
 * Карточка заявки покупателя. Телефон — одна колонка: «Сейчас» → предложения → «Что в заявке»; главное действие
 * (сделка или выбранное предложение) — в `ActionDock` последним. Компьютер — `Split`: слева «Сейчас» (действие под ним) и
 * предложения, справа «Что в заявке».
 */
export function RequestCardView({ view, device }: { view: CardView; device: Device }) {
  const { now } = view;
  const action = now.primary && (
    <ActionDock>
      <ButtonLink href={now.primary.href}>{now.primary.label}</ButtonLink>
    </ActionDock>
  );
  return (
    <Stack gap="section">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <PageTitle title={view.title} back={{ href: to("/requests"), label: t.back }} lead={t.numberLine(view.number)} />
        </div>
        {view.cancel && <RequestActions requestId={view.id} offersCount={view.cancel.offersCount} device={device} />}
      </div>
      {view.sent && (
        <Notice tone="info" title={view.sent.title}>
          {view.sent.text}
        </Notice>
      )}
      <Split
        main={
          <Stack gap="section">
            <Stack>
              <NowNext now={{ title: now.title, ...(now.body ? { body: now.body } : {}) }} {...(now.next ? { next: now.next } : {})} />
              {device === "desktop" && action}
            </Stack>
            <Offers view={view} />
          </Stack>
        }
        aside={<Details view={view} />}
      />
      {device === "mobile" && action}
    </Stack>
  );
}
