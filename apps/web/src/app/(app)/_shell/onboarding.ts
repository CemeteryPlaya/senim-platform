import "server-only";
import { revalidatePath } from "next/cache";
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
 * Пройден один из первых шагов (Server Action согласия, знакомства, почты): оболочка (layout) может смениться с
 * сосредоточенной (название и «Выйти») на обычную с меню — если это был последний шаг или следующий экран сам ведёт
 * дальше (почта уже подтверждена в identity — стенд после пересева базы web). Действие шага изменило данные, но не
 * cookie, а redirect из Server Action без перерисовки клиентский роутер ведёт со старым layout: человек видел свой дом
 * без меню до перезагрузки. Поэтому layout группы помечается устаревшим — как после смены роли (регистрация мастера).
 */
export function shellChanged(): void {
  revalidatePath("/(app)", "layout");
}

/** Постоянная последовательность первых шагов: номер шага — его место в ней, а не число оставшихся. */
const SEQUENCE: readonly OnboardingScreen[] = ["consent", "welcome", "email"];

/**
 * «Шаг N из 3» для экрана первых шагов: последовательность постоянна (согласие, знакомство, почта), N — место экрана в ней,
 * то есть N−1 шагов пройдено раньше. Новичок видит 1/3, 2/3, 3/3 без отката; вернувшийся с согласием сразу видит 2/3.
 */
export function onboardingPosition(screen: OnboardingScreen): { step: number; total: number } {
  return { step: SEQUENCE.indexOf(screen) + 1, total: SEQUENCE.length };
}
