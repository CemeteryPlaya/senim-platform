import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { ru } from "@/i18n/ru";
import { getCurrentUser, loginHref, mfaHref, safeReturnTo, startTotpEnrollment } from "@/modules/identity";
import { Container } from "@/ui";
import { param } from "../_lib/guard";
import { MfaForm } from "./MfaForm";

export const metadata: Metadata = { title: ru.identity.mfa.metaTitle };

type Props = { searchParams: Promise<Record<string, string | string[] | undefined>> };

const OPERATOR_HOME = "/operator";

/**
 * Вторая ступень входа оператора. Приложение не подключено — QR-код и ключ для ручного ввода, первый код подключает;
 * подключено — только поле кода. Одно главное действие. Вторая ступень уже пройдена — сразу на next.
 * Каждое открытие экрана подключения выдаёт новый секрет (прежний неподтверждённый перестаёт действовать): на экране
 * всегда тот QR, который примет identity.
 */
export default async function MfaPage({ searchParams }: Props) {
  const next = safeReturnTo(param((await searchParams).next)) ?? OPERATOR_HOME;
  const user = await getCurrentUser();
  if (!user) redirect(loginHref(mfaHref(next)));
  if (!user.mfa.required) redirect(loginHref(mfaHref(next), "role"));
  if (user.mfa.verifiedAt) redirect(next);

  const enrollment = await startTotpEnrollment(user);
  return (
    <Container size="form">
      {enrollment ? (
        <MfaForm
          mode="enroll"
          next={next}
          enrollment={{ secret: enrollment.secret, qrSrc: `data:image/svg+xml;base64,${Buffer.from(enrollment.qrSvg).toString("base64")}` }}
        />
      ) : (
        <MfaForm mode="verify" next={next} />
      )}
    </Container>
  );
}
