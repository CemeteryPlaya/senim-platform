import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { ru } from "@/i18n/ru";
import { needsEmail } from "@/modules/identity";
import { getDevice } from "@/platform/device";
import { nextStepFor, requireV2User, safeNext, stepWithNext } from "../../_shell/auth";
import { onboardingPosition } from "../../_shell/onboarding";
import { recallRole } from "../../_shell/role-cookie";
import { EmailFlow } from "./EmailFlow";
import { parseEmailStep } from "./steps";

export const metadata: Metadata = { title: ru.app.onboarding.email.metaTitle };

type Props = { searchParams: Promise<Record<string, string | string[] | undefined>> };

const one = (value: string | string[] | undefined): string | undefined => (typeof value === "string" ? value : undefined);

/**
 * Почта — третий, последний шаг после входа: адрес и код из письма. Гость уходит на вход; без согласия или знакомства —
 * на них (барьер requireV2User); почта уже подтверждена или не нужна (сотрудники площадки — needsEmail) — дальше
 * (nextStepFor: `next` или дом), кроме режима смены адреса. Существующий покупатель или мастер без подтверждённой почты попадает сюда тем же
 * барьером с сохранённым `next`.
 */
export default async function EmailPage({ searchParams }: Props) {
  const params = await searchParams;
  const next = safeNext(one(params.next));
  const user = await requireV2User(stepWithNext("/email", next));
  // Смена подтверждённой почты (`?change=1` из контактов профиля): экран открыт тому, у кого почта уже подтверждена.
  // Без подтверждённой почты параметр ничего не значит — идут обычные первые шаги.
  const change = one(params.change) === "1" && !needsEmail(user);
  if (!needsEmail(user) && !change) redirect(nextStepFor(user, next, await recallRole()));

  return (
    <EmailFlow step={parseEmailStep(one(params.step))} next={change ? null : next} change={change} position={onboardingPosition("email")} device={await getDevice()} />
  );
}
