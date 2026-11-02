import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { cache } from "react";
import { ArrowRight, ImageOff, Star } from "lucide-react";
import { ru } from "@/i18n/ru";
import { getInspirationItem } from "@/modules/companies";
import { getCurrentUser } from "@/modules/identity";
import { ButtonLink, Card, Container, Fact, Money, PageHeader, StatusBadge } from "@/ui";
import { Rating, SegmentBadge } from "../../catalog/_components/executor-bits";
import { wantSimilarHref } from "../../catalog/_components/WorkCard";
import { FeatureToggle } from "../_parts/FeatureToggle";

const t = ru.companies.inspiration;
const d = t.detail;

type Props = { params: Promise<{ id: string }> };

/** Один запрос на HTTP-запрос: и заголовок вкладки, и страница. */
const load = cache(async (id: string) => getInspirationItem(id, await getCurrentUser()));

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const item = await load((await params).id);
  return { title: item ? item.title : ru.common.errors.notFound };
}

/**
 * Открытая работа «Вдохновения»: крупные фото, тип, стиль, место, исполнитель (подпись по режиму показа) и
 * одно главное действие — «Хочу похожее» (черновик заявки с этим примером; гостя — через вход и обратно).
 */
export default async function InspirationItemPage({ params }: Props) {
  const item = await load((await params).id);
  if (!item) notFound();
  const user = await getCurrentUser();
  const photos = item.photos.filter((p) => p.src);

  return (
    <Container className="flex flex-col gap-6 pb-12">
      <PageHeader title={item.title} back={{ href: "/inspiration", label: d.back }} className="pb-0" />

      <div className="grid grid-cols-[minmax(0,1fr)] gap-6 lg:grid-cols-[minmax(0,3fr)_minmax(0,2fr)] lg:items-start">
        <section aria-labelledby="work-photos" className="flex flex-col gap-3">
          <h2 id="work-photos" className="sr-only">
            {d.photos}
          </h2>
          {photos.length === 0 ? (
            <div className="flex aspect-[4/3] w-full flex-col items-center justify-center gap-2 rounded-card bg-sunken text-muted">
              <ImageOff aria-hidden className="size-10" />
              <span className="text-base">{ru.companies.noPhoto}</span>
            </div>
          ) : (
            <ul className="flex flex-col gap-3">
              {photos.map((photo, i) => (
                <li key={photo.id}>
                  {/* eslint-disable-next-line @next/next/no-img-element -- подписанные ссылки хранилища и SVG сида */}
                  <img
                    src={photo.src!}
                    alt={`${photo.alt}. ${d.photoOf(i + 1, photos.length)}`}
                    loading={i === 0 ? "eager" : "lazy"}
                    className="w-full rounded-card bg-sunken object-cover"
                  />
                </li>
              ))}
            </ul>
          )}
        </section>

        <div className="flex flex-col gap-5 lg:sticky lg:top-4">
          {(item.featured || item.doneOnPlatform) && (
            <div className="flex flex-wrap gap-2">
              {item.featured && <StatusBadge tone="accent">{t.featured}</StatusBadge>}
              {item.doneOnPlatform && <StatusBadge tone="success">{t.doneOnPlatform}</StatusBadge>}
            </div>
          )}

          <dl className="grid grid-cols-[minmax(0,1fr)] gap-4 sm:grid-cols-2 lg:grid-cols-[minmax(0,1fr)]">
            <Fact label={d.type}>{item.furnitureType.name}</Fact>
            <Fact label={d.style}>{item.style.name}</Fact>
            {item.place && <Fact label={d.place}>{item.place}</Fact>}
            {item.priceFrom !== null && (
              <Fact label={d.priceFrom}>
                <Money amount={item.priceFrom} />
              </Fact>
            )}
          </dl>

          {item.description && <p className="text-base whitespace-pre-line text-ink-soft">{item.description}</p>}

          <div className="flex flex-col gap-2 border-t border-line pt-4">
            <p className="text-base font-semibold text-muted">{d.executor}</p>
            <Link
              href={`/executors/${item.executor.publicNumber}`}
              aria-label={d.aboutExecutor(item.executor.label)}
              className="inline-flex min-h-control-sm items-center gap-2 self-start rounded-control text-lg font-bold text-primary underline underline-offset-4"
            >
              {item.executor.label}
              <ArrowRight aria-hidden className="size-5 shrink-0" />
            </Link>
            <div className="flex flex-wrap items-center gap-3">
              <Rating avg={item.executor.ratingAvg} count={item.executor.reviewsCount} />
              <SegmentBadge segment={item.executor.segment} />
            </div>
          </div>

          {item.review && (
            <Card as="section" title={d.review} titleAs="h2">
              <div className="flex flex-col gap-2">
                <span className="inline-flex items-center gap-0.5" role="img" aria-label={d.reviewRating(item.review.rating)}>
                  {Array.from({ length: 5 }, (_, i) => (
                    <Star key={i} aria-hidden className={i < item.review!.rating ? "size-5 fill-rating text-rating" : "size-5 text-line-strong"} />
                  ))}
                </span>
                {item.review.text && <p className="text-base whitespace-pre-line text-ink-soft">{item.review.text}</p>}
              </div>
            </Card>
          )}

          {item.canLike && (
            <div className="flex flex-col gap-2">
              <ButtonLink href={wantSimilarHref(item.id)} fullWidth>
                {d.wantSimilar}
              </ButtonLink>
              <p className="text-base text-muted">{user ? d.wantSimilarHint : d.guestHint}</p>
            </div>
          )}
          {item.own && <p className="rounded-control bg-sunken p-4 text-base text-ink">{d.own}</p>}
          {item.canFeature && <FeatureToggle itemId={item.id} featured={item.featured} />}
        </div>
      </div>
    </Container>
  );
}
