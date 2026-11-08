import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { cache } from "react";
import { BadgeCheck, Star } from "lucide-react";
import { ru } from "@/i18n/ru";
import { getPublicExecutorPage, type PortfolioCard, type PublicExecutorView } from "@/modules/companies";
import { ButtonLink, Container, DateText, DetailColumns, formatDeals, formatYears, KeyValueList, Money, PageHeader, StatusBadge, TrustNote } from "@/ui";
import { measurementText, Rating, SegmentBadge } from "../../catalog/_components/executor-bits";
import { wantSimilarHref, WorkCard } from "../../catalog/_components/WorkCard";

const t = ru.companies.publicPage;
const e = ru.companies.executor;
const c = ru.companies.catalog;

type Props = { params: Promise<{ publicNumber: string }> };

/** Один запрос к БД на HTTP-запрос: и метаданные, и страница. */
const loadPage = cache(async (raw: string) => {
  const publicNumber = Number(raw);
  if (!Number.isInteger(publicNumber) || publicNumber < 1) return null;
  return getPublicExecutorPage(publicNumber);
});

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const page = await loadPage((await params).publicNumber);
  return { title: page ? page.view.label : ru.common.errors.notFound };
}

/**
 * Публичная страница исполнителя — «карточка работы мастера» макета b-plus-a: карточка с фото последней работы, ценой «от»,
 * метками, «метка — значение» и плашкой защиты денег (на десктопе — правая колонка) → о себе, работы, отзывы. Главное действие — «Хочу похожее»
 * на последнюю работу (прямая заявка этому исполнителю, ?like=): на телефоне закреплено внизу, на десктопе — справа.
 * По умолчанию «Исполнитель №N», город и район; в режиме «имя показано» (№6) — наименование и полный адрес.
 * Телефона и ИИН/БИН нет ни в одном режиме.
 */
export default async function ExecutorPublicPage({ params }: Props) {
  const page = await loadPage((await params).publicNumber);
  if (!page) notFound();
  const { view, about, portfolio, reviews } = page;
  const hero = portfolio[0];

  return (
    <Container className="flex flex-col gap-6 pb-12">
      <PageHeader title={view.label} description={t.description[view.nameShown ? "shown" : "hidden"]} back={{ href: "/catalog", label: t.back }} className="pb-0" />
      <DetailColumns
        aside={<Summary view={view} hero={hero} />}
        main={
          <>
            <section aria-labelledby="about" className="flex flex-col gap-2">
              <h2 id="about" className="text-xl font-bold text-ink">
                {t.about}
              </h2>
              <p className="max-w-prose text-base whitespace-pre-line text-ink-soft">{about.trim() || t.aboutEmpty}</p>
            </section>
            <Works portfolio={portfolio} />
            <Reviews reviews={reviews} />
          </>
        }
        action={
          hero && (
            <ButtonLink href={wantSimilarHref(hero.id)} fullWidth aria-label={c.wantSimilarLabel(hero.title, view.label)}>
              {c.wantSimilar}
            </ButtonLink>
          )
        }
      />
    </Container>
  );
}

