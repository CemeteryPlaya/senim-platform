import { Bell } from "lucide-react";
import Link from "next/link";
import type { ReactNode } from "react";
import { ru } from "@/i18n/ru";
import { AvatarMenu } from "./AvatarMenu";
import { LogoutButton } from "./LogoutButton";
import type { AppNav } from "./nav";
import { to } from "./paths";
import { ShellAction } from "./ShellAction";
import { MAIN_ID, SkipLink, UnavailableNotice } from "./ShellParts";
import { TopNav } from "./TopNav";

/** Что шапке нужно от вошедшего пользователя (подмножество CurrentUser); null — гость. */
export type DesktopUser = { fullName: string | null };

export type DesktopShellProps = {
  nav: AppNav;
  user: DesktopUser | null;
  /** identity не ответил: страница рисуется гостем, сверху — плашка «сервис временно недоступен». */
  unavailable?: boolean;
  children: ReactNode;
};

/**
 * Оболочка компьютера — меню сверху (эталон docs/design/v3/reference/desktop-layout.html, вариант A). Шапка 52 px
 * прилипает к верху; материал полупрозрачный (glass), содержимое прокручивается под ним, по нижнему краю — линия.
 * Слева название продукта (ссылка на главную), затем разделы строкой; справа действие роли (вторичной кнопкой — главная
 * кнопка принадлежит экрану), колокольчик и аватар с меню. Гостю справа — «Войти» той же вторичной кнопкой (на экранах входа её нет: человек уже там).
 * Сосредоточенная оболочка (`nav.focus`, первые шаги после входа): слева только название, справа только «Выйти»
 * (вторичная кнопка), без разделов, действия, колокольчика и аватара.
 * Содержимое по центру, до 1100 px. Брейкпоинтов нет: в узком окне оболочка не становится телефонной. Когда строка
 * не помещается (крупный шрифт, узкое окно), правая группа переходит на вторую строку у правого края, разделы
 * переносятся — шапка растёт, ничего не обрезается и не наезжает.
 */
export function DesktopShell({ nav, user, unavailable = false, children }: DesktopShellProps) {
  return (
    <div className="flex min-h-dvh flex-col">
      <SkipLink />
      <header data-top-bar className="glass sticky top-0 z-20 border-b border-line">
        <div className="mx-auto flex min-h-header w-full max-w-content flex-wrap items-center gap-x-6 px-6">
          {nav.focus ? (
            // Первые шаги: название — текст, а не ссылка (со шага уходить некуда).
            <span className="inline-flex min-h-control shrink-0 items-center text-card text-ink">{ru.common.brand}</span>
          ) : (
            <Link href={to("/")} className="inline-flex min-h-control shrink-0 items-center text-card text-ink no-underline">
              {ru.common.brand}
            </Link>
          )}
          {nav.sections.length > 0 && <TopNav items={nav.sections} />}
          <div className="ml-auto flex shrink-0 items-center gap-2">
            <ShellAction action={nav.action} />
            {nav.focus && <LogoutButton variant="secondary" />}
            {user && !nav.focus && (
              <Link
                href={to("/notifications")}
                aria-label={ru.app.shell.notifications}
                className="inline-flex size-control items-center justify-center rounded-control text-ink no-underline pressable hover:bg-line"
              >
                <Bell aria-hidden className="size-6" />
              </Link>
            )}
            {user && !nav.focus && <AvatarMenu fullName={user.fullName} />}
          </div>
        </div>
      </header>
      <main id={MAIN_ID} tabIndex={-1} className="mx-auto w-full max-w-content flex-1 px-6 pt-8 pb-12 outline-none">
        {unavailable && <UnavailableNotice />}
        {children}
      </main>
    </div>
  );
}
