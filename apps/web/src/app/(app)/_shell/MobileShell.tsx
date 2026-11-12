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
 * строку состояния, вырез и полоску «домой». У роли без вкладок (оператор) панели нет.
 */
export function MobileShell({ nav, unavailable = false, children }: MobileShellProps) {
  return (
    <div className="flex min-h-dvh flex-col">
      <SkipLink />
      <main id={MAIN_ID} tabIndex={-1} className="mx-auto w-full max-w-column flex-1 safe-gutter safe-block outline-none">
        {unavailable && <UnavailableNotice />}
        {children}
      </main>
      {nav.tabs.length > 0 && <TabBar items={nav.tabs} />}
    </div>
  );
}
