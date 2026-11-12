import type { Metadata } from "next";
import Link from "next/link";
import { ru } from "@/i18n/ru";
import { EXECUTOR_REGISTRATION_PATH, getShellUser, homePathFor, safeReturnTo } from "@/modules/identity";
import { env } from "@/platform/env";
import { Alert, ButtonLink, Container, FullscreenStep } from "@/ui";
import { LogoutButton } from "../_components/auth/LogoutButton";
import { LoginForm } from "./LoginForm";

const t = ru.identity.login;

export const metadata: Metadata = { title: t.metaTitle };

type Props = { searchParams: Promise<Record<string, string | string[] | undefined>> };

/**
 * Вход — полноэкранный шаг (FullscreenStep): «Назад», один вопрос и одна главная кнопка. Демо-персоны (только
 * DEMO_MODE) и регистрация мастера — второстепенные пути под ней. Вошедшему — куда идти дальше и «Выйти».
 * Недоступный identity — форма входа гостя, как в оболочке.
 */
export default async function LoginPage({ searchParams }: Props) {
  const params = await searchParams;
  const next = safeReturnTo(params.next);
  const wrongRole = params.reason === "role";
  const { user } = await getShellUser();
  const demoMode = env().DEMO_MODE;

  return (
    <Container size="form" className="pt-3 pb-8 sm:pt-6">
      {user ? (
        <FullscreenStep
          title={t.metaTitle}
          back={{ href: "/" }}
          action={
            <>
              <ButtonLink href={homePathFor(user)} fullWidth>
                {t.goHome}
              </ButtonLink>
              <LogoutButton variant="secondary" fullWidth />
            </>
          }
        >
          {wrongRole && (
            <Alert tone="warning" live="polite">
              {t.wrongRole}
            </Alert>
          )}
          <p className="text-lg text-ink">{t.alreadySignedIn(ru.common.roles[user.role])}</p>
        </FullscreenStep>
      ) : (
        <LoginForm
          next={next}
          extra={
            <>
              {demoMode && (
                <ButtonLink href="/demo" variant="secondary" fullWidth>
                  {t.demoPersonas}
                </ButtonLink>
              )}
              <Link
                href={EXECUTOR_REGISTRATION_PATH}
                className="inline-flex min-h-control-sm items-center justify-center self-center rounded-control px-2 text-center text-base font-semibold text-primary underline underline-offset-4"
              >
                {t.registerExecutor}
              </Link>
            </>
          }
        />
      )}
    </Container>
  );
}
