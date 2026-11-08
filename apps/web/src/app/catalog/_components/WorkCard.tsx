import Link from "next/link";
import { ArrowRight } from "lucide-react";
import { ru } from "@/i18n/ru";
import type { PortfolioCard } from "@/modules/companies";
import { ButtonLink, StatusBadge, WorkCard as UiWorkCard } from "@/ui";
import { Rating, SegmentBadge } from "./executor-bits";

const t = ru.companies.catalog;

/** Ссылка мастера заявки для «Хочу похожее» (маршрут marketplace-engineer). */
export const wantSimilarHref = (portfolioItemId: string) => `/requests/new?like=${encodeURIComponent(portfolioItemId)}`;

export type WorkCardProps = {
  card: PortfolioCard;
  /** На странице самого исполнителя строка исполнителя не нужна. */
  showExecutor?: boolean;
  /** Лента главной (макет b-plus-a): без рейтинга, сегмента и ссылки на отзыв — фото, цена, параметры, исполнитель. */
  compact?: boolean;
};

/**
 * Карточка работы каталога (без своей ссылки: страницы работы пока нет, ссылка на исполнителя — в нижнем слоте): общий
 * `WorkCard` из src/ui + строка анонимного исполнителя и «Хочу похожее» в нижнем слоте. «Хочу похожее» — вторичная
 * кнопка: карточек на экране много, а заливная главная кнопка на экране одна.
 * «Проверен» — у всех: в каталог попадают только работы исполнителей, подтверждённых оператором (VISIBLE_EXECUTOR).
 */
export function WorkCard({ card, showExecutor = true, compact = false }: WorkCardProps) {
  const cover = card.photos.find((p) => p.src);
  const executorHref = `/executors/${card.executor.publicNumber}`;
  return (
    <UiWorkCard
      photoUrl={cover?.src ?? null}
      photoAlt={cover?.alt}
      title={card.title}
      priceFrom={card.priceFrom}
      meta={[card.furnitureType.name, card.style.name, ...(card.place ? [card.place] : [])]}
      verified
      footer={
        <>
          {card.reviewId && !compact && (
            <Link
              href={`${executorHref}#review-${card.reviewId}`}
              className="inline-flex min-h-control-sm items-center self-start rounded-control text-base font-semibold text-primary underline underline-offset-4"
            >
              {ru.companies.dealPortfolio.reviewLink}
            </Link>
          )}
          {showExecutor && (
            <>
              <Link
                href={executorHref}
                aria-label={t.aboutExecutor(card.executor.label)}
                className="inline-flex min-h-control-sm items-center gap-2 self-start rounded-control text-base font-semibold text-primary underline underline-offset-4"
              >
                {card.executor.label}
                <ArrowRight aria-hidden className="size-5 shrink-0" />
              </Link>
              {!compact && (
                <div className="flex flex-wrap items-center gap-3">
                  <Rating avg={card.executor.ratingAvg} count={card.executor.reviewsCount} />
                  <SegmentBadge segment={card.executor.segment} />
                </div>
              )}
            </>
          )}
          <ButtonLink href={wantSimilarHref(card.id)} variant="secondary" fullWidth aria-label={t.wantSimilarLabel(card.title, card.executor.label)}>
            {t.wantSimilar}
          </ButtonLink>
        </>
      }
    >
      {card.doneOnPlatform && <StatusBadge tone="success">{ru.companies.inspiration.doneOnPlatform}</StatusBadge>}
    </UiWorkCard>
  );
}
