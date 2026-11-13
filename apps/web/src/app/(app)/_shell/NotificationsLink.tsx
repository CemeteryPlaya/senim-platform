import { Bell } from "lucide-react";
import Link from "next/link";
import { ru } from "@/i18n/ru";
import { Badge } from "@/kit";
import { to } from "./paths";

/** Подпись ссылки для диктора: «Уведомления» или «Уведомления, 3 непрочитанных» (сам бейдж скрыт от диктора). */
export function notificationsLabel(unread: number): string {
  return unread > 0 ? `${ru.app.shell.notifications}, ${ru.app.kit.badge.unread(unread)}` : ru.app.shell.notifications;
}

/**
 * Колокольчик со счётчиком непрочитанных — ссылка на уведомления. Один вид для шапки компьютера и верхней строки
 * телефона: значок 24 px в области нажатия 48 px, бейдж в правом верхнем углу значка.
 */
export function NotificationsLink({ unread }: { unread: number }) {
  return (
    <Link
      href={to("/notifications")}
      aria-label={notificationsLabel(unread)}
      className="relative inline-flex size-control items-center justify-center rounded-control text-ink no-underline pressable hover:bg-line"
    >
      <Bell aria-hidden className="size-6" />
      <Badge count={unread} className="absolute top-1 right-0" />
    </Link>
  );
}
