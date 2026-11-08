import type { Metadata } from "next";
import Link from "next/link";
import { ChevronRight, MessageSquareText } from "lucide-react";
import { ru } from "@/i18n/ru";
import { listChats, type ChatListItem } from "@/modules/companies";
import { requireUserPage } from "@/modules/identity";
import { ButtonLink, Container, DateText, EmptyState, PageHeader, StatusBadge } from "@/ui";

const t = ru.chats;

export const metadata: Metadata = { title: t.metaTitle };

/** Карточка диалога — одна ссылка на чат отклика; текст превью уже замаскирован сервисом. */
function ChatRow({ chat }: { chat: ChatListItem }) {
  return (
    <li>
      <Link
        href={chat.href}
        className="flex min-h-control min-w-0 items-start gap-3 rounded-card border border-line bg-surface p-4 text-ink no-underline transition-colors duration-150 hover:border-primary"
      >
        <span className="flex min-w-0 flex-1 flex-col gap-1">
          <span className="flex flex-wrap items-baseline justify-between gap-x-3">
            <span className="text-lg font-bold break-words">{chat.counterpart}</span>
            {chat.lastAt && <DateText value={chat.lastAt} format="relative" className="text-sm text-muted" />}
          </span>
          <span className="text-base break-words text-ink-soft">{chat.title}</span>
          <span className="line-clamp-2 text-base break-words text-ink-soft">{chat.lastMessage ?? t.noMessages}</span>
          {chat.closed && (
            <StatusBadge tone="neutral" className="self-start">
              {t.closed}
            </StatusBadge>
          )}
        </span>
        <ChevronRight aria-hidden className="mt-1 size-6 shrink-0 text-muted" />
      </Link>
    </li>
  );
}

function Empty({ role }: { role: string }) {
  const e = t.empty;
  const icon = <MessageSquareText />;
  if (role === "CLIENT") {
    return <EmptyState title={e.title} description={e.client.description} icon={icon} action={<ButtonLink href="/requests/new">{e.client.action}</ButtonLink>} />;
  }
  if (role === "EXECUTOR") {
    return <EmptyState title={e.title} description={e.executor.description} icon={icon} action={<ButtonLink href="/executor/requests">{e.executor.action}</ButtonLink>} />;
  }
  return <EmptyState title={e.title} description={e.other.description} icon={icon} />;
}

/** Вкладка «Чат»: диалоги по откликам, где человек — заказчик заявки или исполнитель. Владение проверяет сервис. */
export default async function ChatsPage() {
  // Без списка ролей: оператор и замерщик тоже открывают вкладку и видят пустой список.
  const user = await requireUserPage("/chats");
  const chats = await listChats(user);

  return (
    <Container size="form">
      <PageHeader title={t.title} back={{ href: "/" }} />
      {chats.length === 0 ? (
        <Empty role={user.role} />
      ) : (
        <ul aria-label={t.listLabel} className="flex flex-col gap-3 pb-10">
          {chats.map((chat) => (
            <ChatRow key={chat.offerId} chat={chat} />
          ))}
        </ul>
      )}
    </Container>
  );
}
