import type { Metadata } from "next";
import Link from "next/link";
import { ChevronRight } from "lucide-react";
import { ru } from "@/i18n/ru";
import { Card, EmptyState, List, ListItem, Narrow, PageTitle, Stack, StatusChip, TextLink } from "@/kit";
import { listChats } from "@/modules/companies";
import { listMyRequests } from "@/modules/requests";
import { masterStatusOf, pageHref, requireParty } from "../../_shell/auth";
import { to } from "../../_shell/paths";
import { chatRows, type ChatRowView } from "./_parts/chat-view";

const t = ru.app.chat.list;
const tm = ru.app.masterDeal.chat.list;

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
 * «Чаты» стороны в активной роли (`requireParty`): покупателю — диалоги по предложениям на свои заявки, мастеру — по своим
 * предложениям; свежие сверху, диалоги другой роли сюда не попадают (модуль выбирает по активной роли). Собеседник — как
 * называет модуль («Исполнитель №N» до оферты, имя после), мастеру — «Покупатель»; последнее сообщение уже замаскировано
 * модулем. Модуль не отдаёт признак «непрочитано», поэтому его на экране нет. Пусто — обучающий экран без кнопки и ссылка:
 * покупателю с заявками — «Мои заявки», одобренному мастеру — «Заявки».
 */
export default async function ChatsPage() {
  const { user, side } = await requireParty(pageHref("/chats"));
  const rows = chatRows(await listChats(user), new Date(), side);
  const title = <PageTitle title={t.title} />;

  if (rows.length === 0) {
    const empty =
      side === "EXECUTOR"
        ? { title: tm.emptyTitle, body: tm.emptyBody, link: masterStatusOf(user) === "approved" ? { href: to("/executor/requests"), label: tm.toRequests } : null }
        : { title: t.emptyTitle, body: t.emptyBody, link: (await listMyRequests(user)).length > 0 ? { href: to("/requests"), label: t.myRequests } : null };
    return (
      <Stack gap="section">
        {title}
        <EmptyState title={empty.title} body={empty.body} />
        {empty.link && <TextLink href={empty.link.href}>{empty.link.label}</TextLink>}
      </Stack>
    );
  }

  return (
    <Stack gap="section">
      {title}
      <Narrow>
        <Card padded={false}>
          <nav aria-label={side === "EXECUTOR" ? tm.label : t.label}>
            <List>{rows.map((row) => <Row key={row.offerId} row={row} />)}</List>
          </nav>
        </Card>
      </Narrow>
    </Stack>
  );
}
