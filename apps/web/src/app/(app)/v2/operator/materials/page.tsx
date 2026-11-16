import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { ru } from "@/i18n/ru";
import { Card, EmptyState, List, ListItem, Narrow, PageTitle, Section, Stack } from "@/kit";
import { listMaterialPrices, type MaterialPriceRow } from "@/modules/operator";
import { isEnabled } from "@/platform/features";
import { MATERIAL_CATEGORIES } from "@/verticals/furniture";
import { requireOperator } from "../../../_shell/auth";
import { to } from "../../../_shell/paths";
import { AddMaterialForm, MaterialItem } from "./MaterialForms";

const t = ru.app.operatorSettings.materials;

export const metadata: Metadata = { title: t.metaTitle };

function MaterialList({ rows }: { rows: MaterialPriceRow[] }) {
  return (
    <Card padded={false}>
      <List>
        {rows.map((row) => (
          <ListItem key={row.id}>
            <MaterialItem row={{ ...row, updatedAt: row.updatedAt.toISOString() }} />
          </ListItem>
        ))}
      </List>
    </Card>
  );
}

/**
 * Справочник цен материалов (ADR-007): сверху — новый материал (главная кнопка экрана), ниже — разделы по категориям
 * вертикали, внизу — архив. Раздел есть только при флаге «Калькулятор материалов» (как в v1): без него — 404. Права
 * проверяют действия и модуль.
 */
export default async function MaterialPricesPage() {
  if (!isEnabled("materialsCalculator")) notFound();
  const user = await requireOperator(to("/operator/materials"));
  const rows = await listMaterialPrices(user);
  const active = rows.filter((row) => row.active);
  const archived = rows.filter((row) => !row.active);
  return (
    <Narrow>
      <Stack gap="section">
        <PageTitle title={t.title} lead={t.lead} />
        <Section title={t.addTitle} id="material-add">
          <AddMaterialForm />
        </Section>
        {rows.length === 0 && <EmptyState title={t.empty.title} body={t.empty.body} />}
        {MATERIAL_CATEGORIES.map((category) => {
          const list = active.filter((row) => row.category === category);
          if (list.length === 0) return null;
          return (
            <Section key={category} title={t.categories[category]} id={`materials-${category}`}>
              <MaterialList rows={list} />
            </Section>
          );
        })}
        {archived.length > 0 && (
          <Section title={t.archiveTitle} id="materials-archive">
            <Stack>
              <p className="text-body text-muted">{t.archiveHint}</p>
              <MaterialList rows={archived} />
            </Stack>
          </Section>
        )}
      </Stack>
    </Narrow>
  );
}
