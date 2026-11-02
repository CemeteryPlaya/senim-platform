import Link from "next/link";
import { ShieldCheck } from "lucide-react";
import { switchTargets, type CurrentUser } from "@/modules/identity";
import { ru } from "@/i18n/ru";
import { ButtonLink, StatusBadge } from "@/ui";
import { LogoutButton } from "../_components/auth/LogoutButton";
import { SwitchRoleButton } from "../_components/auth/RoleButtons";
import { InstallMenuItem } from "../_components/install";
import { NotificationBell } from "../_components/notifications";
import { LOGIN_HREF, navFor } from "./nav";
import { DesktopNav, MobileTabBar } from "./ShellNav";

type Props = { user: CurrentUser | null; demoMode: boolean };

/**
 * Шапка по макетам: знак и «Сенім / Мебель на заказ» слева; справа — меню (широкий экран),
 * колокольчик со счётчиком, «Выйти» (широкий экран) и «Войти» для гостя. На телефоне меню — нижняя панель
 * вкладок, «Выйти» — в «Ещё».
 */
export function AppHeader({ user, demoMode }: Props) {
  const items = navFor(user, demoMode);
  // Переключатель роли — только у кого две роли и больше (ADR-004); на телефоне — в «Ещё».
  const targets = user ? switchTargets(user) : [];
  // Уведомления — колокольчик со счётчиком в шапке на любой ширине (у оператора тоже), а не пункт меню.
  const links = items.filter((item) => item.icon !== "notifications");

  return (
    <>
      <header className="border-b border-line bg-surface">
        {/* Контейнер: подзаголовок прячется, когда шапке тесно в em (крупный шрифт), а не обрезается. */}
        <div className="@container mx-auto flex min-h-18 max-w-page flex-wrap items-center justify-between gap-x-4 gap-y-2 px-4 py-2 sm:px-6">
          <Link href="/" aria-label={ru.common.shell.home} className="flex shrink-0 items-center gap-3 rounded-control no-underline">
            <span aria-hidden className="inline-flex size-12 shrink-0 items-center justify-center rounded-control bg-primary text-on-primary">
              <ShieldCheck className="size-7" />
            </span>
            <span className="flex flex-col">
              <span className="text-xl leading-tight font-extrabold text-ink">{ru.common.brand}</span>
              <span className="text-sm leading-tight text-muted @max-[19em]:hidden lg:@max-[56em]:hidden">{ru.common.shell.subtitle}</span>
            </span>
          </Link>

          <div className="flex flex-1 flex-wrap items-center justify-end gap-2">
            <DesktopNav items={links} />
            {/* Видимость — на обёртке: cn не сливает классы, и inline-flex компонента перебил бы hidden. */}
            {user && (
              <span className="hidden sm:block">
                <StatusBadge>{ru.common.roles[user.role]}</StatusBadge>
              </span>
            )}
            {targets.length > 0 && (
              <span className="hidden lg:block">
                <RoleSwitcher targets={targets} />
              </span>
            )}
            {user && <NotificationBell userId={user.id} />}
            {user && (
              <span className="hidden lg:block">
                <LogoutButton variant="ghost" />
              </span>
            )}
            {!user && (
              <ButtonLink href={LOGIN_HREF} variant="soft" shape="pill">
                {ru.common.nav.login}
              </ButtonLink>
            )}
          </div>
        </div>
      </header>
      <MobileTabBar
        items={links}
        extra={
          user ? (
            <>
              {targets.length > 0 && <RoleSwitcher targets={targets} fullWidth />}
              <InstallMenuItem />
              <LogoutButton variant="ghost" fullWidth />
            </>
          ) : undefined
        }
      />
    </>
  );
}

/** Кнопки «Перейти в роль …» для выданных ролей, кроме активной. */
function RoleSwitcher({ targets, fullWidth }: { targets: readonly ("CLIENT" | "EXECUTOR")[]; fullWidth?: boolean }) {
  return (
    <div role="group" aria-label={ru.identity.switchRole.switcherLabel} className="flex flex-col gap-2">
      {targets.map((role) => (
        <SwitchRoleButton key={role} role={role} variant="soft" fullWidth={fullWidth} />
      ))}
    </div>
  );
}