/** Цена «от» последней работы, метки, «метка — значение» и плашка защиты денег (правая колонка десктопа). */
function Summary({ view, hero }: { view: PublicExecutorView; hero: PortfolioCard | undefined }) {
  const k = t.kv;
  const cover = hero?.photos.find((p) => p.src);
  return (
    <section aria-labelledby="facts" className="flex flex-col gap-4 overflow-hidden rounded-card border border-line bg-surface p-4 sm:p-5">
      <h2 id="facts" className="sr-only">
        {t.facts}
      </h2>
      {cover?.src && (
        // Фото работы — из хранилища по ссылке или демо-SVG: оптимизатор next/image не нужен.
        // eslint-disable-next-line @next/next/no-img-element
        <img src={cover.src} alt={cover.alt} className="-mx-4 -mt-4 aspect-[4/3] w-[calc(100%+2rem)] max-w-none bg-sunken object-cover sm:-mx-5 sm:-mt-5 sm:w-[calc(100%+2.5rem)] lg:aspect-[16/9]" />
      )}
      {hero && (
        <div className="flex flex-col gap-1">
          <p className="text-base break-words text-muted">
            {t.heroWork}: {hero.title}
          </p>
          {hero.priceFrom !== null && (
            <p className="text-2xl font-extrabold text-ink">
              {c.priceFrom} <Money amount={hero.priceFrom} />
            </p>
          )}
        </div>
      )}
      <div className="flex flex-wrap items-center gap-2">
        {/* Публичная страница есть только у исполнителя, подтверждённого оператором (VISIBLE_EXECUTOR). */}
        <StatusBadge tone="success" icon={<BadgeCheck />}>
          {ru.common.ui.workCard.verified}
        </StatusBadge>
        <StatusBadge tone="neutral">{formatDeals(view.completedDeals)}</StatusBadge>
        <SegmentBadge segment={view.segment} />
      </div>
      <Rating avg={view.ratingAvg} count={view.reviewsCount} />
      <KeyValueList
        rows={[
          ...(view.address ? [{ label: k.address, value: view.address }] : []),
          { label: k.experience, value: view.yearsExperience === 0 ? k.experienceUnknown : formatYears(view.yearsExperience) },
          { label: k.deals, value: String(view.completedDeals) },
          {
            label: k.measurement,
            value: (
              <>
                {measurementText(view.measurementTerms, view.measurementFee)}
                {view.measurementTerms === "FEE_IF_NO_DEAL" && <span className="block text-sm font-normal text-muted">{e.measurementNote}</span>}
              </>
            ),
          },
        ]}
      />
      {view.specializations.length > 0 && (
        <div className="flex flex-col gap-2">
          <p className="text-base font-semibold text-ink">{e.specializations}</p>
          <ul className="flex flex-wrap gap-2">
            {view.specializations.map((s) => (
              <li key={s.slug}>
                <StatusBadge tone="neutral">{s.name}</StatusBadge>
              </li>
            ))}
          </ul>
        </div>
      )}
      <TrustNote>{t.trustNote}</TrustNote>
    </section>
  );
}

function Works({ portfolio }: { portfolio: PortfolioCard[] }) {
  return (
    <section aria-labelledby="works" className="flex flex-col gap-4">
      <h2 id="works" className="text-xl font-bold text-ink">
        {t.portfolio}
      </h2>
      {portfolio.length === 0 ? (
        <p className="text-base text-muted">{t.portfolioEmpty}</p>
      ) : (
        <ul className="grid grid-cols-[repeat(auto-fill,minmax(min(16rem,100%),1fr))] gap-4">
          {portfolio.map((card) => (
            <li key={card.id}>
              <WorkCard card={card} showExecutor={false} />
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

function Reviews({ reviews }: { reviews: { id: string; rating: number; text: string; createdAt: Date }[] }) {
  return (
    <section aria-labelledby="reviews" className="flex max-w-prose flex-col gap-4">
      <h2 id="reviews" className="text-xl font-bold text-ink">
        {t.reviews}
      </h2>
      {reviews.length === 0 ? (
        <p className="text-base text-muted">{t.reviewsEmpty}</p>
      ) : (
        <ul className="flex flex-col divide-y divide-line">
          {reviews.map((r) => (
            <li key={r.id} id={`review-${r.id}`} className="flex scroll-mt-6 flex-col gap-1 py-4">
              <p className="flex flex-wrap items-center gap-3">
                <span className="inline-flex items-center gap-0.5" aria-label={t.reviewRating(r.rating)} role="img">
                  {Array.from({ length: 5 }, (_, i) => (
                    <Star key={i} aria-hidden className={i < r.rating ? "size-5 fill-rating text-rating" : "size-5 text-line-strong"} />
                  ))}
                </span>
                <DateText value={r.createdAt} format="date" className="text-sm text-muted" />
              </p>
              {r.text && <p className="text-base whitespace-pre-line text-ink-soft">{r.text}</p>}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
