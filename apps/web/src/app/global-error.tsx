"use client";

import { ru } from "@/i18n/ru";
import { Button, Container, PageHeader } from "@/ui";
import { fontVariables } from "@/ui/fonts";
import "./globals.css";

const e = ru.common.errors;

/**
 * Ошибка в самом корневом layout (граница ошибок Next.js заменяет весь документ, поэтому свои <html> и <body>).
 * Обычные ошибки страниц ловит error.tsx; сюда попадает то, что сломало оболочку. Главное действие — повторить.
 */
export default function GlobalError({ retry }: { error: unknown; retry: () => void }) {
  return (
    <html lang="ru" className={fontVariables}>
      <body className="flex min-h-dvh flex-col">
        <main className="flex flex-1 flex-col py-8">
          <Container size="prose">
            <PageHeader title={e.pageFailed} description={e.pageFailedText} />
            <Button onClick={() => retry()}>{ru.common.actions.retry}</Button>
          </Container>
        </main>
      </body>
    </html>
  );
}
