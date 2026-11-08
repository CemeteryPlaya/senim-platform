import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { AtSign, UserRound } from "lucide-react";
import { getCurrentUser, loginHref, switchTargets } from "@/modules/identity";
import { env } from "@/platform/env";
import { features } from "@/platform/features";
import { ru } from "@/i18n/ru";
import { Container, LinkList, PageHeader, SectionTitle } from "@/ui";
import { LogoutButton } from "../_components/auth/LogoutButton";
import { SwitchRoleButton } from "../_components/auth/RoleButtons";
import { InstallMenuItem } from "../_components/install";
import { EnablePush } from "../_components/notifications";
import { NAV_ICONS } from "../_shell/icons";
import { ACCOUNT_HREF, navFor } from "../_shell/nav";

const t = ru.common.account;

export const metadata: Metadata = { title: t.metaTitle };

/**
 * «Профиль» — последняя вкладка нижней панели любой роли (макеты 7, 12, 19): кто вошёл, переключение роли
 * (ADR-004), разделы, которых нет во вкладках, установка приложения и «Выйти». На телефоне это заменяет
 * прежнее меню «Ещё» — всё видно сразу, без раскрывающихся списков.
 */
export default async function ProfilePage() {
  const user = await getCurrentUser();
  if (!user) redirect(loginHref(ACCOUNT_HREF));
  const { tabs, more } = navFor(user, env().DEMO_MODE, features());
  // Вкладки и так на виду; здесь — остальные разделы роли (у исполнителя — профиль компании, портфолио, замеры).
  const sections = more.filter((item) => item.href !== ACCOUNT_HREF && !tabs.some((tab) => tab.href === item.href));
  const targets = switchTargets(user);

  return (
    <Container size="form" className="flex flex-col gap-6 pb-10">
      <PageHeader title={t.title} back={{ href: "/" }} />

      <section aria-label={t.title} className="flex items-center gap-4">
        <span aria-hidden className="inline-flex size-16 shrink-0 items-center justify-center rounded-full bg-sunken text-ink-soft">
          <UserRound className="size-8" />
        </span>
        <div className="flex min-w-0 flex-col gap-0.5">
          <p className="text-xl font-bold text-ink">{user.fullName ?? t.noName}</p>
          <p className="text-base text-muted">{t.roleLine(ru.common.roles[user.role])}</p>
          <p className="text-base text-muted tabular-nums">{user.phone}</p>
        </div>
      </section>

      {targets.length > 0 && (
        <section aria-labelledby="account-role" className="flex flex-col gap-3">
          <SectionTitle id="account-role" title={t.roleTitle} />
          <div role="group" aria-label={ru.identity.switchRole.switcherLabel} className="flex flex-col gap-2">
            {targets.map((role) => (
              <SwitchRoleButton key={role} role={role} variant="soft" fullWidth />
            ))}
          </div>
        </section>
      )}

      {(user.role === "CLIENT" || user.role === "EXECUTOR") && (
        <nav aria-label={ru.identity.contacts.title}>
          <LinkList items={[{ href: "/profile/contacts", label: ru.identity.contacts.link, icon: <AtSign /> }]} />
        </nav>
      )}

      {sections.length > 0 && (
        <section aria-labelledby="account-sections" className="flex flex-col gap-3">
          <SectionTitle id="account-sections" title={t.sections} />
          <LinkList items={sections.map((item) => ({ href: item.href, label: item.label, icon: <Icon of={item.icon} /> }))} />
        </section>
      )}

      <section aria-labelledby="account-app" className="flex flex-col gap-3">
        <SectionTitle id="account-app" title={t.app} />
        <div className="flex flex-col items-start gap-2">
          <InstallMenuItem />
          <EnablePush />
          <LogoutButton variant="ghost" />
        </div>
      </section>
    </Container>
  );
}

function Icon({ of }: { of: keyof typeof NAV_ICONS }) {
  const Svg = NAV_ICONS[of];
  return <Svg />;
}
