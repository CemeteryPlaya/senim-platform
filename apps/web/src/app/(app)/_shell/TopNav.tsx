"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { ru } from "@/i18n/ru";
import { cn } from "@/kit/cn";
import { activeHref, type NavItem } from "./nav";

/**
 * Разделы роли в шапке компьютера — строкой (эталон docs/design/v3/reference/desktop-layout.html, вариант A).
 * Активный — цвет ink и aria-current="page", остальные — muted. При крупном шрифте строка переносится, шапка растёт.
 */
export function TopNav({ items }: { items: readonly NavItem[] }) {
  const current = activeHref(items, usePathname());

  return (
    // flex-auto: в шапке разделы занимают свободное место, а не помещаясь рядом с названием — уходят строкой ниже целиком.
    <nav aria-label={ru.app.shell.navLabel} className="min-w-0 flex-auto">
      <ul className="flex flex-wrap items-center gap-x-1">
        {items.map((item) => {
          const active = item.href === current;
          return (
            <li key={item.href}>
              <Link
                href={item.href}
                aria-current={active ? "page" : undefined}
                className={cn(
                  "inline-flex min-h-control items-center rounded-field px-3 text-body no-underline hover:text-ink",
                  active ? "font-semibold text-ink" : "font-medium text-muted",
                )}
              >
                {item.label}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
