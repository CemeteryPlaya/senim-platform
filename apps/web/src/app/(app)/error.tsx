"use client";

import { useEffect } from "react";
import { ru } from "@/i18n/ru";
import { Button, ButtonLink, PageTitle } from "@/kit";
import { logger } from "@/platform/logger";
import { to } from "./_shell/paths";

const t = ru.app.shell;

/**
 * Сбой отрисовки экрана нового интерфейса (границы ошибок Next: node_modules/next/dist/docs, error.js). Файл лежит в
 * группе (app) и ловит ошибки страниц внутри оболочки; ошибку самого layout ловит global-error. Текст один и без
 * подробностей — они уходят в журнал. «Повторить» вызывает `retry()` (Next 16: перезапрашивает содержимое границы;
 * `reset()` только сбросил бы состояние ошибки без нового запроса). Одно главное действие — «Повторить», выход на
 * главную — вторая кнопка-ссылка.
 */
export default function AppError({ error, retry }: { error: unknown; retry: () => void }) {
  useEffect(() => {
    logger.error("app.error-boundary", { error });
  }, [error]);

  return (
    <div className="flex flex-col gap-6">
      <PageTitle title={t.errorTitle} lead={t.errorBody} />
      <div className="flex flex-col gap-3 desktop:flex-row">
        <Button onClick={() => retry()}>{t.errorRetry}</Button>
        <ButtonLink href={to("/")} variant="secondary">
          {t.errorHome}
        </ButtonLink>
      </div>
    </div>
  );
}
