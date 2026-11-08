"use client";

import { useId, type ReactNode } from "react";
import { groupNav, NAV_GROUP_LABELS, type NavItem } from "./nav";

/**
 * Пункты меню как элементы списка (<li>), сгруппированные по NavItem.group: группа — вложенный список с видимой
 * подписью (она же имя списка для диктора), пункты без группы — как есть. Общая для бокового меню и «Меню» на телефоне.
 */
export function NavGroupItems({ items, renderItem }: { items: readonly NavItem[]; renderItem: (item: NavItem) => ReactNode }) {
  const id = useId();
  return groupNav(items).map((run, i) => {
    if (!run.group) return run.items.map(renderItem);
    const labelId = `${id}-${run.group}`;
    return (
      <li key={`${run.group}-${i}`} className="flex flex-col gap-1 pt-2">
        <span id={labelId} className="px-4 text-sm font-semibold text-muted">
          {NAV_GROUP_LABELS[run.group]}
        </span>
        <ul aria-labelledby={labelId} className="flex flex-col gap-1">
          {run.items.map(renderItem)}
        </ul>
      </li>
    );
  });
}
