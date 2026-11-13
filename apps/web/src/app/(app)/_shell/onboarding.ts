import "server-only";
import { needsConsent, needsEmail, needsIntroduction } from "@/modules/identity";
import type { StepUser } from "./auth";

/** Экраны первых шагов после входа, в том порядке, в каком их ведёт barrierFor. */
export type OnboardingScreen = "consent" | "welcome" | "email";

/** Ещё не пройденные первые шаги человека, по порядку. Сотрудников площадки они не касаются — для них список пуст. */
export function pendingOnboarding(user: StepUser): OnboardingScreen[] {
  const steps: OnboardingScreen[] = [];
  if (needsConsent(user)) steps.push("consent");
  if (needsIntroduction(user)) steps.push("welcome");
  if (needsEmail(user)) steps.push("email");
  return steps;
}

/**
 * «Шаг N из M» для экрана первых шагов — по тому, что человеку осталось пройти, а не по всем возможным шагам: вернувшемуся
 * пользователю, у которого не хватает только почты, не показывается «Шаг 3 из 3». Экран, которого нет среди непройденных,
 * — единственный шаг (1 из 1): страница шага такого человека всё равно уводит дальше.
 */
export function onboardingPosition(user: StepUser, screen: OnboardingScreen): { step: number; total: number } {
  const pending = pendingOnboarding(user);
  const index = pending.indexOf(screen);
  return index < 0 ? { step: 1, total: 1 } : { step: index + 1, total: pending.length };
}
