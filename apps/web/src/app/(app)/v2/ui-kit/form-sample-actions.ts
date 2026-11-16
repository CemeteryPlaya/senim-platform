"use server";

import { notFound } from "next/navigation";
import { z } from "zod";
import { ru } from "@/i18n/ru";
import { action } from "@/platform/action";
import { env } from "@/platform/env";
import { fail } from "@/platform/errors";

const wait = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Действие-образец витрины (только dev): держит ответ 400 мс и всегда возвращает ошибку у поля `value` и в общем сообщении — имя нажатой кнопки отправки (`intent`) — на нём e2e
 * проверяет, что форма на `useActionForm` показывает ошибку, не теряет введённое и не отправляет дважды.
 */
export const sampleAction = action("uikit.sample", z.object({ value: z.string(), intent: z.string().optional() }), async ({ intent }) => {
  if (env().APP_ENV !== "dev") notFound();
  await wait(400);
  return fail.validation(ru.app.kit.showcase.formSample.received(intent), {
    fieldErrors: { value: [ru.app.kit.showcase.formSample.fieldError] },
  });
});

const masks = ru.app.kit.showcase.masks;

/**
 * Действие-образец полей с маской (только dev): показывает, что дошло до сервера (значения без разделителей), и всегда
 * отвечает ошибками у цены и почты — на нём видно фокус к первой ошибке и снятие ошибки правкой.
 */
export const maskSampleAction = action(
  "uikit.maskSample",
  z.object({
    phone: z.string(),
    price: z.string(),
    iin: z.string(),
    bin: z.string(),
    iban: z.string(),
    email: z.string(),
    instagram: z.string(),
  }),
  async (input) => {
    if (env().APP_ENV !== "dev") notFound();
    await wait(400);
    const values = Object.entries(input)
      .map(([key, value]) => `${key}=${value}`)
      .join(" ");
    return fail.validation(masks.received(values), {
      fieldErrors: { price: [masks.priceError], email: [masks.emailError] },
    });
  },
);

/** Действие-образец кода (только dev): всегда «код не подошёл» у поля; по нему видно, что код ушёл один раз. */
export const codeSampleAction = action("uikit.codeSample", z.object({ code: z.string() }), async () => {
  if (env().APP_ENV !== "dev") notFound();
  await wait(400);
  return fail.validation(masks.codeError, { fieldErrors: { code: [masks.codeError] } });
});
