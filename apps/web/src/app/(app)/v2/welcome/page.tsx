import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { ru } from "@/i18n/ru";
import { needsIntroduction } from "@/modules/identity";
import { getDevice } from "@/platform/device";
import { nextStepFor, requireV2User, safeNext, stepWithNext } from "../../_shell/auth";
import { onboardingPosition } from "../../_shell/onboarding";
import { recallRole } from "../../_shell/role-cookie";
import { WelcomeForm } from "./WelcomeForm";

export const metadata: Metadata = { title: ru.app.onboarding.welcome.metaTitle };

type Props = { searchParams: Promise<Record<string, string | string[] | undefined>> };

const one = (value: string | string[] | undefined): string | undefined => (typeof value === "string" ? value : undefined);

/**
 * Знакомство — второй шаг после входа: ФИО и ИИН один раз. Гость уходит на вход; без согласия — на согласие (барьер
 * requireV2User, ФИО и ИИН собираются только после него); пройденное знакомство — дальше (nextStepFor).
 */
export default async function WelcomePage({ searchParams }: Props) {
  const next = safeNext(one((await searchParams).next));
  const user = await requireV2User(stepWithNext("/welcome", next));
  if (!needsIntroduction(user)) redirect(nextStepFor(user, next, await recallRole()));

  const { step, total } = onboardingPosition(user, "welcome");
  return <WelcomeForm defaultFullName={user.fullName} next={next} step={step} total={total} device={await getDevice()} />;
}
