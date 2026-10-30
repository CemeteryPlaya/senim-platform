import type { Metadata } from "next";
import { ru } from "@/i18n/ru";
import { listFurnitureTypes } from "@/modules/operator";
import { Card, Container, EmptyState, PageHeader } from "@/ui";
import { requireOperatorPage } from "../_lib/guard";
import { AddTypeForm, TypeItem } from "./TypeForms";

const t = ru.operator.types;

export const metadata: Metadata = { title: t.title };

export default async function FurnitureTypesPage() {
  const user = await requireOperatorPage("/operator/furniture-types");
  const types = await listFurnitureTypes(user);

  return (
    <Container size="form">
      <PageHeader title={t.title} description={t.description} back={{ href: "/operator", label: ru.operator.backToPanel }} />
      <div className="flex flex-col gap-6">
        <Card>
          <AddTypeForm />
        </Card>
        {types.length === 0 ? (
          <EmptyState title={t.empty} />
        ) : (
          <ol className="rounded-card border border-line bg-surface px-5">
            {types.map((type, i) => (
              <TypeItem
                key={type.id}
                type={{ id: type.id, name: type.name, active: type.active, requests: type._count.requests, first: i === 0, last: i === types.length - 1 }}
              />
            ))}
          </ol>
        )}
      </div>
    </Container>
  );
}
