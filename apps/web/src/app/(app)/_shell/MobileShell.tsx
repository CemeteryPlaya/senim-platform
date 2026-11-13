import Link from "next/link";
import type { ReactNode } from "react";
import { ru } from "@/i18n/ru";
import { LogoutButton } from "./LogoutButton";
import type { AppNav } from "./nav";
import { to } from "./paths";
import { MAIN_ID, SkipLink, UnavailableNotice } from "./ShellParts";
import { TabBar } from "./TabBar";

export type MobileShellProps = {
  nav: AppNav;
  /** identity не ответил: страница рисуется гостем, сверху — плашка «сервис временно недоступен». */
  unavailable?: boolean;
  children: ReactNode;
};

/**
 * Оболочка телефона и планшета: без шапки (крупный заголовок экрана — у самой страницы), содержимое — колонка
 * до 560 px по центру с полями 16 px по бокам и 24 px сверху и снизу, внизу — плавающая панель вкладок. Поля не
 * меньше безопасных зон (safe-gutter, safe-block; viewport-fit=cover ставит layout): содержимое не уходит под
 * строку состояния, вырез и полоску «домой». Если в области содержимого есть док главного действия (ActionDock), она — колонка на всю высоту экрана, а предки дока внутри неё (`dock-column`, раскладку других предков не перебивает) растянуты: док уходит к низу даже на коротком экране. Без дока область содержимого обычная. У роли без вкладок (оператор) панели нет. Под плавающими панелями — подложка
 * цвета фона с переходом в прозрачность (bar-underlay), чтобы содержимое не просвечивало в щелях и под вкладками.
 * Сосредоточенная оболочка (`nav.focus`, первые шаги после входа): вместо панели вкладок — узкая шапка с названием
 * продукта и «Выйти»; вкладок нет, док стоит у самого нижнего края (как у оператора).
 */
export function MobileShell({ nav, unavailable = false, children }: MobileShellProps) {
  return (
    <div data-has-tabs={nav.tabs.length > 0 ? "" : undefined} className="flex min-h-dvh flex-col">
      <SkipLink />
      {nav.focus && (
        // Сосредоточенная оболочка (первые шаги): узкая шапка — название слева, «Выйти» справа; панели вкладок нет.
        <header data-focus-bar className="mx-auto flex w-full max-w-column items-center justify-between safe-gutter pt-2">
          <Link href={to("/")} className="inline-flex min-h-control items-center text-card text-ink no-underline">
            {ru.common.brand}
          </Link>
          <LogoutButton />
        </header>
      )}
      <main id={MAIN_ID} tabIndex={-1} className="mx-auto w-full max-w-column flex-1 safe-gutter safe-block outline-none dock-column">
        {unavailable && <UnavailableNotice />}
        {children}
      </main>
      {nav.tabs.length > 0 && (
        <>
          {/* Подложка: ниже дока (z-10) и панели (z-20), выше содержимого. */}
          <div aria-hidden data-bar-underlay className="bar-underlay z-0" />
          <TabBar items={nav.tabs} />
        </>
      )}
    </div>
  );
}
