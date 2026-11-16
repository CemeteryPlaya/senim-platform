import type { ReactNode } from "react";
import { ru } from "@/i18n/ru";
import { NavHistory } from "@/kit";
import { LogoutButton } from "./LogoutButton";
import type { AppNav } from "./nav";
import { NetworkStatus } from "./NetworkStatus";
import { MAIN_ID, SkipLink, UnavailableNotice } from "./ShellParts";
import { TabBar } from "./TabBar";
import { TitleBell } from "./TitleBell";

export type MobileShellProps = {
  nav: AppNav;
  /** identity не ответил: страница рисуется гостем, сверху — плашка «сервис временно недоступен». */
  unavailable?: boolean;
  /** Непрочитанных уведомлений у вошедшего с пройденными первыми шагами; `null` — гость, колокольчика нет. */
  unread?: number | null;
  children: ReactNode;
};

/**
 * Оболочка телефона и планшета: без шапки (крупный заголовок экрана — у самой страницы), содержимое — колонка
 * до 560 px по центру с полями 16 px по бокам и 24 px сверху и снизу, внизу — плавающая панель вкладок. Поля не
 * меньше безопасных зон (safe-gutter, safe-block; viewport-fit=cover ставит layout): содержимое не уходит под
 * строку состояния, вырез и полоску «домой». Если в области содержимого есть док главного действия (ActionDock), она — колонка на всю высоту экрана, а предки дока внутри неё (`dock-column`, раскладку других предков не перебивает) растянуты: док уходит к низу даже на коротком экране. Без дока область содержимого обычная. У роли без вкладок (оператор) панели нет. Под плавающими панелями — подложка
 * bar-underlay: «растворение» содержимого у нижнего края (scroll edge), а не плита: стекло панели и док без плиты видны над содержимым; рисуется
 * всегда, а видна (CSS) только при панели вкладок или доке на экране — у оператора и на первых шагах тоже есть док.
 * На корневых экранах вкладок вошедшего колокольчик (счётчик `unread`) стоит в строке заголовка экрана (TitleBell →
 * PageTitle), без отдельной верхней строки.
 * Сосредоточенная оболочка (`nav.focus`, первые шаги после входа): вместо панели вкладок — узкая шапка с названием
 * продукта и «Выйти»; вкладок нет, док стоит у самого нижнего края (как у оператора).
 * Сверху области содержимого — NetworkStatus: плашка «Нет связи», обновление экрана при возврате связи и в приложение.
 */
export function MobileShell({ nav, unavailable = false, unread = null, children }: MobileShellProps) {
  return (
    <div data-mobile-shell data-has-tabs={nav.tabs.length > 0 ? "" : undefined} className="flex min-h-dvh flex-col">
      <SkipLink />
      <NavHistory />
      {nav.focus && (
        // Сосредоточенная оболочка (первые шаги): узкая шапка — название (не ссылка: со шага уходить некуда) слева, «Выйти»
        // справа; отступы шапки учитывают вырез (safe-bar), поэтому main под ней верхний вырез второй раз не добавляет.
        <header data-focus-bar className="mx-auto flex w-full max-w-column items-center justify-between safe-bar">
          <span className="inline-flex min-h-control items-center text-headline text-ink">{ru.common.brand}</span>
          <LogoutButton />
        </header>
      )}
      <main id={MAIN_ID} tabIndex={-1} className={`mx-auto w-full max-w-column flex-1 safe-gutter outline-none dock-column ${nav.focus ? "safe-bottom pt-6" : "safe-block"}`}>
        <NetworkStatus />
        {unavailable && <UnavailableNotice />}
        {unread !== null && !nav.focus && !nav.guest ? (
          <TitleBell items={nav.tabs} unread={unread}>
            {children}
          </TitleBell>
        ) : (
          children
        )}
      </main>
      {/* Подложка: ниже дока (z-10) и панели (z-20), выше содержимого; без вкладок и дока скрыта (bar-underlay). */}
      <div aria-hidden data-bar-underlay className="bar-underlay z-0" />
      {nav.tabs.length > 0 && <TabBar items={nav.tabs} />}
    </div>
  );
}
