import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { ru } from "@/i18n/ru";
import { DataTable, PageTitle, Stack, StatusChip, TextLink } from "@/kit";
import type { CurrentUser } from "@/modules/identity";
import { getRequestDesignFiles, type DesignFileView } from "@/modules/requests";
import { isAppError } from "@/platform/errors";
import { requireOperator } from "../../../../_shell/auth";
import { to } from "../../../../_shell/paths";
import { requestNumberOf } from "../request-number";
import { FileVisibilityForm } from "./FileVisibilityForm";

const t = ru.app.operatorDisputes.requestFiles;

export const metadata: Metadata = { title: t.metaTitle };

type Props = { params: Promise<{ number: string }> };

async function load(user: CurrentUser, number: number) {
  try {
    return await getRequestDesignFiles(user, number);
  } catch (e) {
    if (isAppError(e) && e.code === "NOT_FOUND") notFound();
    throw e;
  }
}

const label = (f: DesignFileView) => (f.kind === "pdf" ? t.pdf(f.n) : t.photo(f.n));

/**
 * Файлы заявки: дизайн-проект покупателя (фото и PDF по порядку, ссылки на 15 минут, в новой вкладке) — у каждого «Скрыть»
 * или «Вернуть». Скрытый файл не видят мастера и сделка, покупатель видит пометку. Сюда ведут форма «Открыть заявку» на
 * «Заявках без откликов» и ссылка «Файлы заявки» в карточке сделки. Главной кнопки нет: кнопки файлов равноправны.
 * Номер не число или заявки нет — 404.
 */
export default async function RequestFilesPage({ params }: Props) {
  const { number: raw } = await params;
  const user = await requireOperator(to(`/operator/requests/${encodeURIComponent(raw)}`));
  const number = requestNumberOf(raw);
  if (number === null) notFound();
  const { files } = await load(user, number);
  const c = t.columns;

  return (
    <Stack gap="section">
      <PageTitle title={t.title(number)} back={{ href: to("/operator/requests"), label: t.back }} lead={t.lead} />
      <DataTable
        caption={t.tableCaption}
        captionHidden
        rows={files}
        rowKey={(f) => f.id}
        empty={t.empty}
        columns={[
          {
            key: "file",
            header: c.file,
            rowHeader: true,
            cell: (f) => (
              <TextLink href={f.src} external>
                {label(f)}
              </TextLink>
            ),
          },
          { key: "state", header: c.state, cell: (f) => <StatusChip tone={f.hidden ? "warn" : "neutral"}>{f.hidden ? t.hidden : t.shown}</StatusChip> },
          { key: "action", header: c.action, cell: (f) => <FileVisibilityForm fileId={f.id} hidden={f.hidden} file={label(f)} /> },
        ]}
      />
    </Stack>
  );
}
