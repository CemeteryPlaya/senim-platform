"use client";

import Link from "next/link";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { usePathname } from "next/navigation";
import {
  Bell,
  ChevronDown,
  ClipboardList,
  Ellipsis,
  FlaskConical,
  Handshake,
  Images,
  Inbox,
  Landmark,
  LayoutDashboard,
  LayoutGrid,
  Ruler,
  UserRound,
  type LucideIcon,
} from "lucide-react";
import { ru } from "@/i18n/ru";
import { cn } from "@/ui";
import { splitNav, type NavIcon, type NavItem } from "./nav";

const ICONS: Record<NavIcon, LucideIcon> = {
  catalog: LayoutGrid,
  requests: ClipboardList,
  deals: Handshake,
  notifications: Bell,
  incoming: Inbox,
  measurements: Ruler,
  profile: UserRound,
  portfolio: Images,
  operator: LayoutDashboard,
  bank: Landmark,
  demo: FlaskConical,
};

/** В нижней панели телефона — не больше 4 ячеек, чтобы подписи 16px помещались. */
const BAR_CELLS = 4;
/** В шапке на широком экране — не больше 4 пунктов: остальное в «Ещё», иначе меню наезжает на название. */
const HEADER_CELLS = 4;

function useCurrent() {
  const pathname = usePathname();
  return {
    pathname,
    current: (href: string) => (pathname === href || pathname.startsWith(`${href}/`) ? ("page" as const) : undefined),
  };
}

const menuLink =
  "flex min-h-control items-center gap-3 rounded-control px-4 text-base font-semibold text-ink no-underline hover:bg-sunken aria-[current=page]:bg-accent-soft aria-[current=page]:text-primary";

/**
 * Раскрывающееся «Ещё» на <details>: работает и без скриптов, а со скриптами закрывается
 * по Escape (фокус возвращается на «Ещё»), по нажатию вне меню и когда фокус ушёл из меню.
 */
function MoreMenu({ summary, summaryClassName, active, panelClassName, children }: { summary: ReactNode; summaryClassName: string; active: boolean; panelClassName: string; children: ReactNode }) {
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
    <details ref={ref} onToggle={(event) => setOpen(event.currentTarget.open)} className="group relative flex w-full">
      <summary aria-current={active ? "page" : undefined} className={cn(summaryClassName, "list-none group-open:bg-sunken [&::-webkit-details-marker]:hidden")}>
        {summary}
      </summary>
      <ul className={cn("z-40 flex flex-col rounded-card border border-line bg-surface p-2 shadow-overlay", panelClassName)}>{children}</ul>
    </details>
  );
}

function MoreItems({ items, current }: { items: readonly NavItem[]; current: (href: string) => "page" | undefined }) {
  return items.map((item) => {
    const Icon = ICONS[item.icon];
    return (
      <li key={item.href}>
        <Link href={item.href} aria-current={current(item.href)} className={menuLink}>
          <Icon aria-hidden className="size-6 shrink-0" />
          {item.label}
        </Link>
      </li>
    );
  });
}

/** Строка ссылок в шапке на широком экране (lg+); лишние пункты — в «Ещё». */
export function DesktopNav({ items }: { items: readonly NavItem[] }) {
  const { pathname, current } = useCurrent();
  const { shown, more } = splitNav(items, HEADER_CELLS);
  const pill = cn(
    "flex min-h-control-sm items-center gap-1 rounded-full px-4 text-base font-semibold text-ink no-underline transition-colors duration-150",
    "hover:bg-sunken aria-[current=page]:bg-accent-soft aria-[current=page]:text-primary",
  );
  return (
    <nav aria-label={ru.common.shell.navLabel} className="hidden min-w-0 lg:block">
      <ul className="flex flex-wrap items-center justify-end gap-1">
        {shown.map((item) => (
          <li key={item.href}>
            <Link href={item.href} aria-current={current(item.href)} className={pill}>
              {item.label}
            </Link>
          </li>
        ))}
        {more.length > 0 && (
          <li>
            {/* key по адресу: после перехода меню закрывается само (layout не перемонтируется). */}
            <MoreMenu
              key={pathname}
              active={more.some((item) => current(item.href))}
              summaryClassName={pill}
              panelClassName="absolute top-full right-0 mt-2 w-max min-w-64"
              summary={
                <>
                  {ru.common.shell.more}
                  <ChevronDown aria-hidden className="size-5 shrink-0 group-open:rotate-180" />
                </>
              }
            >
              <MoreItems items={more} current={current} />
            </MoreMenu>
          </li>
        )}
      </ul>
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

/**
 * Нижняя панель вкладок на телефоне (как в макете): иконка + подпись; лишние пункты — в «Ещё».
 * Когда панель уже 20em (em — от шрифта панели, 18px) (крупный системный шрифт), подписи остаются только для диктора.
 */
export function MobileTabBar({ items, extra }: { items: readonly NavItem[]; extra?: ReactNode }) {
  const { pathname, current } = useCurrent();
  const ref = useTabBarHeight();
  // «Ещё» есть всегда, когда есть что положить туда помимо ссылок (например, «Выйти»).
  const { shown, more } = splitNav(items, BAR_CELLS, extra !== undefined);
  const overflow = more.length > 0 || extra !== undefined;
  const cell = cn(
    "flex min-h-control w-full flex-col items-center justify-center gap-0.5 rounded-control px-1 py-1.5 text-center text-sm leading-tight font-semibold text-muted no-underline",
    "hover:bg-sunken aria-[current=page]:bg-accent-soft aria-[current=page]:text-primary",
  );
  const label = "max-w-full break-normal hyphens-none @max-[20em]:sr-only";

  return (
    <nav
      ref={ref}
      aria-label={ru.common.shell.navLabel}
      className="@container fixed inset-x-0 bottom-0 z-30 border-t border-line bg-surface pb-[env(safe-area-inset-bottom)] shadow-bar lg:hidden"
    >
      <ul className="mx-auto grid max-w-page gap-1 px-2 py-1.5" style={{ gridTemplateColumns: `repeat(${shown.length + (overflow ? 1 : 0)}, minmax(0, 1fr))` }}>
        {shown.map((item) => {
          const Icon = ICONS[item.icon];
          return (
            <li key={item.href} className="flex min-w-0">
              <Link href={item.href} aria-current={current(item.href)} className={cell}>
                <Icon aria-hidden className="size-6 shrink-0" />
                <span className={label}>{item.label}</span>
              </Link>
            </li>
          );
        })}
        {overflow && (
          <li className="flex min-w-0">
            <MoreMenu
              key={pathname}
              active={more.some((item) => current(item.href))}
              summaryClassName={cell}
              panelClassName="fixed inset-x-2 bottom-[calc(var(--tabbar-h)+0.5rem)] max-h-[calc(100dvh-var(--tabbar-h)-1rem)] overflow-y-auto"
              summary={
                <>
                  <Ellipsis aria-hidden className="size-6 shrink-0" />
                  <span className={label}>{ru.common.shell.more}</span>
                </>
              }
            >
              <MoreItems items={more} current={current} />
              {extra && <li className="border-t border-line pt-2">{extra}</li>}
            </MoreMenu>
          </li>
        )}
      </ul>
    </nav>
  );
}
