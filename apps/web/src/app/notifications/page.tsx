import { Bell, ChevronRight } from "lucide-react";
import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { ru } from "@/i18n/ru";
import { getCurrentUser, requireIntroduced } from "@/modules/identity";
import { listNotifications } from "@/modules/notifications";
import { Button, cn, Container, DateText, EmptyState, PageHeader, StatusBadge } from "@/ui";
import { EnablePush } from "@/app/_components/notifications";
import { markAllReadForm, openNotificationForm } from "./actions";

const t = ru.notifications.page;

export const metadata: Metadata = { title: t.title };

type Item = Awaited<ReturnType<typeof listNotifications>>[number];

/** Карточка — одна кнопка формы: отметить прочитанным и перейти к событию. Внутри кнопки только строчные элементы. */
function NotificationCard({ n }: { n: Item }) {
  const unread = !n.readAt;
  return (
    <form action={openNotificationForm}>
      <input type="hidden" name="id" value={n.id} />
      <button
        type="submit"
        className={cn(
          "flex min-h-control w-full cursor-pointer items-start gap-3 rounded-card border p-5 text-left transition-colors duration-150 hover:border-primary",
          unread ? "border-line-strong bg-surface" : "border-line bg-sunken",
        )}
      >
        <span className="flex min-w-0 flex-1 flex-col gap-1.5">
          <span className="flex flex-wrap items-center gap-2">
            {unread && <StatusBadge tone="accent">{t.unread}</StatusBadge>}
            <DateText value={n.createdAt} format="relative" className="text-sm text-muted" />
          </span>
          <span className="text-lg leading-snug font-bold text-ink">{n.title}</span>
          <span className="text-base text-ink-soft">{n.body}</span>
        </span>
        <ChevronRight aria-hidden className="mt-1 size-6 shrink-0 text-muted" />
      </button>
    </form>
  );
}

export default async function NotificationsPage() {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  requireIntroduced(user, "/notifications");
  const items = await listNotifications(user.id, 50);
  const hasUnread = items.some((n) => !n.readAt);

  return (
    <Container size="form">
      <PageHeader
        title={t.title}
        back={{ href: "/" }}
        actions={
          hasUnread && (
            <form action={markAllReadForm}>
              <Button type="submit" variant="soft">
                {t.markAllRead}
              </Button>
            </form>
          )
        }
      />
      <div className="pb-4">
        <EnablePush />
      </div>
      {items.length === 0 ? (
        <EmptyState icon={<Bell />} title={t.empty} description={t.emptyHint} />
      ) : (
        <ul className="flex flex-col gap-3 pb-8">
          {items.map((n) => (
            <li key={n.id}>
              <NotificationCard n={n} />
            </li>
          ))}
        </ul>
      )}
    </Container>
  );
}
