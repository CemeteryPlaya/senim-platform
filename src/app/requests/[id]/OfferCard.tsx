import { CalendarDays, ChevronRight, MessageCircle, Ruler, ShieldCheck, Sofa, Star } from "lucide-react";
import type { OfferListItem } from "@/modules/requests";
import { ru } from "@/i18n/ru";
import { ButtonLink, formatDays, formatMonths, Money, StatusBadge } from "@/ui";
import { SEGMENT_NAMES } from "@/verticals/furniture";
import { OFFER_TONE, termsText } from "../_parts/labels";

const o = ru.requests.offer;

/**
 * Карточка отклика в списке (макеты 7 и 783, стиль 12–15): фото работы слева, «Исполнитель №N», рейтинг,
 * срок, гарантия, замер, цена крупно. «Подробнее» — карточка отклика, «Написать» — чат на ней.
 */
export function OfferCard({ offer, requestId }: { offer: OfferListItem; requestId: string }) {
  const href = `/requests/${requestId}/offers/${offer.id}`;
  const ex = offer.executor;
  const cover = offer.preview[0];
  const headingId = `offer-${offer.id}`;
  const facts = [
    { icon: <Star className="fill-current text-warning" />, text: ex.reviewsCount > 0 ? o.rating(ex.ratingAvg.toFixed(1), ex.reviewsCount) : o.noRating },
    { icon: <CalendarDays />, text: `${o.duration}: ${formatDays(offer.durationDays)}` },
    { icon: <ShieldCheck />, text: `${o.warranty}: ${formatMonths(offer.warrantyMonths)}` },
    { icon: <Ruler />, text: termsText(offer.measurementTerms, offer.measurementFee) },
  ];
  return (
    <article
      aria-labelledby={headingId}
      className="flex min-w-0 flex-col gap-4 rounded-card border border-line bg-surface p-3 shadow-card sm:p-4"
    >
      <div className="@container/card flex min-w-0 gap-3 sm:gap-4">
        {cover ? (
          // eslint-disable-next-line @next/next/no-img-element -- иллюстрации портфолио из хранилища
          <img src={cover.src} alt={cover.alt} loading="lazy" className="aspect-square w-24 shrink-0 self-start rounded-control bg-sunken object-cover @max-[18em]/card:hidden sm:w-36" />
        ) : (
          <div aria-hidden className="flex aspect-square w-24 shrink-0 items-center justify-center self-start rounded-control bg-sunken text-muted @max-[18em]/card:hidden sm:w-36">
            <Sofa className="size-10" />
          </div>
        )}
        <div className="flex min-w-0 flex-1 flex-col gap-2">
          <div className="flex min-w-0 flex-wrap items-start justify-between gap-x-3 gap-y-1">
            <h3 id={headingId} className="min-w-0 text-lg leading-snug font-bold text-ink">
              {ex.label}
            </h3>
            {offer.status !== "SENT" && <StatusBadge tone={OFFER_TONE[offer.status]}>{ru.requests.offerStatus[offer.status]}</StatusBadge>}
          </div>
          {ex.segment && <p className="text-base text-muted">{SEGMENT_NAMES[ex.segment]}</p>}
          <ul className="flex flex-col gap-1 text-base text-ink-soft">
            {facts.map((f, i) => (
              <li key={i} className="flex min-w-0 items-start gap-2">
                <span aria-hidden className="mt-0.5 inline-flex shrink-0 text-muted [&_svg]:size-5">
                  {f.icon}
                </span>
                <span className="min-w-0">{f.text}</span>
              </li>
            ))}
          </ul>
          <p className="mt-1 flex flex-col">
            <span className="text-sm text-muted">{o.price}</span>
            <Money amount={offer.price} className="text-2xl font-extrabold text-ink" />
          </p>
        </div>
      </div>
      <div className="flex flex-wrap gap-3">
        <ButtonLink href={href} variant="secondary" iconEnd={<ChevronRight />} className="flex-1 sm:flex-none" aria-label={ru.common.ui.actionFor(o.more, ex.label)}>
          {o.more}
        </ButtonLink>
        <ButtonLink href={`${href}#chat`} variant="soft" icon={<MessageCircle />} className="flex-1 sm:flex-none" aria-label={ru.common.ui.actionFor(o.write, ex.label)}>
          {o.write}
        </ButtonLink>
      </div>
    </article>
  );
}
