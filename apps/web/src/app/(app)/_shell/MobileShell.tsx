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
 * до 560 px по центру с полями 16 px, внизу — плавающая панель вкладок. У роли без вкладок (оператор) панели нет.
 */
export function MobileShell({ nav, unavailable = false, children }: MobileShellProps) {
  return (
    <div className="flex min-h-dvh flex-col">
      <SkipLink />
      <main id={MAIN_ID} tabIndex={-1} className="mx-auto w-full max-w-column flex-1 px-4 py-6 outline-none">
        {unavailable && <UnavailableNotice />}
        {children}
      </main>
      {nav.tabs.length > 0 && <TabBar items={nav.tabs} />}
    </div>
  );
}
