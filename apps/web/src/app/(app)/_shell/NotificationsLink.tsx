import { Bell } from "lucide-react";
import Link from "next/link";
import { ru } from "@/i18n/ru";
import { Badge, cn } from "@/kit";
import { to } from "./paths";

/** Подпись ссылки для диктора: «Уведомления» или «Уведомления, 3 непрочитанных» (сам бейдж скрыт от диктора). */
export function notificationsLabel(unread: number): string {
  return unread > 0 ? `${ru.app.shell.notifications}, ${ru.app.kit.badge.unread(unread)}` : ru.app.shell.notifications;
}

/**
 * Колокольчик со счётчиком непрочитанных — ссылка на уведомления: значок 24 px в круге 48 px, бейдж-капсула в правом
 * верхнем углу. Верхняя строка телефона (`glass`) — круглая кнопка на стекле `glass-regular` (разбор 3.4, п. 4): она
 * плавает над содержимым. В шапке компьютера шапка уже стекло — колокольчик без своего материала (никогда стекло на
 * стекле), при наведении — заливка fill.
 */
export function NotificationsLink({ unread, glass = false }: { unread: number; glass?: boolean }) {
  return (
    <Link
      href={to("/notifications")}
      aria-label={notificationsLabel(unread)}
      className={cn(
        "relative inline-flex size-control items-center justify-center rounded-full text-ink no-underline pressable",
        glass ? "glass-regular" : "hover:bg-fill",
      )}
    >
      <Bell aria-hidden className="size-6" strokeWidth={1.75} />
      <Badge count={unread} className="absolute top-1 right-1" />
    </Link>
  );
}
