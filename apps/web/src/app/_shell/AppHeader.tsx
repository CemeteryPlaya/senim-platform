import Link from "next/link";
import { ShieldCheck } from "lucide-react";
import type { CurrentUser } from "@/modules/identity";
import { features } from "@/platform/features";
import { ru } from "@/i18n/ru";
import { InstallHeaderItem } from "../_components/install";
import { NotificationBell } from "../_components/notifications";
import { navFor } from "./nav";
import { MobileMenu, MobileTabBar } from "./ShellNav";
import { SideNav } from "./SideNav";

type Props = { user: CurrentUser | null; demoMode: boolean };

/**
 * Каркас: на десктопе (от 1024 px) — боковое меню 240 px (SideNav) и шапка без логотипа; на телефоне и планшете —
 * шапка с логотипом и нижняя панель вкладок (MobileTabBar). В шапке справа: «Установить приложение», колокольчик
 * со счётчиком и — у роли без вкладок (оператор) на телефоне — кнопка «Меню». «Войти» гостя — вкладка меню/панели,
 * в шапке его нет: на любой ширине оно одно. «Выйти» и переключатель роли — на странице «Профиль».
 */
export function AppHeader({ user, demoMode }: Props) {
  const { tabs, more } = navFor(user, demoMode, features());
  // Уведомления — колокольчик со счётчиком в шапке на любой ширине, а не пункт меню.
  const sections = [...tabs, ...more].filter((item) => item.icon !== "notifications");
  const primary = tabs.find((item) => item.primary);
  const sideTabs = tabs.filter((item) => item !== primary);
  const sideMore = more.filter((item) => item.icon !== "notifications");
  // Телефон: у роли без вкладок (оператор) разделы открывает кнопка «Меню» в шапке.
  const phoneMenu = tabs.length === 0 ? sections : [];

  return (
    <>
      <SideNav items={sideTabs} more={sideMore} primary={primary} />
      <header className="relative border-b border-line bg-surface">
        <div className="mx-auto flex min-h-16 max-w-page items-center justify-between gap-x-2 px-4 py-2 sm:gap-x-4 sm:px-6">
          <Link href="/" aria-label={ru.common.shell.home} className="flex shrink-0 items-center gap-2 rounded-control no-underline lg:hidden">
            <ShieldCheck aria-hidden className="size-7 shrink-0 text-primary" />
            <span className="text-xl leading-tight font-extrabold text-ink">{ru.common.brand}</span>
          </Link>

          <div className="flex min-w-0 flex-1 items-center justify-end gap-1 sm:gap-2">
            <InstallHeaderItem guest={!user} />
            {user && <NotificationBell userId={user.id} />}
            {phoneMenu.length > 0 && <MobileMenu items={phoneMenu} />}
          </div>
        </div>
      </header>
      <MobileTabBar items={tabs} />
    </>
  );
}
