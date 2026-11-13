import type { Metadata } from "next";
import { ru } from "@/i18n/ru";
import { Button, Card, EmptyState, List, ListRow, Narrow, PageTitle, Stack } from "@/kit";
import { listNotifications, pushPublicKey } from "@/modules/notifications";
import { pageHref, requireV2User } from "../../_shell/auth";
import { to } from "../../_shell/paths";
import { markAllReadForm, openNotificationForm } from "./actions";
import { hasUnread, notificationRows, type NotificationRowView } from "./_parts/notification-view";
import { PushPanel } from "./PushPanel";

const t = ru.app.chat.notifications;

export const metadata: Metadata = { title: t.metaTitle };

/**
 * Строка-действие (kit `ListRow action`): форма с кнопкой — отметить прочитанным и перейти. Непрочитанное — точка и
 * заголовок 600; прочитанное — заголовок обычного веса; текст и время — вторичные, обычный вес. Фон один и тот же.
 */
function Row({ row }: { row: NotificationRowView }) {
  const label = (
    <span className="flex items-start gap-3">
      <span aria-hidden className={row.unread ? "mt-2.5 size-2 shrink-0 rounded-full bg-ink" : "mt-2.5 size-2 shrink-0"} />
      <span className="flex min-w-0 flex-1 flex-col gap-1">
        <span className={row.unread ? "text-body font-semibold wrap-break-word text-ink" : "text-body font-normal wrap-break-word text-ink"}>
          {row.unread && <span className="sr-only">{`${t.unread}: `}</span>}
          {row.title}
        </span>
        <span className="line-clamp-2 text-sub font-normal wrap-break-word text-muted">{row.body}</span>
        <span className="text-small font-normal text-muted">{row.time}</span>
      </span>
    </span>
  );
  return <ListRow label={label} action={openNotificationForm} fields={{ id: row.id }} />;
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
