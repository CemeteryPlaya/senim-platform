import type { Metadata } from "next";
import { ru } from "@/i18n/ru";
import { listFurnitureTypes, requireExecutorPage } from "@/modules/companies";
import { Alert, Container, PageHeader } from "@/ui";
import { PortfolioForm } from "../PortfolioForm";

const t = ru.companies.portfolio;

export const metadata: Metadata = { title: t.newTitle };

export default async function NewWorkPage() {
  await requireExecutorPage("/executor/portfolio/new");
  const types = await listFurnitureTypes();
  return (
    <Container size="form" className="flex flex-col gap-6 pb-12">
      <PageHeader title={t.newTitle} back={{ href: "/executor/portfolio", label: t.back }} className="pb-0" />
      <Alert tone="info">{t.photos.saveFirst}</Alert>
      <PortfolioForm
        initial={{ furnitureTypeId: "", style: "", title: "", description: "", priceFrom: null, published: true }}
        types={types}
      />
    </Container>
  );
}
