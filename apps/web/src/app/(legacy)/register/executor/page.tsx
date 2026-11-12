import type { Metadata } from "next";
import Link from "next/link";
import { Clock } from "lucide-react";
import type { ReactNode } from "react";
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
import { Alert, ButtonLink, Card, Container, FullscreenStep, StatusBadge } from "@/ui";
import { ExecutorRegistrationForm } from "./ExecutorRegistrationForm";

const t = ru.identity.registration;

export const metadata: Metadata = { title: t.metaTitle };

/**
 * Регистрация исполнителя — полноэкранный шаг (FullscreenStep): «Назад», заголовок, одно главное действие внизу.
 * Гость видит шаги и подтверждает номер (вход по SMS с возвратом сюда); после входа — анкета; после отправки —
 * статус проверки оператором.
 */
export default async function ExecutorRegistrationPage() {
  const user = await getCurrentUser();
  // Анкета — после знакомства: ФИО и ИИН человека уже есть, ИП и самозанятому их не вводить второй раз.
  if (user) requireIntroduced(user, EXECUTOR_REGISTRATION_PATH);

  return <Container size="form" className="pt-3 pb-8 sm:pt-6">{user ? <ForUser user={user} /> : <ForGuest />}</Container>;
}

/** Шаг без формы: заголовок регистрации и «Назад» на главную. */
function Step({ action, children }: { action: ReactNode; children: ReactNode }) {
  return (
    <FullscreenStep title={t.title} back={{ href: "/" }} action={action}>
      {children}
    </FullscreenStep>
  );
}

function ForGuest() {
  return (
    <Step
      action={
        <>
          <ButtonLink href={loginHref(EXECUTOR_REGISTRATION_PATH)} fullWidth>
            {t.guest.start}
          </ButtonLink>
          <p className="text-center text-base text-ink-soft">
            {t.guest.haveAccount}{" "}
            <Link href={LOGIN_PATH} className="inline-flex min-h-control-sm items-center font-semibold text-primary underline underline-offset-4">
              {t.guest.login}
            </Link>
          </p>
        </>
      }
    >
      <p className="text-lg text-ink-soft">{t.lead}</p>
      <Card title={t.guest.stepsLabel} titleAs="h2">
        <ol className="flex flex-col gap-3">
          {t.guest.steps.map((step, i) => (
            <li key={step} className="flex items-start gap-3 text-lg text-ink">
              <span aria-hidden className="inline-flex size-8 shrink-0 items-center justify-center rounded-full bg-accent-soft text-base font-bold text-primary tabular-nums">
                {i + 1}
              </span>
              <span className="min-w-0 pt-0.5">{step}</span>
            </li>
          ))}
        </ol>
      </Card>
    </Step>
  );
}

async function ForUser({ user }: { user: CurrentUser }) {
  if (user.role === "OPERATOR") {
    return (
      <Step action={null}>
        <Alert tone="warning">{t.errors.operator}</Alert>
      </Step>
    );
  }

  const registration = await getMyRegistration(user);
  if (!registration) {
    return (
      <ExecutorRegistrationForm
        owner={{ fullName: user.fullName, iinLast4: user.iinLast4 }}
        intro={
          <>
            <p className="max-w-prose text-lg text-ink-soft">{t.lead}</p>
            {user.roles.includes("CLIENT") && <p className="max-w-prose text-lg text-ink">{t.keepsClient}</p>}
          </>
        }
      />
    );
  }

  switch (registration.status) {
    case "PENDING":
      return (
        <Step action={null}>
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
        </Step>
      );
    case "APPROVED":
      return (
        <Step
          action={
            <ButtonLink href="/executor/requests" fullWidth>
              {t.approved.action}
            </ButtonLink>
          }
        >
          <Card title={t.approved.title} description={t.approved.text} />
        </Step>
      );
    case "REJECTED":
      return (
        <ExecutorRegistrationForm
          defaultLegalForm={registration.legalForm}
          owner={{ fullName: user.fullName, iinLast4: user.iinLast4 }}
          intro={
            <Alert tone="danger" title={t.rejected.title}>
              {registration.rejectReason && <p>{t.rejected.reason(registration.rejectReason)}</p>}
              <p>{t.rejected.text}</p>
            </Alert>
          }
        />
      );
  }
}
