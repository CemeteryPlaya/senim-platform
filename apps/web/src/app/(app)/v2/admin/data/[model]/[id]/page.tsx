import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { ru } from "@/i18n/ru";
import { Card, List, ListRow, PageTitle, Section, Stack } from "@/kit";
import { getRecord, type AdminRelation } from "@/modules/admin";
import { isAppError } from "@/platform/errors";
import { pageHref, requireAdmin } from "../../../../../_shell/auth";
import { to } from "../../../../../_shell/paths";
import { recordPath, tablePath } from "../../../_parts/values";
import { RecordForm } from "./RecordForm";

const t = ru.app.admin.record;

export const metadata: Metadata = { title: t.metaTitle };

type Props = { params: Promise<{ model: string; id: string }> };

/** Связь «один» — ссылка на связанную запись (нет — «нет»); «много» — число и список связанной таблицы по этой записи. */
function relationRow(relation: AdminRelation, id: string) {
  if (relation.kind === "one") {
    return relation.targetId === null ? (
      <ListRow key={relation.name} label={t.relationLabel(relation.name, relation.model)} value={t.relationEmpty} />
    ) : (
      <ListRow key={relation.name} label={t.relationLabel(relation.name, relation.model)} value={relation.targetId} href={to(recordPath(relation.model, relation.targetId))} />
    );
  }
  return (
    <ListRow
      key={relation.name}
      label={t.relationLabel(relation.name, relation.model)}
      value={t.relationCount(relation.count)}
      href={pageHref(tablePath(relation.model), { where: relation.field, value: id })}
    />
  );
}

/**
 * Карточка записи: поля, которые отдал модуль admin (скрытых нет ни в разметке, ни в данных RSC для формы), форма правки
 * редактируемых полей и связи. «Назад» — к таблице модели. Неизвестная таблица, запись или неверный ключ — 404.
 */
export default async function AdminRecordPage({ params }: Props) {
  const { model, id } = await params;
  const user = await requireAdmin(to(recordPath(model, id)));
  let record: Awaited<ReturnType<typeof getRecord>>;
  try {
    record = await getRecord(user, model, id);
  } catch (e) {
    if (isAppError(e) && (e.code === "NOT_FOUND" || e.code === "VALIDATION")) notFound();
    throw e;
  }
  const { row, fields, relations } = record;
  return (
    <Stack gap="section">
      <PageTitle title={model} back={{ href: to(tablePath(model)), label: model }} />
      {/* Новые прежние значения после сохранения — новая форма: правка не уходит с устаревшим `from`. */}
      <RecordForm key={JSON.stringify(row)} model={model} id={id} fields={fields} row={row} />
      <Section title={t.relations} id="relations">
        {relations.length === 0 ? (
          <p className="text-body text-muted">{t.noRelations}</p>
        ) : (
          <Card padded={false}>
            <List>{relations.map((relation) => relationRow(relation, id))}</List>
          </Card>
        )}
      </Section>
    </Stack>
  );
}
