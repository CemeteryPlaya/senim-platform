import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { ru } from "@/i18n/ru";
import { consentHref, getCurrentUser, homePathFor, introductionHref, loginHref, needsConsent, needsIntroduction, safeReturnTo } from "@/modules/identity";
import { Container } from "@/ui";
import { IntroductionForm } from "./IntroductionForm";

const t = ru.identity.introduction;

export const metadata: Metadata = { title: t.metaTitle };

type Props = { searchParams: Promise<Record<string, string | string[] | undefined>> };

/**
 * Знакомство сразу после первого входа и согласия на обработку ПДн (№26): ФИО и ИИН один раз. Пока его нет, страницы заказчика
 * и исполнителя ведут сюда; выйти можно всегда. Пройденное знакомство — дальше по адресу возврата.
 */
export default async function WelcomePage({ searchParams }: Props) {
  const params = await searchParams;
  const next = safeReturnTo(params.next);
  const user = await getCurrentUser();
  if (!user) redirect(loginHref(introductionHref(next ?? undefined)));
  // ФИО и ИИН собираются только после согласия на обработку ПДн (A.7 P2: согласие до сбора).
  if (needsConsent(user)) redirect(consentHref(introductionHref(next ?? undefined)));
  if (!needsIntroduction(user)) redirect(next ?? homePathFor(user));

  return (
    <Container size="form" className="pt-3 pb-8 sm:pt-6">
      <IntroductionForm next={next} defaultFullName={user.fullName} />
    </Container>
  );
}
