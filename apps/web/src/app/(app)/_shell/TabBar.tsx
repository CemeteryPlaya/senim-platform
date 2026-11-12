"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { ru } from "@/i18n/ru";
import { cn } from "@/kit/cn";
import { activeHref, type NavItem } from "./nav";
import { NAV_ICONS } from "./nav-icons";

/**
 * Плавающая панель вкладок телефона (эталон docs/design/v3/reference/mobile.html): 10 px от низа плюс безопасная зона
 * (dock-bottom), по бокам 10 px или шире выреза (dock-inline), радиус 22 px, полупрозрачный материал (glass: размытие и насыщенность поверх фона; при
 * prefers-reduced-transparency — сплошной), тень float. Панель прилипает к низу (sticky) и стоит в потоке последней:
 * содержимое прокручивается под ней, а в конце страницы панель встаёт под содержимым — отступ под панель равен её
 * настоящей высоте.
 *
 * Подписи 13 px не обрезаются: вкладка не уже своей подписи, и при крупном системном шрифте вкладки переносятся
 * на вторую строку — панель растёт в высоту. На планшете панель, как и содержимое, — колонка до 560 px по центру.
 */
export function TabBar({ items }: { items: readonly NavItem[] }) {
  const current = activeHref(items, usePathname());

  return (
    <nav aria-label={ru.app.shell.navLabel} className="pointer-events-none sticky dock-bottom z-20 dock-inline">
      <ul
        data-tab-bar
        className="glass pointer-events-auto mx-auto flex max-w-column flex-wrap rounded-bar border border-line p-1 shadow-float"
      >
        {items.map((item) => {
          const Icon = NAV_ICONS[item.icon];
          const active = item.href === current;
          return (
            <li key={item.href} className="flex grow basis-0">
              <Link
                href={item.href}
                aria-current={active ? "page" : undefined}
                className={cn(
                  "flex min-h-control w-full flex-col items-center justify-center gap-1 rounded-field px-1 py-1.5 text-center no-underline",
                  "transition-transform duration-100 active:scale-press",
                  active ? "text-ink" : "text-muted",
                )}
              >
                <Icon aria-hidden className="size-6 shrink-0" strokeWidth={active ? 2.25 : 1.75} />
                <span data-tab-label className={cn("text-small", active ? "font-semibold" : "font-medium")}>
                  {item.label}
                </span>
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
