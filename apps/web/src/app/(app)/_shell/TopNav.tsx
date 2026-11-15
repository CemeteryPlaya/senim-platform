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
 * при наведении — ink. Различимость не только весом: подложка и цвет. Узкое окно — горизонтальная прокрутка страницы
 * (разделы в одну строку); при крупном шрифте строка переносится между разделами, шапка растёт.
 */
export function TopNav({ items }: { items: readonly NavItem[] }) {
  const current = activeHref(items, usePathname());

  return (
    // flex-auto: в шапке разделы занимают свободное место, а не помещаясь рядом с названием — уходят строкой ниже целиком.
    <nav aria-label={ru.app.shell.navLabel} className="min-w-0 flex-auto">
      {/* Узкое окно прокручивается вбок (оболочка min-w-shell 1024px): при обычном шрифте разделы в одну строку. Перенос
          строки разделов — только при крупном шрифте и только между разделами: подпись раздела не рвётся. */}
      <ul className="flex flex-wrap items-center gap-x-1">
        {items.map((item) => {
          const active = item.href === current;
          return (
            <li key={item.href} className="whitespace-nowrap">
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
