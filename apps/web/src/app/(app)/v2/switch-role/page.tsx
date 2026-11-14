import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";
import { ru } from "@/i18n/ru";
import { ActionDock, ButtonLink, Narrow, NowNext, PageTitle, Stack, TextLink } from "@/kit";
import { parseSwitchableRole } from "@/modules/identity";
import { homeFor, pageHref, requireV2User, safeNext } from "../../_shell/auth";
import { to } from "../../_shell/paths";
import { SwitchRoleForm } from "./SwitchRoleForm";

const t = ru.app.profile.switchRole;

export const metadata: Metadata = { title: t.metaTitle };

type Props = { searchParams: Promise<Record<string, string | string[] | undefined>> };

const one = (value: string | string[] | undefined): string | undefined => (typeof value === "string" ? value : undefined);

/**
 * Экран переключения роли (ADR-004). `to` — роль, `returnTo` — куда вернуться (только путь v2 этого сайта, safeNext).
 * Ворота: вошедший с пройденной анкетой, любой роли (не requireBuyer — иначе петля). Роль уже активна — сразу на возврат
 * или в дом. Роль выдана — «Вы сейчас — …» и одно главное действие «Перейти …»; не выдана — «Стать мастером» (регистрация
 * мастера, до этапа 4 — заглушка со ссылкой на v1) или только пояснение.
 */
export default async function SwitchRolePage({ searchParams }: Props) {
  const params = await searchParams;
  const target = parseSwitchableRole(params.to);
  if (!target) notFound();
  const user = await requireV2User(pageHref("/switch-role", params));
  const returnTo = safeNext(one(params.returnTo));
  if (user.role === target) redirect(returnTo ?? homeFor(user));

  const granted = user.roles.includes(target);
  const canBecomeMaster = !granted && target === "EXECUTOR" && user.role === "CLIENT";
  const now = t.now(ru.app.profile.roleNames[user.role]);
  const back = { href: to("/profile"), label: t.back };

  return (
    <Narrow>
      <Stack gap="section">
        <PageTitle title={t.title} back={back} />
        {granted ? (
          <>
            <NowNext now={{ title: now, body: t.keeps }} />
            <SwitchRoleForm role={target} returnTo={returnTo} />
          </>
        ) : (
          <>
            <NowNext now={{ title: t.noRole(ru.app.profile.roleNames[target]), ...(canBecomeMaster ? { body: t.becomeMasterBody } : {}) }} />
            <div>
              <TextLink href={homeFor(user)}>{t.home}</TextLink>
            </div>
            {canBecomeMaster && (
              <ActionDock>
                <ButtonLink href={to("/register/executor")}>{t.becomeMaster}</ButtonLink>
              </ActionDock>
            )}
          </>
        )}
      </Stack>
    </Narrow>
  );
}
