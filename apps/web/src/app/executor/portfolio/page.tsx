import type { Metadata } from "next";
import { ImageOff, Plus } from "lucide-react";
import { ru } from "@/i18n/ru";
import { listOwnPortfolio } from "@/modules/companies";
import { requireUserPage } from "@/modules/identity";
import { Alert, ButtonLink, Container, EmptyState, Money, PageHeader, PhotoCard, StatusBadge } from "@/ui";
import { WorkActions } from "./WorkActions";

const t = ru.companies.portfolio;
const x = ru.executor.portfolio;

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
      <PageHeader title={t.title} back={{ href: "/" }} actions={items.length > 0 ? addButton : undefined} className="pb-0" />

      {items.length === 0 ? (
        <EmptyState icon={<ImageOff />} title={t.empty.title} description={t.empty.text} action={addButton} />
      ) : (
        <div className="flex flex-col gap-4">
          <p id="works" className="text-base text-muted">
            {x.count(items.length)}
          </p>
          <ul aria-labelledby="works" className="grid grid-cols-[repeat(auto-fill,minmax(min(100%,18rem),1fr))] gap-4">
            {items.map((item) => {
              const cover = item.photos.find((p) => p.src);
              return (
                <PhotoCard
                  key={item.id}
                  as="li"
                  href={`/executor/portfolio/${item.id}`}
                  image={cover?.src ? { src: cover.src, alt: cover.alt } : null}
                  title={<span className="break-words">{item.title}</span>}
                  titleAs="h2"
                  badge={<StatusBadge tone={item.published ? "success" : "neutral"}>{item.published ? t.published : t.hidden}</StatusBadge>}
                  meta={[{ text: `${item.furnitureType.name} · ${item.style.name}` }]}
                  aside={
                    item.priceFrom !== null ? (
                      <>
                        {ru.companies.catalog.priceFrom} <Money amount={item.priceFrom} />
                      </>
                    ) : undefined
                  }
                  footer={<WorkActions id={item.id} title={item.title} published={item.published} withEdit={false} />}
                />
              );
            })}
          </ul>
          <Alert tone="accent">{x.fromDeals}</Alert>
        </div>
      )}
    </Container>
  );
}
