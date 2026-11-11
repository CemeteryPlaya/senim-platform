import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { ru } from "@/i18n/ru";
import { consentDocument, consentHref, getCurrentUser, homePathFor, loginHref, needsConsent, safeReturnTo } from "@/modules/identity";
import { Container } from "@/ui";
import { ConsentForm } from "./ConsentForm";

const t = ru.consent.screen;

export const metadata: Metadata = { title: t.metaTitle };

type Props = { searchParams: Promise<Record<string, string | string[] | undefined>> };

/**
 * Согласие на обработку ПДн сразу после входа (правовое исследование A.2, A.7 P2): текст текущей редакции и одна кнопка
 * «Даю согласие». Пока согласия текущей редакции нет, страницы и действия ведут сюда с возвратом (next). Гость — на вход с
 * возвратом сюда; согласие уже есть (или сотрудник площадки) — дальше по адресу возврата. Выйти можно всегда.
 */
export default async function ConsentPage({ searchParams }: Props) {
  const params = await searchParams;
  const next = safeReturnTo(params.next);
  const user = await getCurrentUser();
  if (!user) redirect(loginHref(consentHref(next ?? undefined)));
  if (!needsConsent(user)) redirect(next ?? homePathFor(user));

  return (
    <Container size="form" className="pt-3 pb-8 sm:pt-6">
      {/* Действующее согласие прежней редакции — значит, текст обновился. */}
      <ConsentForm next={next} updated={user.consents.length > 0} document={consentDocument("PD_PROCESSING")} />
    </Container>
  );
}
