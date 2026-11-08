"use client";

import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";
import { ShieldCheck } from "lucide-react";
import { ru } from "@/i18n/ru";
import { ButtonLink } from "@/ui";
import { NAV_ICONS as ICONS } from "./icons";
import { currentItem, type NavItem } from "./nav";

const itemClass =
  "flex min-h-control items-center gap-3 rounded-control px-4 text-base font-semibold text-ink no-underline hover:bg-sunken aria-[current=page]:bg-accent-soft aria-[current=page]:text-primary";

/**
 * Боковое меню на десктопе (≥ 1024 px): фиксированная колонка 240 px — логотип, вкладки роли, остальные разделы
 * и кнопка главного действия роли внизу списка. До 1024 px скрыто: там нижняя панель (MobileTabBar).
 * items — вкладки, more — остальные разделы, primary — действие роли (у заказчика «Заявка»).
 */
export function SideNav({ items, more, primary }: { items: readonly NavItem[]; more: readonly NavItem[]; primary?: NavItem }) {
  const pathname = usePathname();
  const search = useSearchParams();
  const all = primary ? [...items, ...more, primary] : [...items, ...more];
  const active = currentItem(all, pathname, new URLSearchParams(search.toString()));

  const PrimaryIcon = ICONS[primary?.icon ?? "plus"];

  const list = (entries: readonly NavItem[]) =>
    entries.map((item) => {
      const Icon = ICONS[item.icon];
      return (
        <li key={item.href}>
          <Link href={item.href} aria-current={item === active ? "page" : undefined} className={itemClass}>
            <Icon aria-hidden className="size-6 shrink-0" />
            {item.label}
          </Link>
        </li>
      );
    });

  return (
    <nav
      aria-label={ru.common.shell.navLabel}
      className="fixed inset-y-0 left-0 z-30 hidden w-60 flex-col gap-4 overflow-y-auto border-r border-line bg-surface px-3 py-4 lg:flex"
    >
      <Link href="/" aria-label={ru.common.shell.home} className="flex min-h-control items-center gap-2 rounded-control px-3 no-underline">
        <ShieldCheck aria-hidden className="size-7 shrink-0 text-primary" />
        <span className="text-xl leading-tight font-extrabold text-ink">{ru.common.brand}</span>
      </Link>
      <ul className="flex flex-col gap-1">{list(items)}</ul>
      {more.length > 0 && <ul className={`flex flex-col gap-1 ${items.length > 0 ? "border-t border-line pt-4" : ""}`}>{list(more)}</ul>}
      {primary && (
        <div className="mt-auto pt-2">
          {/* Мятная, не заливная: заливная главная кнопка на экране одна — своя у каждой страницы (data-primary-action). */}
          <ButtonLink href={primary.href} variant="soft" fullWidth icon={<PrimaryIcon />}>
            {primary.label}
          </ButtonLink>
        </div>
      )}
    </nav>
  );
}
