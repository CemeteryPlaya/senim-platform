"use client";

import Link from "next/link";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { usePathname, useSearchParams } from "next/navigation";
import { Ellipsis, Menu, type LucideIcon } from "lucide-react";
import { ru } from "@/i18n/ru";
import { cn } from "@/ui";
import { NAV_ICONS as ICONS } from "./icons";
import { currentItem, splitNav, type NavItem } from "./nav";

/** Нижняя панель: все вкладки роли (до 5, как в макетах), пока каждой хватает ширины на подпись. */
const BAR_CELLS = 5;
/**
 * Когда панель уже 22em (em — от шрифта панели, 16px; крупный системный шрифт): 3 ячейки с подписями,
 * остальное — в «Ещё». Не одни значки: значок без подписи пожилой человек не узнаёт.
 */
const NARROW_BAR_CELLS = 3;
/** Ширина панели (em её шрифта), с которой помещаются все вкладки. Классы ниже — с тем же порогом. */
const NARROW_ONLY = "@min-[22em]:hidden";
const WIDE_ONLY = "@max-[22em]:hidden";

/** aria-current для пункта: активен самый точный по адресу (см. currentItem в nav.ts). */
function useCurrent(items: readonly NavItem[]) {
  const pathname = usePathname();
  const search = useSearchParams();
  const active = currentItem(items, pathname, new URLSearchParams(search.toString()));
  return { pathname, current: (item: NavItem) => (item === active ? ("page" as const) : undefined) };
}

const menuLink =
  "flex min-h-control items-center gap-3 rounded-control px-4 text-base font-semibold text-ink no-underline hover:bg-sunken aria-[current=page]:bg-accent-soft aria-[current=page]:text-primary";

/**
 * Раскрывающееся «Ещё» на <details>: работает и без скриптов, а со скриптами закрывается
 * по Escape (фокус возвращается на «Ещё»), по нажатию вне меню и когда фокус ушёл из меню.
 */
function MoreMenu({
  summary,
  summaryClassName,
  active,
  panelClassName,
  detailsClassName = "relative",
  children,
}: {
  summary: ReactNode;
  summaryClassName: string;
  active: boolean;
  panelClassName: string;
  /** Положение для списка: по умолчанию он привязан к самому <details>; "static" — к ближайшему предку с relative. */
  detailsClassName?: string;
  children: ReactNode;
}) {
  const ref = useRef<HTMLDetailsElement>(null);
  const [open, setOpen] = useState(false);

  useEffect(() => {
    const details = ref.current;
    if (!open || !details) return;
    const close = (returnFocus: boolean) => {
      details.open = false;
      if (returnFocus) details.querySelector("summary")?.focus();
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      event.preventDefault();
      close(true);
    };
    const onPointer = (event: PointerEvent) => {
      if (event.target instanceof Node && !details.contains(event.target)) close(false);
    };
    const onFocusOut = (event: FocusEvent) => {
      if (event.relatedTarget instanceof Node && !details.contains(event.relatedTarget)) close(false);
    };
    document.addEventListener("keydown", onKey);
    document.addEventListener("pointerdown", onPointer);
    details.addEventListener("focusout", onFocusOut);
    return () => {
      document.removeEventListener("keydown", onKey);
      document.removeEventListener("pointerdown", onPointer);
      details.removeEventListener("focusout", onFocusOut);
    };
  }, [open]);

  return (
    <details ref={ref} onToggle={(event) => setOpen(event.currentTarget.open)} className={cn("group flex w-full", detailsClassName)}>
      <summary aria-current={active ? "page" : undefined} className={cn(summaryClassName, "list-none [&::-webkit-details-marker]:hidden")}>
        {summary}
      </summary>
      <ul className={cn("z-40 flex flex-col rounded-card border border-line bg-surface p-2 text-base shadow-overlay", panelClassName)}>{children}</ul>
    </details>
  );
}

