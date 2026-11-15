"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { ru } from "@/i18n/ru";
import { cn, NavLens } from "@/kit";
import { activeHref, type NavItem } from "./nav";
import { NAV_ICONS } from "./nav-icons";

/**
 * Переносится ли панель: вкладки встали в несколько рядов или подпись вкладки — в две строки (крупный шрифт).
 * Капсула такой высоты скругляла бы края так сильно, что крайние подписи вышли бы за материал.
 */
function isWrapped(list: HTMLElement): boolean {
  const items = [...list.children] as HTMLElement[];
  if (items.length > 1 && items.some((item) => item.offsetTop !== items[0].offsetTop)) return true;
  return [...list.querySelectorAll<HTMLElement>("[data-tab-label]")].some((label) => {
    const line = parseFloat(getComputedStyle(label).lineHeight);
    return Number.isFinite(line) && label.offsetHeight > line * 1.5;
  });
}

/**
 * Плавающая панель вкладок телефона (эталон docs/design/v3/reference/mobile.html): 10 px от низа плюс безопасная зона
 * (dock-bottom), по бокам 10 px или шире выреза (dock-inline), капсула (rounded-bar), стекло glass-regular (размытие и
 * насыщенность поверх фона, кромка-блик, контур 0,5 px и тень float; при prefers-reduced-transparency — сплошной).
 * Панель прилипает к низу (sticky) и стоит в потоке последней: содержимое прокручивается под ней, а в конце страницы
 * панель встаёт под содержимым — отступ под панель равен её настоящей высоте.
 *
 * Активная вкладка — «линза» (NavLens): подложка fill-strong за иконкой и подписью, переезжает к новой вкладке пружиной
 * без отскока (при prefers-reduced-motion — мгновенно); подпись ink 600, у остальных — glass-secondary 500. Иконки
 * одной толщины: выбранную отличает подложка, а не штрих.
 *
 * Подписи 13 px не обрезаются: вкладка не уже своей подписи, и при крупном системном шрифте вкладки переносятся
 * на вторую строку — панель растёт в высоту. Тогда капсула сменяется скруглением карточки (rounded-card), а линза —
 * скруглением поля: подписи не выходят за материал. Высоту панели TabBar сообщает оболочке переменной
 * --tab-bar-height (ResizeObserver): по ней док главного действия (ActionDock) встаёт над панелью, как бы она ни
 * выросла. На планшете панель, как и содержимое, — колонка до 560 px по центру.
 */
export function TabBar({ items }: { items: readonly NavItem[] }) {
  const current = activeHref(items, usePathname());
  const bar = useRef<HTMLElement>(null);
  const list = useRef<HTMLUListElement>(null);
  const [wrapped, setWrapped] = useState(false);

  useEffect(() => {
    const nav = bar.current;
    const shell = nav?.parentElement;
    if (!nav || !shell || typeof ResizeObserver === "undefined") return;
    const measure = () => {
      shell.style.setProperty("--tab-bar-height", `${nav.getBoundingClientRect().height}px`);
      if (list.current) setWrapped(isWrapped(list.current));
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(nav);
    return () => {
      observer.disconnect();
      shell.style.removeProperty("--tab-bar-height");
    };
  }, []);

  return (
    <nav ref={bar} aria-label={ru.app.shell.navLabel} className="pointer-events-none sticky dock-bottom z-20 dock-inline">
      <ul
        ref={list}
        data-tab-bar
        data-wrapped={wrapped ? "" : undefined}
        className={cn("glass-regular pointer-events-auto mx-auto flex max-w-column flex-wrap p-1", wrapped ? "rounded-card" : "rounded-bar")}
      >
        {items.map((item) => {
          const Icon = NAV_ICONS[item.icon];
          const active = item.href === current;
          return (
            <li key={item.href} className="flex grow basis-0">
              <Link
                href={item.href}
                aria-current={active ? "page" : undefined}
                // py-1.5 (6 px) — мимо шкалы намеренно: иконка 24 px, зазор 4 px и подпись 13 px укладываются в
                // плашку высотой с эталонную; с py-2 панель становится выше, с py-1 подпись прижата к краю.
                className={cn(
                  "relative isolate flex min-h-control w-full flex-col items-center justify-center gap-1 px-2 py-1.5 text-center no-underline",
                  "pressable",
                  wrapped ? "rounded-field" : "rounded-chip",
                  active ? "text-ink" : "text-glass-secondary",
                )}
              >
                {active && <NavLens group="tabs" shape={wrapped ? "field" : "capsule"} />}
                <Icon aria-hidden className="size-6 shrink-0" strokeWidth={1.75} />
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
