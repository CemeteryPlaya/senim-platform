import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { cache } from "react";
import { Star } from "lucide-react";
import { ru } from "@/i18n/ru";
import { getPublicExecutorPage } from "@/modules/companies";
import { Container, DateText, PageHeader, StatusBadge } from "@/ui";
import { measurementText, Rating, SegmentBadge } from "../../catalog/_components/executor-bits";
import { WorkCard } from "../../catalog/_components/WorkCard";

const t = ru.companies.publicPage;
const e = ru.companies.executor;

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
 * Публичная страница исполнителя: по умолчанию «Исполнитель №N», город и район; в режиме «имя показано» (№6) —
 * наименование и полный адрес. Телефона и ИИН/БИН нет ни в одном режиме.
 */
export default async function ExecutorPublicPage({ params }: Props) {
  const page = await loadPage((await params).publicNumber);
  if (!page) notFound();
  const { view, about, portfolio, reviews } = page;

  return (
    <Container className="flex flex-col gap-8 pb-12">
      <PageHeader title={view.label} description={t.description[view.nameShown ? "shown" : "hidden"]} back={{ href: "/catalog", label: t.back }} className="pb-0" />

      <section aria-labelledby="facts" className="flex flex-col gap-4">
        <h2 id="facts" className="sr-only">
          {t.facts}
        </h2>
        <div className="flex flex-wrap items-center gap-3">
          <Rating avg={view.ratingAvg} count={view.reviewsCount} />
          <SegmentBadge segment={view.segment} />
        </div>
        <ul className="flex flex-col gap-2 text-base text-ink-soft">
          {view.address && <li>{ru.companies.identity.address}: {view.address}</li>}
          <li>{e.experience(view.yearsExperience)}</li>
          <li>{e.completedDeals(view.completedDeals)}</li>
          <li>
            {measurementText(view.measurementTerms, view.measurementFee)}
            {view.measurementTerms === "FEE_IF_NO_DEAL" && <span className="block text-sm text-muted">{e.measurementNote}</span>}
          </li>
        </ul>
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
      </section>

      <section aria-labelledby="about" className="flex max-w-prose flex-col gap-2">
        <h2 id="about" className="text-xl font-bold text-ink">
          {t.about}
        </h2>
        <p className="text-base whitespace-pre-line text-ink-soft">{about.trim() || t.aboutEmpty}</p>
      </section>

      <section aria-labelledby="works" className="flex flex-col gap-4">
        <h2 id="works" className="text-xl font-bold text-ink">
          {t.portfolio}
        </h2>
        {portfolio.length === 0 ? (
          <p className="text-base text-muted">{t.portfolioEmpty}</p>
        ) : (
          <ul className="grid grid-cols-[minmax(0,1fr)] gap-4 sm:grid-cols-[repeat(2,minmax(0,1fr))] lg:grid-cols-[repeat(3,minmax(0,1fr))]">
            {portfolio.map((card) => (
              <li key={card.id}>
                <WorkCard card={card} showExecutor={false} />
              </li>
            ))}
          </ul>
        )}
      </section>

      <section aria-labelledby="reviews" className="flex max-w-prose flex-col gap-4">
        <h2 id="reviews" className="text-xl font-bold text-ink">
          {t.reviews}
        </h2>
        {reviews.length === 0 ? (
          <p className="text-base text-muted">{t.reviewsEmpty}</p>
        ) : (
          <ul className="flex flex-col divide-y divide-line">
            {reviews.map((r) => (
              <li key={r.id} className="flex flex-col gap-1 py-4">
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
    </Container>
  );
}
