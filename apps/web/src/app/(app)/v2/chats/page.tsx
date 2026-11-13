import type { Metadata } from "next";
import Link from "next/link";
import { ChevronRight } from "lucide-react";
import { ru } from "@/i18n/ru";
import { Card, EmptyState, List, ListItem, Narrow, PageTitle, Stack, StatusChip, TextLink } from "@/kit";
import { listChats } from "@/modules/companies";
import { listMyRequests } from "@/modules/requests";
import { pageHref, requireBuyer } from "../../_shell/auth";
import { to } from "../../_shell/paths";
import { chatRows, type ChatRowView } from "./_parts/chat-view";

const t = ru.app.chat.list;

export const metadata: Metadata = { title: t.metaTitle };

/** Строка-ссылка: собеседник и время, к чему относится, последнее сообщение одной строкой с обрезкой. */
function Row({ row }: { row: ChatRowView }) {
  return (
    <ListItem>
      <Link
        href={row.href}
        className="flex min-h-control w-full items-center gap-4 px-4 py-3 text-body no-underline transition-colors duration-100 hover:bg-canvas active:bg-line"
      >
        <span className="flex min-w-0 flex-1 flex-col gap-1">
          <span className="flex items-baseline justify-between gap-3">
            <span className="min-w-0 text-card wrap-anywhere text-ink">{row.counterpart}</span>
            {row.time && <span className="shrink-0 text-sub text-muted">{row.time}</span>}
          </span>
          <span className="text-sub wrap-break-word text-muted">{row.title}</span>
          <span className="truncate text-body text-ink">{row.last}</span>
          {row.closed && (
            <span className="flex">
              <StatusChip tone="neutral">{t.closed}</StatusChip>
            </span>
          )}
        </span>
        <ChevronRight aria-hidden className="size-5 shrink-0 text-muted" />
      </Link>
    </ListItem>
  );
}

/**
 * «Чаты» покупателя: диалоги по предложениям на свои заявки, свежие сверху. Собеседник — как называет модуль
 * («Исполнитель №N» до оферты, имя после); последнее сообщение уже замаскировано модулем. Модуль не отдаёт признак
 * «непрочитано», поэтому его на экране нет. Пусто — обучающий экран без кнопки; есть заявки — ссылка «Мои заявки».
 */
export default async function ChatsPage() {
  const user = await requireBuyer(pageHref("/chats"));
  const rows = chatRows(await listChats(user));
  const title = <PageTitle title={t.title} />;

  if (rows.length === 0) {
    const hasRequests = (await listMyRequests(user)).length > 0;
    return (
      <Stack gap="section">
        {title}
        <EmptyState title={t.emptyTitle} body={t.emptyBody} />
        {hasRequests && <TextLink href={to("/requests")}>{t.myRequests}</TextLink>}
      </Stack>
    );
  }

  return (
    <Stack gap="section">
      {title}
      <Narrow>
        <Card padded={false}>
          <nav aria-label={t.label}>
            <List>{rows.map((row) => <Row key={row.offerId} row={row} />)}</List>
          </nav>
        </Card>
      </Narrow>
    </Stack>
  );
}
