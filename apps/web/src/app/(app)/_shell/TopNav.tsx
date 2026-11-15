"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { ru } from "@/i18n/ru";
import { cn, NavLens } from "@/kit";
import { activeHref, type NavItem } from "./nav";

/**
 * Разделы роли в шапке компьютера — строкой (эталон docs/design/v3/reference/desktop-layout.html, вариант A).
 * Активный — «линза» (NavLens: капсула fill-strong за подписью, переезжает пружиной без отскока; при меньшем движении —
 * мгновенно), цвет ink 600 и aria-current="page"; остальные — glass-secondary 500 (вторичный текст на стекле шапки),
 * при наведении — ink. Различимость не только весом: подложка и цвет. Разделы — одной строкой, без переноса (узкое окно —
 * горизонтальная прокрутка страницы).
 */
export function TopNav({ items }: { items: readonly NavItem[] }) {
  const current = activeHref(items, usePathname());

  return (
    // flex-auto: в шапке разделы занимают свободное место, а не помещаясь рядом с названием — уходят строкой ниже целиком.
    <nav aria-label={ru.app.shell.navLabel} className="flex-auto">
      {/* Без переноса: узкое окно прокручивается вбок (оболочка min-w-shell), меню не встаёт в три строки. */}
      <ul className="flex items-center gap-x-1 whitespace-nowrap">
        {items.map((item) => {
          const active = item.href === current;
          return (
            <li key={item.href}>
              <Link
                href={item.href}
                aria-current={active ? "page" : undefined}
                className={cn(
                  "relative isolate inline-flex min-h-control-sm items-center rounded-chip px-4 text-body no-underline hover:text-ink",
                  active ? "font-semibold text-ink" : "font-medium text-glass-secondary",
                )}
              >
                {active && <NavLens group="sections" />}
                {item.label}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