function MoreItems({
  items,
  current,
  narrowOnly,
}: {
  items: readonly NavItem[];
  current: (item: NavItem) => "page" | undefined;
  /** Пункты, которые на широкой панели стоят ячейкой, а в «Ещё» нужны только на узкой. */
  narrowOnly?: ReadonlySet<string>;
}) {
  return items.map((item) => {
    const Icon = ICONS[item.icon];
    return (
      <li key={item.href} className={narrowOnly?.has(item.href) ? NARROW_ONLY : undefined}>
        <Link href={item.href} aria-current={current(item)} className={menuLink}>
          <Icon aria-hidden className="size-6 shrink-0" />
          {item.label}
        </Link>
      </li>
    );
  });
}

/**
 * Кнопка «Меню» в шапке на телефоне и планшете: для роли без нижней панели (оператор) раскрывает её разделы.
 * На десктопе скрыта: там те же разделы стоят в боковом меню (SideNav).
 */
export function MobileMenu({ items }: { items: readonly NavItem[] }) {
  const { pathname, current } = useCurrent(items);
  return (
    <nav aria-label={ru.common.shell.menu} className="lg:hidden">
      {/* key по адресу: после перехода меню закрывается само (layout не перемонтируется). */}
      <MoreMenu
        key={pathname}
        active={false}
        summaryClassName="inline-flex min-h-control-sm cursor-pointer items-center gap-2 rounded-chip border-2 border-line px-4 text-base font-semibold text-ink hover:bg-sunken"
        // Список привязан к шапке (relative), а не к кнопке: при крупном шрифте он на всю ширину окна и не уезжает за левый край.
        detailsClassName="static"
        panelClassName="absolute inset-x-2 top-full mt-2 max-h-[calc(100dvh-5rem)] overflow-y-auto sm:inset-x-auto sm:right-4 sm:w-max sm:min-w-64 sm:max-w-[calc(100vw-2rem)]"
        summary={
          <>
            <Menu aria-hidden className="size-6 shrink-0" />
            {ru.common.shell.menu}
          </>
        }
      >
        <MoreItems items={items} current={current} />
      </MoreMenu>
    </nav>
  );
}

/**
 * Высота нижней панели → CSS-переменная --tabbar-h на <html>: от неё отступ внизу страницы,
 * закреплённые кнопки и scroll-padding (фокус не прячется под панель). Без скриптов действует
 * значение по умолчанию из globals.css; на широком экране панель скрыта и высота 0.
 */
function useTabBarHeight() {
  const ref = useRef<HTMLElement>(null);
  useEffect(() => {
    const bar = ref.current;
    if (!bar) return;
    const root = document.documentElement;
    const update = () => root.style.setProperty("--tabbar-h", `${bar.offsetHeight}px`);
    const observer = new ResizeObserver(update);
    observer.observe(bar);
    update();
    return () => {
      observer.disconnect();
      root.style.removeProperty("--tabbar-h");
    };
  }, []);
  return ref;
}

/** Ячейка панели: значок в «таблетке» (у активной — мятная), под ним подпись. */
function TabCell({ icon: Icon, label, primary = false }: { icon: LucideIcon; label: string; primary?: boolean }) {
  return (
    <>
      {/* Действие роли («Заявка») — заливная зелёная «таблетка» всегда, а не только у активной вкладки. */}
      <span
        aria-hidden
        className={cn(
          "inline-flex h-8 w-14 shrink-0 items-center justify-center rounded-full transition-colors duration-150 @max-[22em]:w-10",
          primary ? "bg-primary text-on-primary group-hover/cell:bg-primary-hover" : "group-aria-[current=page]/cell:bg-accent-soft",
        )}
      >
        <Icon className="size-6" />
      </span>
      {/* На узкой панели (это всегда крупный шрифт: 22em — от него) подпись на четверть мельче шрифта панели —
          всё равно крупнее обычной, зато слова раздела не рвутся посередине. */}
      <span className="max-w-full tracking-tight @max-[22em]:text-[0.75em]">{label}</span>
    </>
  );
}

