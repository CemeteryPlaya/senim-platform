"use server";

import { redirect } from "next/navigation";
import { z } from "zod";
import { endSession, requireUser } from "@/modules/identity";
import { paymentRailSchema, resetDemoData, setPaymentRail } from "@/modules/operator";
import { action } from "@/platform/action";

export const setPaymentRailAction = action("operator.setPaymentRail", z.unknown().pipe(paymentRailSchema), async (input) => {
  const user = await requireUser("OPERATOR");
  await setPaymentRail(user, input);
});

/**
 * Сброс очищает и таблицу сессий: оператор тоже выходит. Удаляем его cookie и ведём
 * на выбор демо-персоны (модалка предупреждает об этом заранее).
 */
export const resetDemoAction = action("operator.resetDemo", z.object({}), async () => {
  const user = await requireUser("OPERATOR");
  await resetDemoData(user);
  await endSession();
  redirect("/demo");
});
