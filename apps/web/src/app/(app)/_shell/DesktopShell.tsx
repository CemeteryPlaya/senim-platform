import Link from "next/link";
import type { ReactNode } from "react";
import { ru } from "@/i18n/ru";
import { cn, NavHistory } from "@/kit";
import type { Theme } from "@/kit/theme";
import { AvatarMenu } from "./AvatarMenu";
import { LogoutButton } from "./LogoutButton";
import type { AppNav } from "./nav";
import { NetworkStatus } from "./NetworkStatus";
import { to } from "./paths";
import { NotificationsLink } from "./NotificationsLink";
import { OperatorNavList } from "./OperatorNav";
import { ShellAction } from "./ShellAction";
import { MAIN_ID, SkipLink, UnavailableNotice } from "./ShellParts";
import { TopNav } from "./TopNav";

/** Что шапке нужно от вошедшего пользователя (подмножество CurrentUser); null — гость. */
export type DesktopUser = { fullName: string | null };

export type DesktopShellProps = {
  nav: AppNav;
  user: DesktopUser | null;
  /** Тема из куки: отмечена в меню профиля. */
  theme?: Theme;
  /** Непрочитанных уведомлений (у вошедшего с пройденными шагами). */
  unread?: number;
  /** identity не ответил: страница рисуется гостем, сверху — плашка «сервис временно недоступен». */
  unavailable?: boolean;
  children: ReactNode;
};

/**
 * Оболочка компьютера — меню сверху (эталон docs/design/v3/reference/desktop-layout.html, вариант A). Шапка 52 px
 * прилипает к верху; материал — стекло glass-bar: содержимое прокручивается под ним и растворяется у нижнего края (без линии).
 * Слева название продукта (ссылка на главную), затем разделы строкой; справа действие роли (тихой кнопкой со значком — главная
 * кнопка принадлежит экрану), колокольчик и аватар с меню. Гостю справа — «Войти» такой же тихой кнопкой (на экранах входа её нет: человек уже там).
 * Сосредоточенная оболочка (`nav.focus`, первые шаги после входа): слева только название, справа только «Выйти»
 * (вторичная кнопка), без разделов, действия, колокольчика и аватара.
 * Содержимое по центру, до 1100 px. Брейкпоинтов нет: в узком окне оболочка не становится телефонной. Узкое окно (меньше
 * 1024px): шапка и содержимое не уже 1024px (`min-w-shell`, в px — не растёт с системным шрифтом), разделы меню не рвутся
 * посередине — страница прокручивается вбок, а не сжимается. При крупном шрифте, если строка шапки не помещается, правая группа переходит
 * на вторую строку у правого края — шапка растёт, ничего не обрезается и не наезжает.
 * Сверху области содержимого — NetworkStatus: плашка «Нет связи», обновление экрана при возврате связи и во вкладку.
 *
 * Оператор (`nav.operator`, спека, раздел 5): разделов в шапке нет — меню слева по группам (колонка 240 px прилипает под
 * шапкой и прокручивается сама, если длиннее окна), содержимое — таблицы и очереди — на остальную ширину рабочего места до
 * 1440 px (`max-w-operator`); название продукта ведёт на главную оператора.
 */
export function DesktopShell({ nav, user, theme = "system", unread = 0, unavailable = false, children }: DesktopShellProps) {
  const operator = nav.focus ? undefined : nav.operator;
  const content = (
    <>
      <NetworkStatus />
      {unavailable && <UnavailableNotice />}
      {children}
    </>
  );
  return (
    // min-w-shell (1024px): в узком окне шапка и содержимое не сжимаются по слову в строке — страница прокручивается вбок
    // (спека, раздел 5; разбор 3.9).
    <div data-desktop-shell className="flex min-h-dvh min-w-shell flex-col">
      <SkipLink />
      <NavHistory />
      <header data-top-bar className="glass-bar sticky top-0 z-20">
        <div className={cn("mx-auto flex min-h-header w-full flex-wrap items-center gap-x-6 px-6", operator ? "max-w-operator" : "max-w-content")}>
          {nav.focus ? (
            // Первые шаги: название — текст, а не ссылка (со шага уходить некуда).
            <span className="inline-flex min-h-control shrink-0 items-center text-headline text-ink">{ru.common.brand}</span>
          ) : (
            // Вошедший по названию продукта попадает на лендинг (тот, что видел до входа), «Главная» в меню — его дом.
            <Link href={operator?.home.href ?? (user ? to("/landing") : to("/"))} className="inline-flex min-h-control shrink-0 items-center text-headline text-ink no-underline">
              {ru.common.brand}
            </Link>
          )}
          {nav.sections.length > 0 && <TopNav items={nav.sections} />}
          <div className="ml-auto flex shrink-0 items-center gap-2">
            <ShellAction action={nav.action} />
            {nav.focus && <LogoutButton variant="secondary" />}
            {user && !nav.focus && <NotificationsLink unread={unread} />}
            {user && !nav.focus && <AvatarMenu fullName={user.fullName} theme={theme} />}
          </div>
        </div>
      </header>
      {operator ? (
        // Колонки растянуты на высоту ряда (без items-start): прилипающему меню есть куда «ехать» внутри своей колонки.
        <div className="mx-auto grid w-full max-w-operator flex-1 grid-cols-sidebar gap-split px-6">
          <aside className="min-w-0 pt-12 pb-12">
            <div className="sticky-nav">
              <OperatorNavList nav={operator} />
            </div>
          </aside>
          <main id={MAIN_ID} tabIndex={-1} className="min-w-0 pt-12 pb-12 outline-none">
            {content}
          </main>
        </div>
      ) : (
        <main id={MAIN_ID} tabIndex={-1} className="mx-auto w-full max-w-content flex-1 px-6 pt-12 pb-12 outline-none">
          {content}
        </main>
      )}
    </div>
  );
}
