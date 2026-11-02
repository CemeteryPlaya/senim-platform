import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { ru } from "@/i18n/ru";
import { getCurrentUser, homePathFor, introductionHref, loginHref, needsIntroduction, safeReturnTo } from "@/modules/identity";
import { Card, Container, PageHeader } from "@/ui";
import { LogoutButton } from "../_components/auth/LogoutButton";
import { IntroductionForm } from "./IntroductionForm";

const t = ru.identity.introduction;

export const metadata: Metadata = { title: t.metaTitle };

type Props = { searchParams: Promise<Record<string, string | string[] | undefined>> };

/**
 * Знакомство сразу после первого входа (№26): ФИО и ИИН один раз. Пока его нет, страницы заказчика
 * и исполнителя ведут сюда; выйти можно всегда. Пройденное знакомство — дальше по адресу возврата.
 */
export default async function WelcomePage({ searchParams }: Props) {
  const params = await searchParams;
  const next = safeReturnTo(params.next);
  const user = await getCurrentUser();
  if (!user) redirect(loginHref(introductionHref(next ?? undefined)));
  if (!needsIntroduction(user)) redirect(next ?? homePathFor(user));

  return (
    <Container size="form">
      <PageHeader title={t.title} back={{ href: "/" }} />
      <div className="flex flex-col gap-6">
        <p className="max-w-prose text-lg text-ink">{t.lead}</p>
        <Card>
          <IntroductionForm next={next} defaultFullName={user.fullName} />
        </Card>
        <LogoutButton variant="secondary" />
      </div>
    </Container>
  );
}
