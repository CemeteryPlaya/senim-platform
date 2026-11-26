import { ru } from "@/i18n/ru";
import Link from "next/link";
import { ChevronRight } from "lucide-react";
import { ActionDock, ButtonLink, Card, List, ListItem, ListRow, Money, NowNext, PageTitle, PhotoSlot, Rating, Section, Segmented, Split, Stack, StatusChip } from "@/kit";
import type { Device } from "@/platform/device";
import { to } from "../../../../_shell/paths";
import type { DesignView } from "../../../_parts/design-files";
import { DesignFiles } from "../../../_parts/DesignFiles";
import { chooseOfferSort } from "../actions";
import { sortOptions, type DetailRow, type InvitationRow, type NowView, type OffersView } from "./card-view";
import { RequestActions } from "./RequestActions";
import { SentNotice } from "./SentNotice";

const t = ru.app.requestCard;

/** Всё, что нужно показать, готовым: страница читает модули, вид ничего не читает и не считает. */
export type CardView = {
  id: string;
  title: string;
  number: number;
  sent: { title: string; text: string; href: string } | null;
  /** «Сейчас / Дальше»: состояние заявки говорит она — плашки в шапке нет (повторяла бы её). */
  now: NowView;
  offers: OffersView;
  /** Приглашённые мастера; пусто — раздела нет. */
  invitations: InvitationRow[];
  details: DetailRow[];
  photos: { id: string; src: string; alt: string }[];
  /** Свой дизайн-проект покупателя (скрытые оператором — с пометкой); `null` — файлов нет, раздела нет. */
  design: DesignView | null;
  /** Отмена разрешена: показываем «Действия»; число предложений — для текста последствий. */
  cancel: { offersCount: number; direct: boolean } | null;
};

/** Второстепенное действие открытой заявки («Посмотреть мастеров»): тихая ссылка по левой линии. */
function Secondary({ link }: { link: NowView["secondary"] }) {
  if (!link) return null;
  return (
    <ButtonLink href={link.href} variant="quiet" flush>
      {link.label}
    </ButtonLink>
  );
}

function Offers({ view }: { view: CardView }) {
  const { offers } = view;
  if (!offers.shown) return null;
  return (
    <Section title={t.offers.section(offers.rows.length)}>
      {offers.sortable && (
        <form>
          <Segmented
            legend={t.offers.sortLegend}
            legendHidden
            value={offers.sort}
            options={sortOptions().map((o) => ({ ...o, formAction: chooseOfferSort.bind(null, view.id, o.value) }))}
          />
        </form>
      )}
      <Card padded={false}>
        <List>
          {offers.rows.map((row) => (
            <ListItem key={row.id}>
              <Link
                href={row.href}
                className="flex w-full items-center gap-3 px-card py-3 text-body no-underline transition-colors duration-100 hover:bg-canvas active:bg-line"
              >
                <span className="flex min-w-0 flex-1 flex-col gap-1">
                  {/* Имя и цена в одной строке; условия — отдельной строкой под ними: цены сравниваются взглядом по правому краю. */}
                  <span className="flex items-baseline justify-between gap-3">
                    <span className="min-w-0 text-headline wrap-break-word text-ink">{row.label}</span>
                    {/* У предложения со сделкой — цена сделки с подписью под ней; у остальных — действующая цена мастера. */}
                    <span className="flex shrink-0 flex-col items-end">
                      <Money tiyn={row.priceTiyn} />
                      {row.priceLabel && <span className="text-sub text-muted">{row.priceLabel}</span>}
                    </span>
                  </span>
                  <Rating value={row.rating.value} count={row.rating.count} />
                  <span className="flex flex-wrap gap-x-3 text-sub text-muted">
                    {row.terms.map((part) => (
                      <span key={part} className="whitespace-nowrap">
                        {part}
                      </span>
                    ))}
                  </span>
                  {row.chip && (
                    <span>
                      <StatusChip tone={row.chip.tone}>{row.chip.text}</StatusChip>
                    </span>
                  )}
                </span>
                <ChevronRight aria-hidden className="size-5 shrink-0 text-muted" />
              </Link>
            </ListItem>
          ))}
        </List>
      </Card>
      {/* «Посмотреть мастеров» — после пришедших предложений: сначала то, что уже прислали, потом — искать ещё. */}
      <Secondary link={view.now.secondary} />
    </Section>
  );
}

/** «Приглашённые мастера»: мастер — ссылкой на его страницу, под ним — ответ на приглашение. */
function Invitations({ view }: { view: CardView }) {
  if (view.invitations.length === 0) return null;
  return (
    <Section title={t.invitations.section}>
      <Card padded={false}>
        <List>
          {view.invitations.map((row) => (
            <ListItem key={row.key}>
              <Link
                href={row.href}
                className="flex w-full items-center gap-3 px-card py-3 text-body no-underline transition-colors duration-100 hover:bg-canvas active:bg-line"
              >
                <span className="flex min-w-0 flex-1 flex-col gap-1">
                  <span className="min-w-0 text-headline wrap-break-word text-ink">{row.label}</span>
                  <span className="text-sub wrap-break-word text-muted">{row.status}</span>
                </span>
                <ChevronRight aria-hidden className="size-5 shrink-0 text-muted" />
              </Link>
            </ListItem>
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
      {view.design && <DesignFiles title={t.details.design} view={view.design} />}
    </Section>
  );
}

/**
 * Карточка заявки покупателя. Телефон — одна колонка: «Сейчас» → предложения → «Что в заявке»; главное действие
 * (сделка или выбранное предложение) — в `ActionDock` последним. Компьютер — `Split`: слева «Сейчас» (действие под ним) и
 * предложения, справа «Что в заявке». Второстепенное действие открытой заявки («Посмотреть мастеров») — тихой кнопкой-ссылкой
 * под списком предложений, а пока их нет — под «Сейчас». Плашки состояния в шапке нет: его называет «Сейчас».
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
          <PageTitle
            title={view.title}
            back={{ href: to("/requests"), label: t.back }}
            lead={t.numberLine(view.number)}
          />
        </div>
        {view.cancel && <RequestActions requestId={view.id} offersCount={view.cancel.offersCount} direct={view.cancel.direct} device={device} />}
      </div>
      {view.sent && (
        <SentNotice title={view.sent.title} text={view.sent.text} href={view.sent.href} />
      )}
      <Split
        main={
          <Stack gap="section">
            <Stack>
              <NowNext now={{ title: now.title, ...(now.body ? { body: now.body } : {}) }} {...(now.next ? { next: now.next } : {})} />
              {!view.offers.shown && <Secondary link={now.secondary} />}
              {device === "desktop" && action}
            </Stack>
            <Offers view={view} />
            <Invitations view={view} />
          </Stack>
        }
        aside={<Details view={view} />}
      />
      {device === "mobile" && action}
    </Stack>
  );
}
