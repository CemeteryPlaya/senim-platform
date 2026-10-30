import { MessageCircle, Star } from "lucide-react";
import type { OfferListItem } from "@/modules/requests";
import { ru } from "@/i18n/ru";
import { ButtonLink, Money, StatusBadge } from "@/ui";
import { SEGMENT_NAMES } from "@/verticals/furniture";
import { OFFER_TONE, termsText } from "../_parts/labels";

const o = ru.requests.offer;

/** Карточка отклика в списке (макет 783): фото работ, «Исполнитель №N», рейтинг, срок, цена, гарантия. */
export function OfferCard({ offer, requestId }: { offer: OfferListItem; requestId: string }) {
  const href = `/requests/${requestId}/offers/${offer.id}`;
  const ex = offer.executor;
  const [cover, ...rest] = offer.preview;
  const headingId = `offer-${offer.id}`;
  return (
    <article aria-labelledby={headingId} className="grid gap-5 rounded-card border border-line bg-surface p-5 shadow-card sm:grid-cols-[minmax(0,14rem)_minmax(0,1fr)_auto] sm:p-6">
      <div className="flex flex-col gap-2">
        {cover ? (
          // eslint-disable-next-line @next/next/no-img-element -- иллюстрации портфолио из хранилища
          <img src={cover.src} alt={cover.alt} className="aspect-[4/3] w-full rounded-control border border-line bg-sunken object-cover" />
        ) : (
          <div aria-hidden className="aspect-[4/3] w-full rounded-control bg-sunken" />
        )}
        {rest.length > 0 && (
          <ul className="grid grid-cols-3 gap-2" aria-label={o.photos(ex.publicNumber)}>
            {rest.slice(0, 3).map((p, i) => (
              <li key={`${p.src}-${i}`}>
                {/* eslint-disable-next-line @next/next/no-img-element -- иллюстрации портфолио из хранилища */}
                <img src={p.src} alt={p.alt} className="aspect-square w-full rounded-control border border-line object-cover" />
              </li>
            ))}
          </ul>
        )}
      </div>

      <div className="flex min-w-0 flex-col gap-3">
        <div className="flex flex-wrap items-center gap-2">
          <h3 id={headingId} className="text-xl font-bold text-ink">
            {ex.label}
          </h3>
          {offer.status !== "SENT" && <StatusBadge tone={OFFER_TONE[offer.status]}>{ru.requests.offerStatus[offer.status]}</StatusBadge>}
        </div>
        <p className="flex items-center gap-2 text-base text-ink">
          <Star aria-hidden className="size-5 shrink-0 fill-current text-warning" />
          {ex.reviewsCount > 0 ? o.rating(ex.ratingAvg.toFixed(1), ex.reviewsCount) : o.noRating}
        </p>
        <dl className="grid grid-cols-[auto_minmax(0,1fr)] gap-x-4 gap-y-1 text-base">
          {ex.segment && (
            <>
              <dt className="text-muted">{o.segment}</dt>
              <dd className="text-ink">{SEGMENT_NAMES[ex.segment]}</dd>
            </>
          )}
          <dt className="text-muted">{o.duration}</dt>
          <dd className="text-ink">{o.days(offer.durationDays)}</dd>
          <dt className="text-muted">{o.warranty}</dt>
          <dd className="text-ink">{o.months(offer.warrantyMonths)}</dd>
          <dt className="text-muted">{o.measurement}</dt>
          <dd className="text-ink">{termsText(offer.measurementTerms, offer.measurementFee)}</dd>
        </dl>
        {offer.portfolioCount > 0 && <p className="text-sm text-muted">{o.portfolioMore(offer.portfolioCount)}</p>}
      </div>

      <div className="flex flex-col gap-3 sm:min-w-52 sm:items-stretch">
        <p className="flex flex-col">
          <span className="text-sm text-muted">{o.price}</span>
          <Money amount={offer.price} className="text-2xl font-extrabold text-ink" />
        </p>
        <ButtonLink href={href} variant="secondary">
          {o.more}
          <span className="sr-only">: {ex.label}</span>
        </ButtonLink>
        <ButtonLink href={`${href}#chat`} variant="ghost" icon={<MessageCircle />}>
          {o.write}
          <span className="sr-only">: {ex.label}</span>
        </ButtonLink>
      </div>
    </article>
  );
}
