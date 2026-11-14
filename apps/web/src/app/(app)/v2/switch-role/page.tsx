import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";
import { ru } from "@/i18n/ru";
import { ActionDock, ButtonLink, Narrow, NowNext, PageTitle, Stack, TextLink } from "@/kit";
import { parseSwitchableRole, SWITCHABLE_ROLES } from "@/modules/identity";
import { homeAfterSwitch, homeFor, pageHref, requireV2User, safeNext } from "../../_shell/auth";
import { to } from "../../_shell/paths";
import { SwitchRoleForm } from "./SwitchRoleForm";

const t = ru.app.profile.switchRole;

export const metadata: Metadata = { title: t.metaTitle };

type Props = { searchParams: Promise<Record<string, string | string[] | undefined>> };

const one = (value: string | string[] | undefined): string | undefined => (typeof value === "string" ? value : undefined);

/**
 * Экран переключения роли (ADR-004). `to` — роль, `returnTo` — куда вернуться (только путь v2 этого сайта, safeNext).
 * Без `to` (прямой адрес, ссылка из профиля) — другая роль переключателя: экран говорит, кто вы сейчас, и предлагает
 * перейти в выданную роль или «Стать мастером». Неизвестное значение `to` — 404.
 * Ворота: вошедший с пройденной анкетой, любой роли (не requireBuyer — иначе петля). Роль уже активна — сразу на возврат
 * или в дом. Роль выдана — «Вы сейчас — …» и одно главное действие «Перейти …»; не выдана — «Стать мастером» (регистрация
 * мастера, до этапа 4 — заглушка со ссылкой на v1) или только пояснение.
 */
export default async function SwitchRolePage({ searchParams }: Props) {
  const params = await searchParams;
  const asked = params.to !== undefined;
  const parsed = parseSwitchableRole(params.to);
  if (asked && !parsed) notFound();
  const user = await requireV2User(pageHref("/switch-role", params));
  const target = parsed ?? SWITCHABLE_ROLES.find((role) => role !== user.role) ?? SWITCHABLE_ROLES[0];
  const returnTo = safeNext(one(params.returnTo));
  if (user.role === target) redirect(returnTo ?? homeAfterSwitch(user));

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
            {/* Без `to` человек пришёл узнать, кто он сейчас: заголовок — текущая роль; с `to` — чего не хватает. */}
            <NowNext
              now={
                asked
                  ? { title: t.noRole(ru.app.profile.roleNames[target]), ...(canBecomeMaster ? { body: t.becomeMasterBody } : {}) }
                  : { title: now, body: canBecomeMaster ? t.becomeMasterBody : t.noRole(ru.app.profile.roleNames[target]) }
              }
            />
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
