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
 * Колокольчик со счётчиком непрочитанных — ссылка на уведомления: значок 24 px в круге 48 px, бейдж-капсула в правом
 * верхнем углу. Без своего материала: в шапке компьютера шапка уже стекло (никогда стекло на стекле), на телефоне он
 * стоит в строке заголовка, которая в покое не плавает над содержимым (разбор 3.2) — при наведении заливка fill.
 */
export function NotificationsLink({ unread }: { unread: number }) {
  return (
    <Link
      href={to("/notifications")}
      aria-label={notificationsLabel(unread)}
      className="relative inline-flex size-control items-center justify-center rounded-full text-ink no-underline pressable hover:bg-fill"
    >
      <Bell aria-hidden className="size-6" strokeWidth={1.75} />
      <Badge count={unread} className="absolute top-1 right-1" />
    </Link>
  );
}
