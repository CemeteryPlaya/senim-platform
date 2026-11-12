import type { Metadata } from "next";
import { ImageOff, Plus } from "lucide-react";
import { ru } from "@/i18n/ru";
import { listOwnPortfolio } from "@/modules/companies";
import { requireUserPage } from "@/modules/identity";
import { ButtonLink, Container, EmptyState, PageHeader, StatusBadge, TrustNote, WorkCard } from "@/ui";
import { WorkActions } from "./WorkActions";

const t = ru.companies.portfolio;
const x = ru.executor.portfolio;

export const metadata: Metadata = { title: t.title };

/**
 * Своё портфолио в стиле «B + A»: карточки работ как в каталоге (WorkCard: фото, цена «от», тип и стиль), метка
 * «Опубликована / Скрыта», под карточкой — публикация и удаление. «Добавить работу» — единственная главная кнопка.
 */
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
          {/* Заголовок списка (h2): заголовки карточек — h3. */}
          <h2 id="works" className="text-base font-normal text-muted">
            {x.count(items.length)}
          </h2>
          <ul aria-labelledby="works" className="grid grid-cols-[repeat(auto-fill,minmax(min(100%,18rem),1fr))] gap-4">
            {items.map((item) => {
              const cover = item.photos.find((p) => p.src);
              return (
                <li key={item.id}>
                  <WorkCard
                    href={`/executor/portfolio/${item.id}`}
                    title={item.title}
                    photoUrl={cover?.src ?? null}
                    photoAlt={cover?.alt ?? ""}
                    priceFrom={item.priceFrom}
                    meta={[item.furnitureType.name, item.style.name]}
                    footer={<WorkActions id={item.id} title={item.title} published={item.published} withEdit={false} />}
                  >
                    <StatusBadge tone={item.published ? "success" : "neutral"}>{item.published ? t.published : t.hidden}</StatusBadge>
                  </WorkCard>
                </li>
              );
            })}
          </ul>
          <TrustNote>{x.fromDeals}</TrustNote>
        </div>
      )}
    </Container>
  );
}
