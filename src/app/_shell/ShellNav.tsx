"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  Bell,
  ClipboardList,
  Ellipsis,
  FlaskConical,
  Handshake,
  Images,
  Inbox,
  Landmark,
  LayoutDashboard,
  LayoutGrid,
  Ruler,
  UserRound,
  type LucideIcon,
} from "lucide-react";
import { ru } from "@/i18n/ru";
import { cn } from "@/ui";
import type { NavIcon, NavItem } from "./nav";

const ICONS: Record<NavIcon, LucideIcon> = {
  catalog: LayoutGrid,
  requests: ClipboardList,
  deals: Handshake,
  notifications: Bell,
  incoming: Inbox,
  measurements: Ruler,
  profile: UserRound,
  portfolio: Images,
  operator: LayoutDashboard,
  bank: Landmark,
  demo: FlaskConical,
};

/** В нижней панели телефона — не больше 4 ячеек, чтобы подписи 16px помещались. */
const BAR_CELLS = 4;

function useCurrent() {
  const pathname = usePathname();
  return {
    pathname,
    current: (href: string) => (pathname === href || pathname.startsWith(`${href}/`) ? ("page" as const) : undefined),
  };
}

/** Строка ссылок в шапке на широком экране (lg+). */
export function DesktopNav({ items }: { items: readonly NavItem[] }) {
  const { current } = useCurrent();
  return (
    <nav aria-label={ru.common.shell.navLabel} className="hidden lg:block">
      <ul className="flex flex-wrap items-center gap-1">
        {items.map((item) => (
          <li key={item.href}>
            <Link
              href={item.href}
              aria-current={current(item.href)}
              className={cn(
                "flex min-h-control-sm items-center rounded-full px-4 text-base font-semibold text-ink no-underline transition-colors duration-150",
                "hover:bg-sunken aria-[current=page]:bg-accent-soft aria-[current=page]:text-primary",
              )}
            >
              {item.label}
            </Link>
          </li>
        ))}
      </ul>
    </nav>
  );
}

/** Колокольчик уведомлений в шапке телефона (как в макете); на широком экране — обычная ссылка в меню. */
export function MobileBell({ item }: { item: NavItem | undefined }) {
  const { current } = useCurrent();
  if (!item) return null;
  return (
    <Link
      href={item.href}
      aria-label={item.label}
      aria-current={current(item.href)}
      className="inline-flex size-12 items-center justify-center rounded-full text-ink hover:bg-sunken aria-[current=page]:bg-accent-soft aria-[current=page]:text-primary lg:hidden"
    >
      <Bell aria-hidden className="size-6" />
    </Link>
  );
}

/** Нижняя панель вкладок на телефоне (как в макете): иконка + подпись; лишние пункты — в «Ещё». */
export function MobileTabBar({ items }: { items: readonly NavItem[] }) {
  const { pathname, current } = useCurrent();
  const overflow = items.length > BAR_CELLS;
  const inBar = overflow ? items.slice(0, BAR_CELLS - 1) : items;
  const inMore = overflow ? items.slice(BAR_CELLS - 1) : [];
  const moreActive = inMore.some((item) => current(item.href));
  const cell = cn(
    "flex min-h-control w-full flex-col items-center justify-center gap-0.5 rounded-control px-1 py-1.5 text-center text-sm leading-tight font-semibold text-muted no-underline",
    "hover:bg-sunken aria-[current=page]:bg-accent-soft aria-[current=page]:text-primary",
  );

  return (
    <nav
      aria-label={ru.common.shell.navLabel}
      className="fixed inset-x-0 bottom-0 z-30 border-t border-line bg-surface pb-[env(safe-area-inset-bottom)] shadow-bar lg:hidden"
    >
      <ul className="mx-auto grid max-w-page gap-1 px-2 py-1.5" style={{ gridTemplateColumns: `repeat(${inBar.length + (overflow ? 1 : 0)}, minmax(0, 1fr))` }}>
        {inBar.map((item) => {
          const Icon = ICONS[item.icon];
          return (
            <li key={item.href} className="flex min-w-0">
              <Link href={item.href} aria-current={current(item.href)} className={cell}>
                <Icon aria-hidden className="size-6 shrink-0" />
                <span className="max-w-full break-words hyphens-auto">{item.label}</span>
              </Link>
            </li>
          );
        })}
        {overflow && (
          <li className="flex min-w-0">
            {/* key по адресу: после перехода список закрывается сам (layout не перемонтируется). */}
            <details key={pathname} className="group flex w-full">
              <summary
                aria-current={moreActive ? "page" : undefined}
                className={cn(cell, "list-none group-open:bg-sunken [&::-webkit-details-marker]:hidden")}
              >
                <Ellipsis aria-hidden className="size-6 shrink-0" />
                <span>{ru.common.shell.more}</span>
              </summary>
              <ul className="absolute inset-x-2 bottom-full mb-2 flex flex-col rounded-card border border-line bg-surface p-2 shadow-overlay">
                {inMore.map((item) => {
                  const Icon = ICONS[item.icon];
                  return (
                    <li key={item.href}>
                      <Link
                        href={item.href}
                        aria-current={current(item.href)}
                        className="flex min-h-control items-center gap-3 rounded-control px-4 text-base font-semibold text-ink no-underline hover:bg-sunken aria-[current=page]:bg-accent-soft aria-[current=page]:text-primary"
                      >
                        <Icon aria-hidden className="size-6 shrink-0" />
                        {item.label}
                      </Link>
                    </li>
                  );
                })}
              </ul>
            </details>
          </li>
        )}
      </ul>
    </nav>
  );
}
