import { unreadCount } from "@/modules/notifications";
import { BellLink } from "./BellLink";

export type NotificationBellProps = {
  /** id текущего пользователя (из getCurrentUser в layout/шапке). */
  userId: string;
  /** Например, "lg:hidden" — показывать только на телефоне, как MobileBell. */
  className?: string;
};

/** Серверный компонент: читает число непрочитанных и рисует колокольчик-ссылку на /notifications. */
export async function NotificationBell({ userId, className }: NotificationBellProps) {
  const count = await unreadCount(userId);
  return <BellLink count={count} className={className} />;
}
