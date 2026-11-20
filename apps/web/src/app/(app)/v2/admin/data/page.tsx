import type { Metadata } from "next";
import { ru } from "@/i18n/ru";
import { PageTitle, Stack, StatusChip, TextLink } from "@/kit";
import { listModels } from "@/modules/admin";
import { requireAdmin } from "../../../_shell/auth";
import { to } from "../../../_shell/paths";
import { TableOrCards } from "../../operator/_parts/TableOrCards";
import { tablePath } from "../_parts/values";

const t = ru.app.admin.data;

export const metadata: Metadata = { title: t.metaTitle };

/**
 * Все таблицы базы `apps/web` (модуль admin): имя как в схеме, число записей и «только чтение» у таблиц, которые
 * админка не правит. Раздел из меню: «Назад» не нужно; главной кнопки нет — каждая строка ведёт в свою таблицу.
 */
export default async function AdminDataPage() {
  const user = await requireAdmin(to("/admin/data"));
  const models = await listModels(user);
  return (
    <Stack gap="section">
      <PageTitle title={t.title} lead={t.lead} />
      <TableOrCards
        caption={t.title}
        captionHidden
        rows={models}
        rowKey={(m) => m.name}
        empty={{ title: t.empty, body: t.emptyBody }}
        columns={[
          { key: "model", header: t.columns.model, rowHeader: true, width: "mid", cell: (m) => <TextLink href={to(tablePath(m.name))}>{m.name}</TextLink> },
          { key: "count", header: t.columns.count, numeric: true, cell: (m) => m.count },
          { key: "access", header: t.columns.access, cell: (m) => (m.readonly ? <StatusChip tone="neutral">{t.readonly}</StatusChip> : t.editable) },
        ]}
      />
    </Stack>
  );
}
