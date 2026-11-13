"use server";

import { notFound } from "next/navigation";
import { z } from "zod";
import { ru } from "@/i18n/ru";
import { action } from "@/platform/action";
import { env } from "@/platform/env";
import { fail } from "@/platform/errors";

const wait = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Действие-образец витрины (только dev): держит ответ 400 мс и всегда возвращает ошибку у поля `value` — на нём e2e
 * проверяет, что форма на `useActionForm` показывает ошибку, не теряет введённое и не отправляет дважды.
 */
export const sampleAction = action("uikit.sample", z.object({ value: z.string() }), async () => {
  if (env().APP_ENV !== "dev") notFound();
  await wait(400);
  return fail.validation(ru.app.kit.showcase.formSample.fieldError, {
    fieldErrors: { value: [ru.app.kit.showcase.formSample.fieldError] },
  });
});
