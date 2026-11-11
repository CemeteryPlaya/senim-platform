import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { AtSign, ShieldCheck, UserRound } from "lucide-react";
import type { ReactNode } from "react";
import { consentHref, formatPhone, getCurrentUser, loginHref, needsConsent, switchTargets } from "@/modules/identity";
import { env } from "@/platform/env";
import { features } from "@/platform/features";
import { ru } from "@/i18n/ru";
import { Container, KeyValueList, LinkList, PageHeader } from "@/ui";
import { LogoutButton } from "../_components/auth/LogoutButton";
import { SwitchRoleButton } from "../_components/auth/RoleButtons";
import { InstallMenuItem } from "../_components/install";
import { EnablePush } from "../_components/notifications";
import { NAV_ICONS } from "../_shell/icons";
import { ACCOUNT_HREF, navFor } from "../_shell/nav";

const t = ru.common.account;

export const metadata: Metadata = { title: t.metaTitle };

/**
 * «Профиль» — последняя вкладка нижней панели любой роли: кто вошёл («метка — значение»), переключение роли
 * (ADR-004), разделы роли, которых нет во вкладках (из той же модели меню navFor — здесь ссылки не задаются),
 * установка приложения и «Выйти». Белые карточки на сером фоне; на десктопе — две колонки. Заливной кнопки нет:
 * у экрана нет одного главного действия.
 */
export default async function ProfilePage() {
  const user = await getCurrentUser();
  if (!user) redirect(loginHref(ACCOUNT_HREF));
  // Без согласия на обработку ПДн текущей редакции — на экран согласия (там же «Выйти»); вторая ступень оператора здесь не нужна.
  if (needsConsent(user)) redirect(consentHref(ACCOUNT_HREF));
  const { tabs, more } = navFor(user, env().DEMO_MODE, features());
  // Вкладки и так на виду; здесь — остальные разделы роли (у исполнителя — профиль компании, портфолио, замеры).
  const sections = more.filter((item) => item.href !== ACCOUNT_HREF && !tabs.some((tab) => tab.href === item.href));
  const targets = switchTargets(user);
  const role = ru.common.roles[user.role];

  return (
    <Container className="flex flex-col gap-4 pb-10">
      <PageHeader title={t.title} back={{ href: "/" }} />

      <div className="grid grid-cols-[repeat(auto-fit,minmax(min(26rem,100%),1fr))] items-start gap-4 lg:gap-6">
        <div className="flex min-w-0 flex-col gap-4 lg:gap-6">
          <Panel labelledBy="account-who" title={t.who} lead={<UserBadge />}>
            <KeyValueList
              rows={[
                { label: t.rows.name, value: user.fullName ?? t.noName },
                { label: t.rows.role, value: role },
                { label: t.rows.phone, value: <span className="tabular-nums">{formatPhone(user.phone)}</span> },
              ]}
            />
            {(user.role === "CLIENT" || user.role === "EXECUTOR") && (
              <LinkList
                className="border-b-0"
                label={ru.identity.contacts.title}
                items={[
                  { href: "/profile/contacts", label: ru.identity.contacts.link, icon: <AtSign /> },
                  { href: "/profile/data", label: ru.consent.myData.link, icon: <ShieldCheck /> },
                ]}
              />
            )}
          </Panel>

          {targets.length > 0 && (
            <Panel labelledBy="account-role" title={t.roleTitle}>
              <div role="group" aria-label={ru.identity.switchRole.switcherLabel} className="flex flex-col gap-2">
                {targets.map((target) => (
                  <SwitchRoleButton key={target} role={target} variant="soft" fullWidth />
                ))}
              </div>
            </Panel>
          )}
        </div>

        <div className="flex min-w-0 flex-col gap-4 lg:gap-6">
          {sections.length > 0 && (
            <Panel labelledBy="account-sections" title={t.sections} as="nav">
              <LinkList className="border-b-0" items={sections.map((item) => ({ href: item.href, label: item.label, icon: <Icon of={item.icon} /> }))} />
            </Panel>
          )}

          <Panel labelledBy="account-app" title={t.app}>
            <div className="flex flex-col items-start gap-2">
              <InstallMenuItem />
              <EnablePush />
              <LogoutButton variant="ghost" />
            </div>
          </Panel>
        </div>
      </div>
    </Container>
  );
}

/** Белая карточка раздела профиля с заголовком h2 (подпись области для диктора). */
function Panel({
  labelledBy,
  title,
  lead,
  as: Tag = "section",
  children,
}: {
  labelledBy: string;
  title: string;
  lead?: ReactNode;
  as?: "section" | "nav";
  children: ReactNode;
}) {
  return (
    <Tag aria-labelledby={labelledBy} className="flex min-w-0 flex-col gap-3 rounded-card border border-line bg-surface p-4 sm:p-6">
      {/* При крупном шрифте заголовок уходит под значок, а не сжимается до буквы в строке. */}
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
        {lead}
        <h2 id={labelledBy} className="min-w-[min(10rem,100%)] flex-1 text-xl font-bold break-words text-ink">
          {title}
        </h2>
      </div>
      {children}
    </Tag>
  );
}

function UserBadge() {
  return (
    <span aria-hidden className="inline-flex size-14 shrink-0 items-center justify-center rounded-full bg-accent-soft text-primary">
      <UserRound className="size-7" />
    </span>
  );
}

function Icon({ of }: { of: keyof typeof NAV_ICONS }) {
  const Svg = NAV_ICONS[of];
  return <Svg />;
}
