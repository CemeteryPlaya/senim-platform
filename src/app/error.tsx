"use client";

import { ru } from "@/i18n/ru";
import { Button, ButtonLink, Container, PageHeader } from "@/ui";

const e = ru.common.errors;

/**
 * Ошибка при показе страницы (граница ошибок Next.js — только клиентский компонент).
 * Главное действие — повторить: сбой часто временный; запасной выход — на главную.
 */
export default function ErrorPage({ retry }: { error: unknown; retry: () => void }) {
  return (
    <Container size="prose" className="pb-10">
      <PageHeader title={e.pageFailed} description={e.pageFailedText} />
      <div className="flex flex-col gap-3 sm:flex-row">
        <Button onClick={() => retry()}>{ru.common.actions.retry}</Button>
        <ButtonLink href="/" variant="secondary">
          {ru.common.actions.home}
        </ButtonLink>
      </div>
    </Container>
  );
}