/** Разбиение для узкой панели: действие роли остаётся ячейкой, а не уходит в «Ещё» (уходят соседние вкладки). */
function narrowSplit(items: readonly NavItem[]) {
  const base = splitNav(items, NARROW_BAR_CELLS);
  const primary = items.find((item) => item.primary);
  if (!primary || base.shown.includes(primary)) return base;
  const shown = [...base.shown.slice(0, -1), primary];
  return { shown, more: items.filter((item) => !shown.includes(item)) };
}

/**
 * Нижняя панель вкладок на телефоне (макеты 7, 10, 12, 15): значок и подпись, активная — зелёная с мятной
 * «таблеткой» под значком и aria-current. Все вкладки роли (до 5) — пока панель не уже 22em; на узкой панели
 * (крупный системный шрифт) — 2 вкладки и «Ещё», подписи остаются видимыми. Переключение — контейнерным
 * запросом, без скриптов: пункт, который на узкой панели уходит в «Ещё», отрисован и ячейкой (только широкая),
 * и строкой меню (только узкая).
 */
export function MobileTabBar({ items }: { items: readonly NavItem[] }) {
  const { pathname, current } = useCurrent(items);
  const ref = useTabBarHeight();
  const wide = splitNav(items, BAR_CELLS);
  const narrow = narrowSplit(items);
  const narrowShown = new Set(narrow.shown.map((item) => item.href));
  const wideMore = new Set(wide.more.map((item) => item.href));
  const narrowOnlyInMenu = new Set(narrow.more.filter((item) => !wideMore.has(item.href)).map((item) => item.href));
  if (items.length === 0) return null;
  const wideOverflow = wide.more.length > 0;
  const narrowOverflow = narrow.more.length > 0;
  const cell = cn(
    "group/cell flex min-h-control w-full flex-col items-center justify-center gap-1 rounded-control px-0 pt-1.5 pb-1 text-center leading-tight font-medium text-muted no-underline",
    "hover:text-ink aria-[current=page]:text-primary",
  );

  return (
    <nav
      ref={ref}
      aria-label={ru.common.shell.navLabel}
      className="@container fixed inset-x-0 bottom-0 z-30 border-t border-line bg-surface pb-[env(safe-area-inset-bottom)] text-sm [overflow-wrap:normal] [hyphens:manual] shadow-bar lg:hidden"
    >
      {/* Скрытая ячейка (display: none) места не занимает. На узкой панели «Ещё» берёт ширину по подписи,
          остальное — разделам, чтобы их подписи переносились только по словам. */}
      {/* Ячейка шириной по подписи плюс равная доля остатка: длинная «Вдохновение» не вылезает за свою ячейку
          и не сливается с соседней; не хватает места — подписи переносятся по словам. Между ячейками зазор. */}
      <ul className="mx-auto flex max-w-page gap-1 px-1 py-1">
        {wide.shown.map((item) => (
          <li key={item.href} className={cn("flex min-w-0 flex-auto", !narrowShown.has(item.href) && WIDE_ONLY)}>
            <Link href={item.href} aria-current={current(item)} data-primary-tab={item.primary ? "true" : undefined} className={cell}>
              <TabCell icon={ICONS[item.icon]} label={item.label} primary={item.primary} />
            </Link>
          </li>
        ))}
        {(wideOverflow || narrowOverflow) && (
          <li className={cn("flex min-w-0 flex-1 basis-0 @max-[22em]:flex-none @max-[22em]:basis-auto", !wideOverflow && NARROW_ONLY)}>
            <MoreMenu
              key={pathname}
              active={narrow.more.some((item) => current(item))}
              summaryClassName={cell}
              panelClassName="fixed inset-x-2 bottom-[calc(var(--tabbar-h)+0.5rem)] max-h-[calc(100dvh-var(--tabbar-h)-1rem)] overflow-y-auto"
              summary={<TabCell icon={Ellipsis} label={ru.common.shell.more} />}
            >
              <MoreItems items={narrow.more} current={current} narrowOnly={narrowOnlyInMenu} />
            </MoreMenu>
          </li>
        )}
      </ul>
    </nav>
  );
}
