import { formatRelative } from "@/features/format/format";

export type NotificationRowView = { id: string; title: string; body: string; time: string; unread: boolean };

/** Что нужно от уведомления модуля (подмножество строки БД). */
type NotificationRow = { id: string; title: string; body: string; createdAt: Date; readAt: Date | null };

/** Строки списка: время словами («5 минут назад»), непрочитанное — по `readAt`. */
export function notificationRows(items: readonly NotificationRow[], now: Date = new Date()): NotificationRowView[] {
  return items.map((n) => ({ id: n.id, title: n.title, body: n.body, time: formatRelative(n.createdAt, now), unread: n.readAt === null }));
}

export const hasUnread = (rows: readonly NotificationRowView[]): boolean => rows.some((row) => row.unread);
