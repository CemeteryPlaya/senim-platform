import type { Metadata } from "next";
import { ArrowRight, Star } from "lucide-react";
import type { ReactNode } from "react";
import { getOfferForClient } from "@/modules/requests";
import { ru } from "@/i18n/ru";
import { Container, DateText, EmptyState, formatDays, formatMonths, formatYears, Money, PageHeader, StatusBadge } from "@/ui";
import { SEGMENT_NAMES, STYLES, type StyleKey } from "@/verticals/furniture";
import { chooseOfferAction } from "../../../actions";
import { ActionButton } from "../../../_parts/ActionButton";
import { orNotFound, pageUser } from "../../../_parts/guard";
import { OFFER_TONE, termsText } from "../../../_parts/labels";
import { OfferChat } from "@/app/_components/chat/OfferChat";

const o = ru.requests.offer;

export const metadata: Metadata = { title: o.metaTitle };

type Props = { params: Promise<{ id: string; offerId: string }> };

/**
 * Карточка отклика (макет 823): вместо пяти вкладок — одна длинная страница.
 * Исполнитель — только «Исполнитель №N» (publicExecutorView); главное действие — выбрать и перейти к замеру.
 */
export default async function OfferPage({ params }: Props) {
  const { id, offerId } = await params;
  const user = await pageUser("CLIENT", `/requests/${id}/offers/${offerId}`);
  if (!user) {
    return (
      <Container className="pt-6">
        <EmptyState title={ru.common.errors.forbidden} description={ru.requests.noAccess} />
      </Container>
    );
  }
  const offer = await orNotFound(getOfferForClient(user, { requestId: id, offerId }));
  const ex = offer.executor;
  const gallery = offer.portfolio.flatMap((item) => item.photos.slice(0, 1));

  return (
    <Container className="flex flex-col gap-10 pb-10">
      <PageHeader
        back={{ href: `/requests/${id}`, label: ru.requests.requestTitle(offer.request.number, offer.request.title) }}
        title={o.title(ex.publicNumber)}
        description={offer.status !== "SENT" ? <StatusBadge tone={OFFER_TONE[offer.status]}>{ru.requests.offerStatus[offer.status]}</StatusBadge> : undefined}
      />

      <dl className="flex flex-wrap gap-x-8 gap-y-3 text-base">
        <Fact label={o.reviews}>
          <span className="inline-flex items-center gap-2">
            <Star aria-hidden className="size-5 fill-current text-warning" />
            {ex.reviewsCount > 0 ? o.rating(ex.ratingAvg.toFixed(1), ex.reviewsCount) : o.noRating}
          </span>
        </Fact>
        {ex.segment && <Fact label={o.segment}>{SEGMENT_NAMES[ex.segment]}</Fact>}
        <Fact label={o.experience}>{formatYears(ex.yearsExperience)}</Fact>
        <Fact label={o.deals}>{ex.completedDeals}</Fact>
      </dl>

      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,24rem)]">
        <Gallery photos={gallery.slice(0, 5)} />
        <section aria-labelledby="terms" className="flex flex-col gap-5 rounded-card border border-line bg-surface p-5 shadow-card sm:p-6">
          <h2 id="terms" className="sr-only">
            {o.price}
          </h2>
          <p className="flex flex-col gap-1">
            <span className="text-base text-muted">{o.price}</span>
            <Money amount={offer.price} className="text-3xl font-extrabold text-ink" />
            <span className="text-base text-ink-soft">{o.priceNote}</span>
          </p>
          <dl className="flex flex-col gap-3 border-t border-line pt-4 text-base">
            <Fact label={o.duration}>{formatDays(offer.durationDays)}</Fact>
            <Fact label={o.warranty}>{formatMonths(offer.warrantyMonths)}</Fact>
            <Fact label={o.measurement}>{termsText(offer.measurementTerms, offer.measurementFee)}</Fact>
          </dl>
          {offer.comment && (
            <p className="border-t border-line pt-4 text-base text-ink">
              <span className="block text-muted">{o.comment}</span>
              {offer.comment}
            </p>
          )}
        </section>
      </div>

      <Section id="portfolio" title={o.portfolio}>
        {offer.portfolio.length === 0 ? (
          <p className="text-base text-ink-soft">{o.portfolioEmpty}</p>
        ) : (
          <ul className="grid grid-cols-[repeat(auto-fill,minmax(min(100%,14rem),1fr))] gap-4">
              {offer.portfolio.map((item) => (
                <li key={item.id} className="flex flex-col gap-2">
                  {item.photos[0] && (
                    // eslint-disable-next-line @next/next/no-img-element -- иллюстрации портфолио из хранилища
                    <img src={item.photos[0].src} alt={item.photos[0].alt} className="aspect-[4/3] w-full rounded-card border border-line object-cover" />
                  )}
                  <span className="text-base font-semibold text-ink">{item.title}</span>
                  <span className="text-sm text-muted">{STYLES[item.style as StyleKey]?.name}</span>
                </li>
              ))}
          </ul>
        )}
      </Section>

      <Section id="reviews" title={o.reviews}>
        {offer.reviews.length === 0 ? (
          <p className="text-base text-ink-soft">{o.reviewsEmpty}</p>
        ) : (
          <ul className="flex flex-col gap-4">
            {offer.reviews.map((r) => (
              <li key={r.id} className="flex flex-col gap-1 border-b border-line pb-4 last:border-b-0">
                <p className="flex flex-wrap items-center gap-3 text-base">
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

      <Section id="how" title={o.howTitle}>
        <ol className="grid gap-4 sm:grid-cols-5">
          {o.how.map((step, i) => (
            <li key={step.title} className="flex gap-3 sm:flex-col">
              <span aria-hidden className="inline-flex size-9 shrink-0 items-center justify-center rounded-full bg-accent-soft font-bold text-primary">
                {i + 1}
              </span>
              <span className="flex flex-col">
                <span className="text-base font-semibold text-ink">{step.title}</span>
                <span className="text-sm text-muted">{step.text}</span>
              </span>
            </li>
          ))}
        </ol>
      </Section>

      <OfferChat offerId={offer.id} title={o.chatWith(ex.publicNumber)} />

      {offer.canChoose && (
        // Над нижней панелью телефона: --tabbar-h (на широком экране 0).
        <div className="sticky bottom-[calc(var(--tabbar-h)+1rem)] z-10 rounded-card border border-line bg-surface p-4 shadow-card sm:self-end">
          <ActionButton
            action={chooseOfferAction}
            input={{ offerId: offer.id }}
            href={`/requests/${id}`}
            fullWidth
            confirm={{ title: o.chooseConfirmTitle(ex.publicNumber), text: o.chooseConfirmText, yes: o.chooseConfirm, no: ru.common.actions.notNow, tone: "primary" }}
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

function Fact({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex flex-col">
      <dt className="text-sm text-muted">{label}</dt>
      <dd className="text-base font-semibold text-ink">{children}</dd>
    </div>
  );
}

function Section({ id, title, children }: { id: string; title: string; children: ReactNode }) {
  return (
    <section id={id} aria-labelledby={`${id}-title`} className="flex scroll-mt-24 flex-col gap-4">
      <h2 id={`${id}-title`} className="text-2xl font-bold text-ink">
        {title}
      </h2>
      {children}
    </section>
  );
}

function Gallery({ photos }: { photos: { src: string; alt: string }[] }) {
  if (photos.length === 0) return <div aria-hidden className="aspect-[4/3] w-full rounded-card bg-sunken" />;
  const [main, ...rest] = photos;
  return (
    <div className="flex flex-col gap-3">
      {/* eslint-disable-next-line @next/next/no-img-element -- иллюстрации портфолио из хранилища */}
      <img src={main.src} alt={main.alt} className="aspect-[4/3] w-full rounded-card border border-line bg-sunken object-cover" />
      {rest.length > 0 && (
        <ul className="grid grid-cols-4 gap-3">
          {rest.map((p, i) => (
            <li key={`${p.src}-${i}`}>
              {/* eslint-disable-next-line @next/next/no-img-element -- иллюстрации портфолио из хранилища */}
              <img src={p.src} alt={p.alt} className="aspect-square w-full rounded-control border border-line object-cover" />
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
