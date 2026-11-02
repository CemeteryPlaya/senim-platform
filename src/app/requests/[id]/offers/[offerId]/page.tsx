import type { Metadata } from "next";
import { ArrowRight, Ruler, Star } from "lucide-react";
import type { ReactNode } from "react";
import { getOfferForClient, TZ_PATH, wholeKzt } from "@/modules/requests";
import { ru } from "@/i18n/ru";
import { Container, DateText, formatYears, PageHeader, PhotoCard, SectionTitle, StatusBadge } from "@/ui";
import { SEGMENT_NAMES, STYLES, type StyleKey } from "@/verticals/furniture";
import { chooseOfferAction } from "../../../actions";
import { ActionButton } from "../../../_parts/ActionButton";
import { orNotFound, pageUser } from "../../../_parts/guard";
import { OFFER_TONE, termsText } from "../../../_parts/labels";
import { CostSummary } from "@/app/_components/pre-contract/CostSummary";
import { OfferChat } from "@/app/_components/chat/OfferChat";
import { Negotiation } from "@/app/_components/negotiation/Negotiation";
import { NoAccess } from "@/app/_components/NoAccess";

const o = ru.requests.offer;

export const metadata: Metadata = { title: o.metaTitle };

type Props = { params: Promise<{ id: string; offerId: string }> };

/**
 * Карточка отклика (макеты 823 и 13–14): вместо вкладок — одна длинная страница. Галерея работ, условия
 * (цена крупно, срок и гарантия строками), об исполнителе строками, работы, отзывы, чат.
 * Исполнитель — только «Исполнитель №N» (publicExecutorView). На пути ТЗ главное действие — в торге над чатом
 * («Принять N ₸» → оферта); в сценарии до договора (флаг preContractFlows) — «Выбрать и перейти к замеру».
 */
