import Link from "next/link";
import { ShieldCheck } from "lucide-react";
import type { CurrentUser } from "@/modules/identity";
import { ru } from "@/i18n/ru";
import { ButtonLink, StatusBadge } from "@/ui";
import { LOGIN_HREF, navFor } from "./nav";
import { DesktopNav, MobileBell, MobileTabBar } from "./ShellNav";

type Props = { user: CurrentUser | null; demoMode: boolean };

/**
 * Шапка по макетам: знак и «Сенім / Мебель на заказ» слева; справа — меню (широкий экран),
 * колокольчик (телефон) и «Войти» для гостя. На телефоне меню — нижняя панель вкладок.
 */
export function AppHeader({ user, demoMode }: Props) {
  const items = navFor(user, demoMode);
  const bell = items.find((item) => item.icon === "notifications");
  const tabs = items.filter((item) => item !== bell);

  return (
    <>
      <header className="border-b border-line bg-surface">
        <div className="mx-auto flex min-h-18 max-w-page items-center justify-between gap-4 px-4 py-2 sm:px-6">
          <Link href="/" aria-label={ru.common.shell.home} className="flex min-w-0 items-center gap-3 rounded-control no-underline">
            <span aria-hidden className="inline-flex size-12 shrink-0 items-center justify-center rounded-control bg-primary text-on-primary">
              <ShieldCheck className="size-7" />
            </span>
            <span className="flex min-w-0 flex-col">
              <span className="text-xl leading-tight font-extrabold text-ink">{ru.common.brand}</span>
              <span className="truncate text-sm leading-tight text-muted">{ru.common.shell.subtitle}</span>
            </span>
          </Link>

          <div className="flex shrink-0 items-center gap-2">
            <DesktopNav items={items} />
            {user && <StatusBadge className="hidden sm:inline-flex">{ru.common.roles[user.role]}</StatusBadge>}
            <MobileBell item={bell} />
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
