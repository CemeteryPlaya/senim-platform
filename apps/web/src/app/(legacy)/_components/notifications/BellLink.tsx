"use client";

import { Bell } from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { ru } from "@/i18n/ru";
import { cn } from "@/ui";

export const NOTIFICATIONS_HREF = "/notifications";

/** Колокольчик со счётчиком непрочитанных. Счётчик — для глаз; диктору число сообщает подпись ссылки. */
export function BellLink({ count, className }: { count: number; className?: string }) {
  const pathname = usePathname();
  const current = pathname === NOTIFICATIONS_HREF ? "page" : undefined;
  const t = ru.notifications.bell;
  return (
    <Link
      href={NOTIFICATIONS_HREF}
      aria-label={count > 0 ? t.labelUnread(count) : t.label}
      aria-current={current}
      className={cn(
        "relative inline-flex size-12 items-center justify-center rounded-full text-ink hover:bg-sunken",
        "aria-[current=page]:bg-accent-soft aria-[current=page]:text-primary",
        className,
      )}
    >
      <Bell aria-hidden className="size-6" />
      {count > 0 && (
        <span
          aria-hidden
          className="absolute top-0.5 right-0.5 inline-flex min-w-6 items-center justify-center rounded-full bg-danger px-1.5 text-sm leading-6 font-bold text-on-primary tabular-nums"
        >
          {count > 99 ? "99+" : count}
        </span>
      )}
    </Link>
  );
}
