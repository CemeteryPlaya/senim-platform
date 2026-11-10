"use client";

import { ru } from "@/i18n/ru";
import { Button, buttonClasses, Container, PageHeader } from "@/ui";
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
            <div className="flex flex-col gap-3 sm:flex-row">
              <Button onClick={() => retry()}>{ru.common.actions.retry}</Button>
              {/* Обычная ссылка, не next/link: роутер Next при сбое корня может не работать, а полная загрузка главной надёжна. */}
              {/* eslint-disable-next-line @next/next/no-html-link-for-pages */}
              <a href="/" className={buttonClasses({ variant: "secondary" })}>
                {ru.common.actions.home}
              </a>
            </div>
          </Container>
        </main>
      </body>
    </html>
  );
}
