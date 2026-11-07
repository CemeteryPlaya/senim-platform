import Link from "next/link";
import { ArrowRight, ImageOff, MapPin } from "lucide-react";
import { ru } from "@/i18n/ru";
import type { PortfolioCard } from "@/modules/companies";
import { ButtonLink, Money, StatusBadge } from "@/ui";
import { Rating, SegmentBadge } from "./executor-bits";

const t = ru.companies.catalog;

/** Ссылка мастера заявки для «Хочу похожее» (маршрут marketplace-engineer). */
export const wantSimilarHref = (portfolioItemId: string) => `/requests/new?like=${encodeURIComponent(portfolioItemId)}`;

export type WorkCardProps = {
  card: PortfolioCard;
  /** На странице самого исполнителя строка исполнителя не нужна. */
  showExecutor?: boolean;
};

/** Карточка работы: обложка, название, тип и стиль, цена, анонимный исполнитель, «Хочу похожее». */
export function WorkCard({ card, showExecutor = true }: WorkCardProps) {
  const cover = card.photos.find((p) => p.src);
  return (
    <article className="flex h-full min-w-0 flex-col overflow-hidden rounded-card border border-line bg-surface">
      {cover?.src ? (
        // Демо-фото — SVG из public/, оптимизатор next/image для них не нужен.
        // eslint-disable-next-line @next/next/no-img-element
        <img src={cover.src} alt={cover.alt} loading="lazy" className="aspect-[4/3] w-full bg-sunken object-cover" />
      ) : (
        <div className="flex aspect-[4/3] w-full flex-col items-center justify-center gap-2 bg-sunken text-muted">
          <ImageOff aria-hidden className="size-8" />
          <span className="text-sm">{ru.companies.noPhoto}</span>
        </div>
      )}

      <div className="flex min-w-0 flex-1 flex-col gap-3 p-5">
        <h3 className="text-lg font-bold break-words text-ink">{card.title}</h3>
        <div className="flex flex-wrap gap-2">
          <StatusBadge tone="neutral">{card.furnitureType.name}</StatusBadge>
          <StatusBadge tone="neutral">{card.style.name}</StatusBadge>
          {card.doneOnPlatform && <StatusBadge tone="success">{ru.companies.inspiration.doneOnPlatform}</StatusBadge>}
        </div>
        {card.place && (
          <p className="flex items-start gap-1 text-base text-muted">
            <MapPin aria-hidden className="mt-1 size-4 shrink-0" />
            {card.place}
          </p>
        )}
        {card.reviewId && (
          <Link
            href={`/executors/${card.executor.publicNumber}#review-${card.reviewId}`}
            className="inline-flex min-h-control-sm items-center self-start rounded-control text-base font-semibold text-primary underline underline-offset-4"
          >
            {ru.companies.dealPortfolio.reviewLink}
          </Link>
        )}
        <p className="text-lg font-semibold text-ink">
          {card.priceFrom !== null ? (
            <>
              {t.priceFrom} <Money amount={card.priceFrom} />
            </>
          ) : (
            <span className="text-base font-normal text-muted">{t.priceUnknown}</span>
          )}
        </p>

        {showExecutor && (
          <div className="flex flex-col gap-2 border-t border-line pt-3">
            <Link
              href={`/executors/${card.executor.publicNumber}`}
              aria-label={t.aboutExecutor(card.executor.label)}
              className="inline-flex min-h-control-sm items-center gap-2 self-start rounded-control text-base font-semibold text-primary underline underline-offset-4"
            >
              {card.executor.label}
              <ArrowRight aria-hidden className="size-5 shrink-0" />
            </Link>
            <div className="flex flex-wrap items-center gap-3">
              <Rating avg={card.executor.ratingAvg} count={card.executor.reviewsCount} />
              <SegmentBadge segment={card.executor.segment} />
            </div>
          </div>
        )}

        <div className="mt-auto pt-2">
          <ButtonLink href={wantSimilarHref(card.id)} fullWidth aria-label={t.wantSimilarLabel(card.title, card.executor.label)}>
            {t.wantSimilar}
          </ButtonLink>
        </div>
      </div>
    </article>
  );
}
