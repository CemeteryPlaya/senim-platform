import type { Metadata } from "next";
import Link from "next/link";
import { Clock } from "lucide-react";
import { ru } from "@/i18n/ru";
import {
  EXECUTOR_REGISTRATION_PATH,
  getCurrentUser,
  getMyRegistration,
  LOGIN_PATH,
  loginHref,
  requireIntroduced,
  type CurrentUser,
} from "@/modules/identity";
import { Alert, ButtonLink, Card, Container, PageHeader, StatusBadge } from "@/ui";
import { ExecutorRegistrationForm } from "./ExecutorRegistrationForm";

const t = ru.identity.registration;

export const metadata: Metadata = { title: t.metaTitle };

/**
 * Регистрация исполнителя. Гость видит шаги и подтверждает номер (вход по SMS с возвратом сюда);
 * после входа — анкета; после отправки — статус проверки оператором.
 */
export default async function ExecutorRegistrationPage() {
  const user = await getCurrentUser();
  // Анкета — после знакомства: ФИО и ИИН человека уже есть, ИП и самозанятому их не вводить второй раз.
  if (user) requireIntroduced(user, EXECUTOR_REGISTRATION_PATH);

  return (
    <Container size="form">
      <PageHeader title={t.title} description={user ? undefined : t.lead} back={{ href: "/" }} />
      {user ? <ForUser user={user} /> : <ForGuest />}
    </Container>
  );
}

function ForGuest() {
  return (
    <div className="flex flex-col gap-6">
      <Card title={t.guest.stepsLabel} titleAs="h2">
        <ol className="flex list-decimal flex-col gap-2 pl-6 text-lg text-ink">
          {t.guest.steps.map((step) => (
            <li key={step}>{step}</li>
          ))}
        </ol>
      </Card>
      <ButtonLink href={loginHref(EXECUTOR_REGISTRATION_PATH)} fullWidth>
        {t.guest.start}
      </ButtonLink>
      <p className="text-base text-muted">
        {t.guest.haveAccount}{" "}
        <Link href={LOGIN_PATH} className="font-semibold text-primary underline underline-offset-4">
          {t.guest.login}
        </Link>
      </p>
    </div>
  );
}

async function ForUser({ user }: { user: CurrentUser }) {
  if (user.role === "OPERATOR") return <Alert tone="warning">{t.errors.operator}</Alert>;

  const registration = await getMyRegistration(user);
  if (!registration) {
    return (
      <div className="flex flex-col gap-6">
        <p className="max-w-prose text-lg text-muted">{t.lead}</p>
        {user.roles.includes("CLIENT") && <p className="max-w-prose text-lg text-ink">{t.keepsClient}</p>}
        <ExecutorRegistrationForm owner={{ fullName: user.fullName, iinLast4: user.iinLast4 }} />
      </div>
    );
  }

  switch (registration.status) {
    case "PENDING":
      return (
        <Card>
          <StatusBadge tone="warning" icon={<Clock />} className="self-start">
            {ru.identity.demo.executorStatus.PENDING}
          </StatusBadge>
          <h2 className="text-xl font-bold text-ink">{t.pending.title}</h2>
          <p className="text-lg text-ink">{t.pending.text}</p>
          <p className="text-base text-muted">
            {registration.legalName} · {t.pending.summary(t.legalForms[registration.legalForm], registration.binIinLast4)}
          </p>
        </Card>
      );
    case "APPROVED":
      return (
        <Card title={t.approved.title} description={t.approved.text}>
          <ButtonLink href="/executor/requests" fullWidth>
            {t.approved.action}
          </ButtonLink>
        </Card>
      );
    case "REJECTED":
      return (
        <div className="flex flex-col gap-6">
          <Alert tone="danger" title={t.rejected.title}>
            {registration.rejectReason && <p>{t.rejected.reason(registration.rejectReason)}</p>}
            <p>{t.rejected.text}</p>
          </Alert>
          <ExecutorRegistrationForm defaultLegalForm={registration.legalForm} owner={{ fullName: user.fullName, iinLast4: user.iinLast4 }} />
        </div>
      );
  }
}
