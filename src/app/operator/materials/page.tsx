import type { Metadata } from "next";
import { Ruler } from "lucide-react";
import { ru } from "@/i18n/ru";
import { isDemoMode, listMaterialPrices, type MaterialPriceRow } from "@/modules/operator";
import { Alert, Card, Container, EmptyState, PageHeader, SectionTitle } from "@/ui";
import { MATERIAL_CATEGORIES } from "@/verticals/furniture";
import { requireOperatorPage } from "../_lib/guard";
import { AddMaterialForm, MaterialItem } from "./MaterialForms";

const t = ru.materials;

export const metadata: Metadata = { title: t.title };

function MaterialList({ rows }: { rows: MaterialPriceRow[] }) {
  return (
    <ul className="rounded-card border border-line bg-surface px-5">
      {rows.map((row) => (
        <MaterialItem key={row.id} row={row} />
      ))}
    </ul>
  );
}

/**
 * Справочник цен материалов (ADR-007): разделы по категориям вертикали, внизу — архив.
 * В демо-режиме — пометка, что цифры демонстрационные и их нужно заменить.
 */
export default async function MaterialPricesPage() {
  const user = await requireOperatorPage("/operator/materials");
  const rows = await listMaterialPrices(user);
  const active = rows.filter((r) => r.active);
  const archived = rows.filter((r) => !r.active);
  const showDemoNote = isDemoMode() && rows.some((r) => r.isDemo);

  return (
    <Container size="form" className="pb-10">
      <PageHeader title={t.title} description={t.description} back={{ href: "/operator", label: ru.operator.backToPanel }} />
      <div className="flex flex-col gap-8">
        {showDemoNote && (
          <Alert tone="warning" title={t.demoTitle}>
            {t.demoNote}
          </Alert>
        )}
        <Card title={t.add.title} titleAs="h2">
          <AddMaterialForm />
        </Card>
        {rows.length === 0 && <EmptyState icon={<Ruler />} title={t.empty} titleAs="h2" />}
        {MATERIAL_CATEGORIES.map((category) => {
          const list = active.filter((r) => r.category === category);
          if (list.length === 0) return null;
          return (
            <section key={category} aria-labelledby={`materials-${category}`} className="flex flex-col gap-3">
              <SectionTitle id={`materials-${category}`} title={t.categories[category]} />
              <MaterialList rows={list} />
            </section>
          );
        })}
        {archived.length > 0 && (
          <section aria-labelledby="materials-archive" className="flex flex-col gap-3">
            <SectionTitle id="materials-archive" title={t.archiveTitle} />
            <p className="text-base text-muted">{t.archiveHint}</p>
            <MaterialList rows={archived} />
          </section>
        )}
      </div>
    </Container>
  );
}
