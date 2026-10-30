import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { ru } from "@/i18n/ru";
import { getOwnPortfolioItem, listFurnitureTypes, PORTFOLIO_MAX_PHOTOS } from "@/modules/companies";
import { requireUserPage } from "@/modules/identity";
import { isAppError } from "@/platform/errors";
import { Container, PageHeader } from "@/ui";
import type { StyleKey } from "@/verticals/furniture";
import { PortfolioForm } from "../PortfolioForm";
import { WorkPhotos } from "./WorkPhotos";

const t = ru.companies.portfolio;

export const metadata: Metadata = { title: t.editTitle };

type Props = { params: Promise<{ id: string }> };

export default async function EditWorkPage({ params }: Props) {
  const { id } = await params;
  const user = await requireUserPage(`/executor/portfolio/${id}`, "EXECUTOR");
  // Чужая или удалённая работа — 404, как будто её нет.
  const item = await getOwnPortfolioItem(user, id).catch((e: unknown) => {
    if (isAppError(e) && e.code === "NOT_FOUND") notFound();
    throw e;
  });
  const types = await listFurnitureTypes();

  return (
    <Container size="form" className="flex flex-col gap-8 pb-12">
      <PageHeader title={t.editTitle} back={{ href: "/executor/portfolio", label: t.back }} className="pb-0" />

      <WorkPhotos itemId={item.id} photos={item.photos} max={PORTFOLIO_MAX_PHOTOS} />

      <PortfolioForm
        itemId={item.id}
        initial={{
          furnitureTypeId: item.furnitureType.id,
          style: item.style.key as StyleKey,
          title: item.title,
          description: item.description,
          priceFrom: item.priceFrom,
          published: item.published,
        }}
        types={types}
      />
    </Container>
  );
}
