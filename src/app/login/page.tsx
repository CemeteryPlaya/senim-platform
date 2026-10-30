import type { Metadata } from "next";
import Link from "next/link";
import { ru } from "@/i18n/ru";
import { EXECUTOR_REGISTRATION_PATH, getCurrentUser, homePathFor, safeReturnTo } from "@/modules/identity";
import { env } from "@/platform/env";
import { Alert, ButtonLink, Card, Container, PageHeader } from "@/ui";
import { LogoutButton } from "../_components/auth/LogoutButton";
import { LoginForm } from "./LoginForm";

const t = ru.identity.login;

export const metadata: Metadata = { title: t.metaTitle };

type Props = { searchParams: Promise<Record<string, string | string[] | undefined>> };

export default async function LoginPage({ searchParams }: Props) {
  const params = await searchParams;
  const next = safeReturnTo(params.next);
  const wrongRole = params.reason === "role";
  const user = await getCurrentUser();
  const demoMode = env().DEMO_MODE;

  return (
    <Container size="form">
      <PageHeader title={t.metaTitle} back={{ href: "/" }} />
      <div className="flex flex-col gap-6">
        {user ? (
          <Card>
            {wrongRole && (
              <Alert tone="warning" live="polite">
                {t.wrongRole}
              </Alert>
            )}
            <p className="text-lg text-ink">{t.alreadySignedIn(ru.common.roles[user.role])}</p>
            <div className="flex flex-wrap gap-3">
              <ButtonLink href={homePathFor(user)}>{t.goHome}</ButtonLink>
              <LogoutButton variant="secondary" />
            </div>
          </Card>
        ) : (
          <Card>
            <LoginForm next={next} />
          </Card>
        )}

        {!user && (
          <div className="flex flex-col gap-3">
            {demoMode && (
              <ButtonLink href="/demo" variant="soft" fullWidth>
                {t.demoPersonas}
              </ButtonLink>
            )}
            <Link href={EXECUTOR_REGISTRATION_PATH} className="text-base font-semibold text-primary underline underline-offset-4">
              {t.registerExecutor}
            </Link>
          </div>
        )}
      </div>
    </Container>
  );
}
