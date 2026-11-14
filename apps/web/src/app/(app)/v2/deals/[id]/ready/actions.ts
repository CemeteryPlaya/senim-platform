"use server";

import { z } from "zod";
import { ru } from "@/i18n/ru";
import { getDealView, submitReady, type ReadyResult } from "@/modules/deal-core";
import { requireUser, type CurrentUser } from "@/modules/identity";
import { action } from "@/platform/action";
import { AppError, isAppError } from "@/platform/errors";

// «Сдать работу» мастером (v2). Своя обёртка над той же функцией deal-core, что и в v1 (`submitReadyAction`): схема zod с
// текстами экрана, затем `requireUser("EXECUTOR")` первой строкой. Фото обязательны (1–12, свои, назначение DELIVERY);
// координаты — пара или ничего (геолокации могло не быть): сдача без места разрешена. Мягкую проверку расстояния до адреса
// заказа, переход IN_PROGRESS → READY, акт приёмки и уведомление покупателю делает модуль в одной транзакции под
// блокировкой строки сделки — переход один.

const t = ru.app.masterSteps.ready;
const e = t.errors;
const d = ru.deal.errors;
const ref = z.string().trim().min(1).max(64);

const readySchema = z
  .object({
    dealId: ref,
    photoIds: z.array(ref).min(1, e.photos).max(12, t.photos.rejectLimit(12)),
    lat: z.number().min(-90).max(90).optional(),
    lng: z.number().min(-180).max(180).optional(),
    accuracyM: z.number().int().min(0).optional(),
  })
  .refine((x) => (x.lat === undefined) === (x.lng === undefined), { message: e.coords, path: ["lat"] });

export type ReadyOutcome = Pick<ReadyResult, "distanceM" | "withinRadius" | "radiusM">;

/** Повтор (двойное нажатие, вторая вкладка): работа уже сдана — тот же итог проверки из сделки, второй сдачи нет. */
async function alreadyReady(user: CurrentUser, dealId: string): Promise<ReadyOutcome | null> {
  try {
    const ready = (await getDealView(user, dealId)).ready;
    return ready ? { distanceM: ready.distanceM, withinRadius: ready.withinRadius, radiusM: ready.radiusM } : null;
  } catch {
    return null;
  }
}

function retext(err: unknown): unknown {
  if (!isAppError(err)) return err;
  const byMessage: Readonly<Record<string, string>> = { [d.disputeOpen]: e.dispute, [d.notAllowedNow]: e.changed, [d.notFound]: e.notFound, [d.notYourAction]: e.notFound };
  const known = byMessage[err.message];
  if (known) return new AppError(err.code, known);
  if (err.code === "NOT_FOUND") return new AppError(err.code, e.notFound);
  if (err.code === "CONFLICT") return new AppError(err.code, e.changed);
  return err;
}

/** Сдача: ответ — итог мягкой проверки места (расстояние и «в радиусе»; без координат — `null`). */
export const submitReadyAction = action("deals.ready", readySchema, async (input): Promise<ReadyOutcome> => {
  const user = await requireUser("EXECUTOR");
  try {
    const r = await submitReady(user, input);
    return { distanceM: r.distanceM, withinRadius: r.withinRadius, radiusM: r.radiusM };
  } catch (err) {
    if (isAppError(err) && err.code === "CONFLICT") {
      const again = await alreadyReady(user, input.dealId);
      if (again) return again;
    }
    throw retext(err);
  }
});
