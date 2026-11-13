import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { ru } from "@/i18n/ru";
import { consentDocument, needsConsent } from "@/modules/identity";
import { getDevice } from "@/platform/device";
import { nextStepFor, requireV2User, safeNext, stepWithNext } from "../../_shell/auth";
import { onboardingPosition } from "../../_shell/onboarding";
import { recallRole } from "../../_shell/role-cookie";
import { ConsentForm } from "./ConsentForm";

export const metadata: Metadata = { title: ru.app.onboarding.consent.metaTitle };

type Props = { searchParams: Promise<Record<string, string | string[] | undefined>> };

const one = (value: string | string[] | undefined): string | undefined => (typeof value === "string" ? value : undefined);

/**
 * Согласие на обработку персональных данных — первый шаг после входа. Гость уходит на вход, пользователь с пройденным
 * шагом — дальше (nextStepFor: следующий шаг, `next` или дом); барьер requireV2User на этой странице не срабатывает
 * сам на себя. Текст — текущая редакция из ru.consent; прежнее согласие другой редакции — «текст обновился».
 */
export default async function ConsentPage({ searchParams }: Props) {
  const next = safeNext(one((await searchParams).next));
  const user = await requireV2User(stepWithNext("/consent", next));
  if (!needsConsent(user)) redirect(nextStepFor(user, next, await recallRole()));

  const { step, total } = onboardingPosition(user, "consent");
  return (
    <ConsentForm
      document={consentDocument("PD_PROCESSING")}
      updated={user.consents.length > 0}
      next={next}
      step={step}
      total={total}
      device={await getDevice()}
    />
  );
}
