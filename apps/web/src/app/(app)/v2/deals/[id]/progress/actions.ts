"use server";

import { z } from "zod";
import { ru } from "@/i18n/ru";
import { addProgressReport } from "@/modules/deal-core";
import { requireUser } from "@/modules/identity";
import { action } from "@/platform/action";
import { AppError, isAppError } from "@/platform/errors";

// Отчёт о ходе работ мастера (v2). Своя обёртка над той же функцией deal-core, что и в v1 (`progressReportAction`): схема
// zod с текстами экрана, затем `requireUser("EXECUTOR")` первой строкой; сторону сделки, шаг (идут работы) и фото (свои,
// назначение PROGRESS_REPORT) проверяет модуль. `clientKey` — ключ повтора формы: повтор после обрыва связи отдаёт тот же
// отчёт (модуль), двойное нажатие к тому же гасит форма.

const e = ru.app.masterSteps.progress.errors;
const d = ru.deal.errors;
const ref = z.string().trim().min(1).max(64);

const reportSchema = z.object({
  dealId: ref,
  title: z.string().trim().max(120, e.title).default(""),
  text: z.string().trim().min(2, e.text).max(2000, e.text),
  photoIds: z.array(ref).max(12, ru.app.masterSteps.progress.photos.rejectLimit(12)).default([]),
  clientKey: z.uuid().optional(),
});

function retext(err: unknown): unknown {
  if (!isAppError(err)) return err;
  if (err.message === d.progressNotNow) return new AppError(err.code, e.notNow);
  if (err.code === "NOT_FOUND" || err.message === d.notYourAction) return new AppError(err.code, e.notFound);
  return err;
}

/** Отчёт: заголовок (по желанию), текст, фото — в ленте сделки; покупатель получает уведомление. */
export const progressReportAction = action("deals.progress", reportSchema, async (input) => {
  const user = await requireUser("EXECUTOR");
  try {
    return await addProgressReport(user, input);
  } catch (err) {
    throw retext(err);
  }
});
