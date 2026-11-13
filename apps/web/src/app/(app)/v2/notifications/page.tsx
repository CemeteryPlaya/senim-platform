import type { Metadata } from "next";
import { ru } from "@/i18n/ru";
import { Button, Card, EmptyState, HiddenField, List, ListItem, Narrow, PageTitle, Stack } from "@/kit";
import { listNotifications, pushPublicKey } from "@/modules/notifications";
import { pageHref, requireV2User } from "../../_shell/auth";
import { to } from "../../_shell/paths";
import { markAllReadForm, openNotificationForm } from "./actions";
import { hasUnread, notificationRows, type NotificationRowView } from "./_parts/notification-view";
import { PushPanel } from "./PushPanel";

const t = ru.app.chat.notifications;

export const metadata: Metadata = { title: t.metaTitle };

/** Карточка — форма: отметить прочитанным и перейти. Непрочитанное — точка и жирный заголовок, фон тот же. */
function Row({ row }: { row: NotificationRowView }) {
  return (
    <ListItem>
      <form action={openNotificationForm}>
        <HiddenField name="id" value={row.id} />
        <Button type="submit" variant="quiet" full className="h-auto justify-start rounded-none px-4 py-3 text-left font-normal">
          <span className="flex items-start gap-3 text-left">
            <span aria-hidden className={row.unread ? "mt-2.5 size-2 shrink-0 rounded-full bg-ink" : "mt-2.5 size-2 shrink-0"} />
            <span className="flex min-w-0 flex-1 flex-col gap-1">
              <span className={row.unread ? "text-card wrap-break-word text-ink" : "text-body wrap-break-word text-ink"}>
                {row.unread && <span className="sr-only">{`${t.unread}: `}</span>}
                {row.title}
              </span>
              <span className="line-clamp-2 text-body wrap-break-word text-muted">{row.body}</span>
              <span className="text-sub text-muted">{row.time}</span>
            </span>
          </span>
        </Button>
      </form>
    </ListItem>
  );
}

/**
 * Уведомления: список (заголовок, текст, время), переход по уведомлению отмечает его прочитанным; «Прочитать все» —
 * тихая кнопка над списком; блок «Уведомления на этом устройстве» (push). Главного действия нет. Пусто — обучающий экран.
 */
export default async function NotificationsPage() {
  const user = await requireV2User(pageHref("/notifications"));
  const rows = notificationRows(await listNotifications(user.id, 50));
  const publicKey = pushPublicKey();

  return (
    <Stack gap="section">
      <PageTitle title={t.title} back={{ href: to("/"), label: t.back }} />
      <Narrow>
        <Stack>
          {publicKey && <PushPanel publicKey={publicKey} />}
          {rows.length === 0 ? (
            <EmptyState title={t.emptyTitle} body={t.emptyBody} />
          ) : (
            <>
              {hasUnread(rows) && (
                <form action={markAllReadForm} className="flex justify-end">
                  <Button type="submit" variant="quiet" flush>
                    {t.markAll}
                  </Button>
                </form>
              )}
              <Card padded={false}>
                <nav aria-label={t.label}>
                  <List>{rows.map((row) => <Row key={row.id} row={row} />)}</List>
                </nav>
              </Card>
            </>
          )}
        </Stack>
      </Narrow>
    </Stack>
  );
}
