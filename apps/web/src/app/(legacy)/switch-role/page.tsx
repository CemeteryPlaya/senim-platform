import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";
import { ru } from "@/i18n/ru";
import {
  EXECUTOR_REGISTRATION_PATH,
  getCurrentUser,
  homePathFor,
  loginHref,
  parseSwitchableRole,
  safeReturnTo,
  switchRoleHref,
  type CurrentUser,
} from "@/modules/identity";
import { Alert, ButtonLink, Card, Container, PageHeader } from "@/ui";
import { BecomeClientButton, SwitchRoleButton } from "../_components/auth/RoleButtons";

const t = ru.identity.switchRole;

export const metadata: Metadata = { title: t.metaTitle };

type Props = { searchParams: Promise<Record<string, string | string[] | undefined>> };

/**
 * Страница требует роль, которая у человека есть, но не активна (ADR-004): объяснение и одна главная кнопка
 * «Перейти в роль …». returnTo — только путь внутри сайта (safeReturnTo). Роли нет — как её получить.
 */
export default async function SwitchRolePage({ searchParams }: Props) {
  const params = await searchParams;
  const to = parseSwitchableRole(params.to);
  if (!to) notFound();
  const returnTo = safeReturnTo(params.returnTo) ?? undefined;
  const user = await getCurrentUser();
  if (!user) redirect(loginHref(switchRoleHref(to, returnTo)));
  if (user.role === to) redirect(returnTo ?? homePathFor(user));

  return (
    <Container size="form">
      <PageHeader title={t.title} back={{ href: homePathFor(user) }} />
      {user.roles.includes(to) ? <Switch user={user} to={to} returnTo={returnTo} /> : <NoRole user={user} to={to} />}
    </Container>
  );
}

function Switch({ user, to, returnTo }: { user: CurrentUser; to: "CLIENT" | "EXECUTOR"; returnTo?: string }) {
  return (
    <Card>
      <p className="text-lg font-semibold text-ink">{t.needs(ru.common.roles[to])}</p>
      <p className="text-lg text-ink">{t.current(ru.common.roles[user.role])}</p>
      <p className="text-base text-muted">{t.keeps}</p>
      <SwitchRoleButton role={to} returnTo={returnTo} fullWidth />
    </Card>
  );
}

/** Роли нет: исполнителем становятся через анкету (проверяет оператор), заказчиком — сразу из роли исполнителя. */
function NoRole({ user, to }: { user: CurrentUser; to: "CLIENT" | "EXECUTOR" }) {
  const roleName = ru.common.roles[to];
  return (
    <div className="flex flex-col gap-6">
      <Alert tone="warning">{t.noRole(roleName)}</Alert>
      {to === "EXECUTOR" && user.role === "CLIENT" && (
        <ButtonLink href={EXECUTOR_REGISTRATION_PATH} fullWidth>
          {t.becomeExecutor}
        </ButtonLink>
      )}
      {to === "CLIENT" && user.role === "EXECUTOR" && (
        <Card title={ru.identity.becomeClient.title} titleAs="h2" description={ru.identity.becomeClient.text}>
          <BecomeClientButton variant="primary" fullWidth />
        </Card>
      )}
    </div>
  );
}
