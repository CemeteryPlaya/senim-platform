import type { Metadata } from "next";
import { ImageOff, Plus } from "lucide-react";
import { ru } from "@/i18n/ru";
import { listOwnPortfolio } from "@/modules/companies";
import { requireUserPage } from "@/modules/identity";
import { ButtonLink, Container, EmptyState, Money, PageHeader, StatusBadge } from "@/ui";
import { WorkActions } from "./WorkActions";

const t = ru.companies.portfolio;

export const metadata: Metadata = { title: t.title };

/** Своё портфолио: опубликованные и скрытые работы, добавление, правка, публикация, удаление. */
export default async function PortfolioPage() {
  const user = await requireUserPage("/executor/portfolio", "EXECUTOR");
  const items = await listOwnPortfolio(user);
  const addButton = (
    <ButtonLink href="/executor/portfolio/new" icon={<Plus />}>
      {t.add}
    </ButtonLink>
  );

  return (
    <Container className="flex flex-col gap-6 pb-12">
      <PageHeader title={t.title} description={t.description} back={{ href: "/" }} actions={items.length > 0 ? addButton : undefined} className="pb-0" />

      {items.length === 0 ? (
        <EmptyState icon={<ImageOff />} title={t.empty.title} description={t.empty.text} action={addButton} />
      ) : (
        <ul className="grid grid-cols-[minmax(0,1fr)] gap-4 lg:grid-cols-[repeat(2,minmax(0,1fr))]">
          {items.map((item) => {
            const cover = item.photos.find((p) => p.src);
            return (
              <li key={item.id} className="flex flex-col gap-4 rounded-card border border-line bg-surface p-4 shadow-card sm:flex-row">
                {cover?.src ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={cover.src} alt={cover.alt} loading="lazy" className="aspect-[4/3] w-full shrink-0 rounded-control bg-sunken object-cover sm:w-48" />
                ) : (
                  <div className="flex aspect-[4/3] w-full shrink-0 items-center justify-center rounded-control bg-sunken text-sm text-muted sm:w-48">
                    {ru.companies.noPhoto}
                  </div>
                )}
                <div className="flex min-w-0 flex-1 flex-col gap-3">
                  <div className="flex flex-col gap-2">
                    <h2 className="text-lg font-bold break-words text-ink">{item.title}</h2>
                    <div className="flex flex-wrap gap-2">
                      <StatusBadge tone={item.published ? "success" : "neutral"}>{item.published ? t.published : t.hidden}</StatusBadge>
                      <StatusBadge tone="neutral">{item.furnitureType.name}</StatusBadge>
                      <StatusBadge tone="neutral">{item.style.name}</StatusBadge>
                    </div>
                    {item.priceFrom !== null && (
                      <p className="text-base font-semibold text-ink">
                        {ru.companies.catalog.priceFrom} <Money amount={item.priceFrom} />
                      </p>
                    )}
                  </div>
                  <WorkActions id={item.id} title={item.title} published={item.published} />
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </Container>
  );
}
