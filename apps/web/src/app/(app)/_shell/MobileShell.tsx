import type { ReactNode } from "react";
import type { AppNav } from "./nav";
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
 * строку состояния, вырез и полоску «домой». Область содержимого — колонка на всю высоту экрана: все предки дока внутри неё (`dock-column`, любая вложенность) тоже колонки и растянуты, и док главного действия (ActionDock) уходит к низу даже на коротком экране. У роли без вкладок (оператор) панели нет. Под плавающими панелями — подложка
 * цвета фона с переходом в прозрачность (bar-underlay), чтобы содержимое не просвечивало в щелях и под вкладками.
 */
export function MobileShell({ nav, unavailable = false, children }: MobileShellProps) {
  return (
    <div data-has-tabs={nav.tabs.length > 0 ? "" : undefined} className="flex min-h-dvh flex-col">
      <SkipLink />
      <main id={MAIN_ID} tabIndex={-1} className="mx-auto flex w-full max-w-column flex-1 flex-col safe-gutter safe-block outline-none dock-column *:min-w-0">
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
