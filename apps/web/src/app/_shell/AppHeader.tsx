import Link from "next/link";
import { ShieldCheck } from "lucide-react";
import type { CurrentUser } from "@/modules/identity";
import { features } from "@/platform/features";
import { ru } from "@/i18n/ru";
import { ButtonLink } from "@/ui";
import { InstallHeaderItem } from "../_components/install";
import { NotificationBell } from "../_components/notifications";
import { ACCOUNT_HREF, LOGIN_HREF, navFor } from "./nav";
import { AccountLink, DesktopNav, MobileTabBar } from "./ShellNav";

type Props = { user: CurrentUser | null; demoMode: boolean };

/**
 * Шапка в духе приложения Upwork: зелёный знак и «Сенім» слева; справа — меню (широкий экран), колокольчик
 * со счётчиком, «Профиль» (широкий экран), «Войти» для гостя. Роль — на странице «Профиль». На телефоне меню — нижняя панель
 * вкладок. «Установить приложение» — в шапке у всех; «Выйти» и переключатель роли — на странице «Профиль» (последняя вкладка).
 */
export function AppHeader({ user, demoMode }: Props) {
  const { tabs, more } = navFor(user, demoMode, features());
  const all = [...tabs, ...more];
  // Уведомления — колокольчик со счётчиком в шапке на любой ширине, а не пункт меню.
  const menu = all.filter((item) => item.href !== ACCOUNT_HREF && item.icon !== "notifications");
  const account = all.find((item) => item.href === ACCOUNT_HREF);

  return (
    <>
      <header className="relative border-b border-line bg-surface">
        <div className="mx-auto flex min-h-16 max-w-page items-center justify-between gap-x-2 px-4 py-2 sm:gap-x-4 sm:px-6">
          <Link href="/" aria-label={ru.common.shell.home} className="flex shrink-0 items-center gap-2 rounded-control no-underline">
            <ShieldCheck aria-hidden className="size-7 shrink-0 text-primary" />
            <span className="text-xl leading-tight font-extrabold text-ink">{ru.common.brand}</span>
          </Link>

          <div className="flex min-w-0 flex-1 items-center justify-end gap-1 sm:gap-2">
            <DesktopNav items={menu} all={all} />
            <InstallHeaderItem guest={!user} />
            {user && <NotificationBell userId={user.id} />}
            {account && <AccountLink item={account} all={all} />}
            {!user && (
              <ButtonLink href={LOGIN_HREF} variant="soft" shape="pill" className="shrink-0 whitespace-nowrap">
                {ru.common.nav.login}
              </ButtonLink>
            )}
          </div>
        </div>
      </header>
      <MobileTabBar items={tabs} />
    </>
  );
}
