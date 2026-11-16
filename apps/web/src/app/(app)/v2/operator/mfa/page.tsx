import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { ru } from "@/i18n/ru";
import { needsSecondFactor, startTotpEnrollment } from "@/modules/identity";
import { nextStepFor, OPERATOR_MFA_SCREEN, requireV2User, safeNext, stepWithNext } from "../../../_shell/auth";
import { recallRole } from "../../../_shell/role-cookie";
import { MfaForm } from "./MfaForm";

export const metadata: Metadata = { title: ru.app.operator.mfa.metaTitle };

type Props = { searchParams: Promise<Record<string, string | string[] | undefined>> };

const one = (value: string | string[] | undefined): string | undefined => (typeof value === "string" ? value : undefined);

/**
 * Второй шаг входа оператора (TOTP): приложение не подключено — QR-код и ключ для ручного ввода, первый код подключает;
 * подключено — только поле кода. Шаг после входа, как согласие: страница берёт пользователя без ролей (правило 1 у
 * requireV2User), гость уходит на вход; второй шаг не нужен (не оператор) или уже пройден — дальше (`next` или дом).
 * Каждое открытие экрана подключения выдаёт новый секрет (прежний неподтверждённый перестаёт действовать): на экране всегда
 * тот QR-код, который примет identity. `next` — только путь v2 этого сайта (safeNext).
 */
export default async function OperatorMfaPage({ searchParams }: Props) {
  const next = safeNext(one((await searchParams).next));
  const user = await requireV2User(stepWithNext(OPERATOR_MFA_SCREEN, next));
  if (!needsSecondFactor(user)) redirect(nextStepFor(user, next, await recallRole()));

  const enrollment = await startTotpEnrollment(user);
  return (
    <MfaForm
      next={next}
      enrollment={
        enrollment && {
          secret: enrollment.secret,
          // QR — data:-URI из SVG, собранного на сервере (modules/identity/mfa.ts): своё белое поле, читается в обеих темах.
          qrSrc: `data:image/svg+xml;base64,${Buffer.from(enrollment.qrSvg).toString("base64")}`,
        }
      }
    />
  );
}