export default async function OfferPage({ params }: Props) {
  const { id, offerId } = await params;
  const user = await pageUser("CLIENT", `/requests/${id}/offers/${offerId}`);
  if (!user) {
    return <NoAccess description={ru.requests.noAccess} />;
  }
  const offer = await orNotFound(getOfferForClient(user, { requestId: id, offerId }));
  const ex = offer.executor;
  const gallery = offer.portfolio.flatMap((item) => item.photos.slice(0, 1));
  const tz = offer.request.path === TZ_PATH;

  return (
    <Container className="flex flex-col gap-10 pb-10">
      <PageHeader
        back={{ href: `/requests/${id}`, label: ru.requests.requestTitle(offer.request.number, offer.request.title) }}
        title={o.title(ex.labelGen)}
        description={
          <span className="flex flex-wrap items-center gap-2">
            {offer.status !== "SENT" && <StatusBadge tone={OFFER_TONE[offer.status]}>{ru.requests.offerStatus[offer.status]}</StatusBadge>}
            {ex.segment && <StatusBadge tone="accent">{SEGMENT_NAMES[ex.segment]}</StatusBadge>}
          </span>
        }
        className="pb-0"
      />

      <div className="grid grid-cols-[minmax(0,1fr)] gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,24rem)] lg:items-start">
        <Gallery photos={gallery.slice(0, 5)} label={o.photos(ex.labelGen)} />
        <section aria-labelledby="terms-title" className="flex flex-col gap-5 rounded-card border border-line p-5 sm:p-6">
          <h2 id="terms-title" className="text-xl font-bold text-ink">
            {o.termsTitle}
          </h2>
          <CostSummary
            total={wholeKzt(offer.priceTiyn)}
            totalLabel={tz ? o.priceTz : o.price}
            durationDays={offer.durationDays}
            warrantyMonths={offer.warrantyMonths}
          />
          <p className="text-base text-ink-soft">{tz ? o.priceNoteTz : o.priceNote}</p>
          {!tz && (
            <p className="flex items-start gap-3 text-base text-ink">
              <Ruler aria-hidden className="mt-0.5 size-6 shrink-0 text-primary" />
              <span className="flex min-w-0 flex-col">
                <span className="text-sm text-muted">{o.measurement}</span>
                {termsText(offer.measurementTerms, offer.measurementFee)}
              </span>
            </p>
          )}
          {offer.comment && (
            <p className="border-l-2 border-line pl-4 text-base text-ink">
              <span className="block text-sm text-muted">{o.comment}</span>
              {offer.comment}
            </p>
          )}
        </section>
      </div>

      <Section id="executor" title={ex.label}>
        {/* Рейтинг — только по настоящим отзывам; без них строки нет (в разделе «Отзывы» — «Отзывов пока нет»). */}
        <dl className="flex flex-col divide-y divide-line border-y border-line">
          {[
            ...(ex.reviewsCount > 0 ? [{ label: o.ratingValue(ex.reviewsCount), value: ex.ratingAvg.toFixed(1) }] : []),
            { label: o.yearsLabel, value: formatYears(ex.yearsExperience) },
            { label: o.dealsLabel, value: String(ex.completedDeals) },
            ...(ex.address ? [{ label: ru.companies.identity.address, value: ex.address }] : []),
          ].map((row) => (
            <div key={row.label} className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1 py-3 text-base">
              <dt className="text-muted">{row.label}</dt>
              <dd className="font-semibold text-ink">{row.value}</dd>
            </div>
          ))}
        </dl>
      </Section>

      <Section id="portfolio" title={o.portfolio}>
        {offer.portfolio.length === 0 ? (
          <p className="text-base text-ink-soft">{o.portfolioEmpty}</p>
        ) : (
          <ul className="grid grid-cols-[repeat(auto-fill,minmax(min(100%,15rem),1fr))] gap-4">
            {offer.portfolio.map((item) => (
              <PhotoCard
                as="li"
                key={item.id}
                image={item.photos[0] ?? null}
                title={item.title}
                meta={STYLES[item.style as StyleKey] ? [{ text: STYLES[item.style as StyleKey].name }] : undefined}
              />
            ))}
          </ul>
        )}
      </Section>

      <Section id="reviews" title={o.reviews}>
        {offer.reviews.length === 0 ? (
          <p className="text-base text-ink-soft">{o.reviewsEmpty}</p>
        ) : (
          <ul className="flex flex-col divide-y divide-line border-y border-line">
            {offer.reviews.map((r) => (
              <li key={r.id} className="flex flex-col gap-2 py-4">
                <p className="flex flex-wrap items-center gap-x-3 gap-y-1 text-base">
                  <span className="inline-flex items-center gap-1 font-semibold text-ink">
                    <Star aria-hidden className="size-5 fill-current text-warning" />
                    {o.reviewRating(r.rating)}
                  </span>
                  <DateText value={r.createdAt} className="text-muted" />
                </p>
                {r.text && <p className="text-base text-ink">{r.text}</p>}
              </li>
            ))}
          </ul>
        )}
      </Section>

      {/* Торг — над чатом отклика: обе стороны видят раунды цены и смету до оплаты. */}
      {tz && <Negotiation offerId={offer.id} />}
      <OfferChat offerId={offer.id} title={o.chatWith(ex.labelDat)} />

      {offer.canChoose && (
        // Закреплён над нижней панелью телефона (--tabbar-h, на широком экране 0), только если экран выше 28em:
        // блок ~6–7em, так он не займёт больше четверти экрана. При шрифте 200 % на телефоне — обычный блок в потоке.
        <div className="bottom-[calc(var(--tabbar-h)+1rem)] z-10 rounded-card border border-line bg-surface p-4 shadow-raised sm:self-end [@media(min-height:28em)]:sticky">
          <ActionButton
            action={chooseOfferAction}
            input={{ offerId: offer.id }}
            href={`/requests/${id}`}
            fullWidth
            confirm={{ title: o.chooseConfirmTitle(ex.labelGen), text: o.chooseConfirmText, yes: o.chooseConfirm, no: ru.common.actions.notNow, tone: "primary" }}
          >
            <span className="inline-flex items-center gap-2">
              {o.choose}
              <ArrowRight aria-hidden className="size-5" />
            </span>
          </ActionButton>
        </div>
      )}
    </Container>
  );
}

function Section({ id, title, children }: { id: string; title: string; children: ReactNode }) {
  return (
    <section id={id} aria-labelledby={`${id}-title`} className="flex scroll-mt-24 flex-col gap-4">
      <SectionTitle id={`${id}-title`} title={title} />
      {children}
    </section>
  );
}

/** Галерея работ исполнителя: крупное фото и миниатюры. Нет работ — заглушка того же размера. */
function Gallery({ photos, label }: { photos: { src: string; alt: string }[]; label: string }) {
  if (photos.length === 0) return <div aria-hidden className="aspect-[4/3] w-full rounded-card bg-sunken" />;
  const [main, ...rest] = photos;
  return (
    <figure aria-label={label} className="flex flex-col gap-3">
      {/* eslint-disable-next-line @next/next/no-img-element -- иллюстрации портфолио из хранилища */}
      <img src={main.src} alt={main.alt} className="aspect-[4/3] w-full rounded-card bg-sunken object-cover" />
      {rest.length > 0 && (
        <ul className="grid grid-cols-4 gap-3">
          {rest.map((p, i) => (
            <li key={`${p.src}-${i}`}>
              {/* eslint-disable-next-line @next/next/no-img-element -- иллюстрации портфолио из хранилища */}
              <img src={p.src} alt={p.alt} loading="lazy" className="aspect-square w-full rounded-control bg-sunken object-cover" />
            </li>
          ))}
        </ul>
      )}
    </figure>
  );
}
