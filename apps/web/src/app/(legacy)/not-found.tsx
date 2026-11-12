import type { Metadata } from "next";
import { ru } from "@/i18n/ru";
import { ButtonLink, Container, PageHeader } from "@/ui";

const e = ru.common.errors;

export const metadata: Metadata = { title: e.notFound };

/** 404: крупный заголовок, одно действие — на главную. */
export default function NotFound() {
  return (
    <Container size="prose" className="pb-10">
      <PageHeader title={e.notFound} description={e.notFoundText} />
      <ButtonLink href="/">
        {ru.common.actions.home}
      </ButtonLink>
    </Container>
  );
}
