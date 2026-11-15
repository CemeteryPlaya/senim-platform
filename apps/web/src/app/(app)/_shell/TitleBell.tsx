"use client";

import { usePathname } from "next/navigation";
import type { ReactNode } from "react";
import { TitleActionProvider } from "@/kit";
import { isTabRoot, type NavItem } from "./nav";
import { NotificationsLink } from "./NotificationsLink";

/**
 * Колокольчик телефона со счётчиком непрочитанных — в строке заголовка корневого экрана вкладки (справа от `<h1>`
 * `PageTitle`), а не отдельной строкой над ним (разбор 3.7). Строка заголовка в покое не плавает над содержимым — кнопка
 * без стекла. На вложенных экранах (со строкой «Назад») колокольчика нет. Оболочка подключает его только вошедшему с
 * пройденными первыми шагами: у гостя места нет.
 */
export function TitleBell({ items, unread, children }: { items: readonly NavItem[]; unread: number; children: ReactNode }) {
  const action = isTabRoot(items, usePathname()) ? <NotificationsLink unread={unread} /> : null;
  return <TitleActionProvider action={action}>{children}</TitleActionProvider>;
}
