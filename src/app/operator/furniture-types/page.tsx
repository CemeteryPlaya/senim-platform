import type { Metadata } from "next";
import { Sofa } from "lucide-react";
import { ru } from "@/i18n/ru";
import { listFurnitureTypes } from "@/modules/operator";
import { Card, Container, EmptyState, PageHeader, SectionTitle } from "@/ui";
import { requireOperatorPage } from "../_lib/guard";
import { AddTypeForm, TypeItem } from "./TypeForms";

const t = ru.operator.types;

export const metadata: Metadata = { title: t.title };

export default async function FurnitureTypesPage() {
  const user = await requireOperatorPage("/operator/furniture-types");
  const types = await listFurnitureTypes(user);

  return (
    <Container size="form" className="pb-10">
      <PageHeader title={t.title} description={t.description} back={{ href: "/operator", label: ru.operator.backToPanel }} />
      <div className="flex flex-col gap-6">
        <Card>
          <AddTypeForm />
        </Card>
        <section aria-labelledby="types-list" className="flex flex-col gap-4">
          <SectionTitle id="types-list" title={t.listTitle(types.length)} />
          {types.length === 0 ? (
            <EmptyState icon={<Sofa />} title={t.empty} titleAs="h3" />
          ) : (
            <ol className="rounded-card border border-line bg-surface px-5 shadow-card">
              {types.map((type, i) => (
                <TypeItem
                  key={type.id}
                  type={{ id: type.id, name: type.name, active: type.active, requests: type._count.requests, first: i === 0, last: i === types.length - 1 }}
                />
              ))}
            </ol>
          )}
        </section>
      </div>
    </Container>
  );
}
