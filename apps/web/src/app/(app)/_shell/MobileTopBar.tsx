"use client";

import { usePathname } from "next/navigation";
import { isTabRoot, type NavItem } from "./nav";
import { NotificationsLink } from "./NotificationsLink";

/**
 * Верхняя строка телефона над заголовком корневого экрана вкладки: справа колокольчик со счётчиком непрочитанных, слева
 * пусто (название раздела — крупный заголовок самого экрана). На вложенных экранах со строкой «Назад» её нет. Оболочка
 * выводит строку только вошедшему с пройденными первыми шагами: у гостя место не занимается.
 */
export function MobileTopBar({ items, unread }: { items: readonly NavItem[]; unread: number }) {
  if (!isTabRoot(items, usePathname())) return null;
  return (
    <div data-top-strip className="mb-2 flex justify-end">
      <NotificationsLink unread={unread} />
    </div>
  );
}
