import Link from "next/link";
import { ShieldCheck } from "lucide-react";
import type { CurrentUser } from "@/modules/identity";
import { ru } from "@/i18n/ru";
import { ButtonLink, StatusBadge } from "@/ui";
import { NotificationBell } from "../_components/notifications";
import { ACCOUNT_HREF, LOGIN_HREF, navFor } from "./nav";
import { AccountLink, DesktopNav, MobileTabBar } from "./ShellNav";

type Props = { user: CurrentUser | null; demoMode: boolean };

/**
 * Шапка по макетам 7–19: знак и «Сенім / Мебель на заказ» слева; справа — меню (широкий экран), роль,
 * колокольчик со счётчиком, «Профиль» (широкий экран), «Войти» для гостя. На телефоне меню — нижняя панель
 * вкладок. «Выйти», переключатель роли и установка приложения — на странице «Профиль» (последняя вкладка).
 */
export function AppHeader({ user, demoMode }: Props) {
  const { tabs, more } = navFor(user, demoMode);
  const all = [...tabs, ...more];
  // Уведомления — колокольчик со счётчиком в шапке на любой ширине, а не пункт меню.
  const menu = all.filter((item) => item.href !== ACCOUNT_HREF && item.icon !== "notifications");
  const account = tabs.find((item) => item.href === ACCOUNT_HREF);

  return (
    <>
      <header className="border-b border-line bg-surface">
        {/* Контейнер: подзаголовок прячется, когда шапке тесно в em (крупный шрифт), а не обрезается. */}
        <div className="@container mx-auto flex min-h-16 max-w-page flex-wrap items-center justify-between gap-x-4 gap-y-2 px-4 py-2 sm:px-6">
          <Link href="/" aria-label={ru.common.shell.home} className="flex shrink-0 items-center gap-3 rounded-control no-underline">
            <span aria-hidden className="inline-flex size-11 shrink-0 items-center justify-center rounded-control bg-primary text-on-primary">
              <ShieldCheck className="size-6" />
            </span>
            <span className="flex flex-col">
              <span className="text-xl leading-tight font-extrabold text-ink">{ru.common.brand}</span>
              <span className="text-sm leading-tight text-muted @max-[19em]:hidden lg:@max-[60em]:hidden">{ru.common.shell.subtitle}</span>
            </span>
          </Link>

          <div className="flex flex-1 flex-wrap items-center justify-end gap-2">
            <DesktopNav items={menu} all={all} />
            {/* Видимость — на обёртке: cn не сливает классы, и inline-flex компонента перебил бы hidden. */}
            {user && (
              <span className="hidden sm:block">
                <StatusBadge tone="accent">{ru.common.roles[user.role]}</StatusBadge>
              </span>
            )}
            {user && <NotificationBell userId={user.id} />}
            {account && <AccountLink item={account} all={all} />}
            {!user && (
              <ButtonLink href={LOGIN_HREF} variant="soft" shape="pill">
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
