"use server";

import { ru } from "@/i18n/ru";
import { dealRefSchema, getDealView, startWork } from "@/modules/deal-core";
import { requireUser, type CurrentUser } from "@/modules/identity";
import { action } from "@/platform/action";
import { AppError, isAppError } from "@/platform/errors";

// «Начать работу» мастером (v2). Своя обёртка над той же функцией deal-core, что и в v1 (`startWorkAction`): схема zod,
// затем `requireUser("EXECUTOR")` первой строкой; сторону сделки, шаг (PAID_HOLD), спор и повтор проверяет модуль под
// блокировкой строки сделки — переход один.

const e = ru.app.masterSteps.start.errors;
const d = ru.deal.errors;

/** Повтор (двойное нажатие, вторая вкладка): работа уже начата — тот же успех, второго перехода нет. */
async function alreadyStarted(user: CurrentUser, dealId: string): Promise<boolean> {
  try {
    return (await getDealView(user, dealId)).dates.startedAt !== null;
  } catch {
    return false;
  }
}

/** Отказ модуля → тот же код с текстом экрана. */
function retext(err: unknown): unknown {
  if (!isAppError(err)) return err;
  const byMessage: Readonly<Record<string, string>> = { [d.disputeOpen]: e.dispute, [d.notAllowedNow]: e.changed, [d.notFound]: e.notFound, [d.notYourAction]: e.notFound };
  const known = byMessage[err.message];
  if (known) return new AppError(err.code, known);
  if (err.code === "NOT_FOUND") return new AppError(err.code, e.notFound);
  if (err.code === "CONFLICT") return new AppError(err.code, e.changed);
  return err;
}

/** Мастер начинает работу: PAID_HOLD → IN_PROGRESS, уведомление покупателю — в одной транзакции модуля. */
export const startWorkAction = action("deals.start", dealRefSchema, async (input) => {
  const user = await requireUser("EXECUTOR");
  try {
    await startWork(user, input);
  } catch (err) {
    if (isAppError(err) && err.code === "CONFLICT" && (await alreadyStarted(user, input.dealId))) return;
    throw retext(err);
  }
});
