import type { Metadata } from "next";
import { ru } from "@/i18n/ru";
import { Card, EmptyState, List, ListItem, Narrow, PageTitle, Section, Stack } from "@/kit";
import { listFurnitureTypes } from "@/modules/operator";
import { requireOperator } from "../../../_shell/auth";
import { to } from "../../../_shell/paths";
import { AddTypeForm, TypeRow } from "./TypeForms";

const t = ru.app.operatorSettings.types;

export const metadata: Metadata = { title: t.metaTitle };

/**
 * Справочник типов мебели: то, что заказчик выбирает на первом шаге заявки. Сверху — новый тип (одно поле, главная кнопка
 * экрана), ниже — список в порядке показа: выше и ниже, переименовать, скрыть или показать. Раздел из меню: «Назад» не
 * нужно. Каждое изменение пишется в журнал аудита модулем; права проверяют действия (оператор — первой строкой).
 */
export default async function FurnitureTypesPage() {
  const user = await requireOperator(to("/operator/furniture-types"));
  const types = await listFurnitureTypes(user);
  return (
    <Narrow>
      <Stack gap="section">
        <PageTitle title={t.title} lead={t.lead} />
        <AddTypeForm />
        <Section title={t.listTitle(types.length)} id="types-list">
          {types.length === 0 ? (
            <EmptyState title={t.empty.title} body={t.empty.body} />
          ) : (
            <Card padded={false}>
              <List>
                {types.map((type, index) => (
                  <ListItem key={type.id}>
                    <TypeRow type={{ id: type.id, name: type.name, active: type.active, requests: type._count.requests, position: index + 1, count: types.length }} />
                  </ListItem>
                ))}
              </List>
            </Card>
          )}
        </Section>
      </Stack>
    </Narrow>
  );
}
