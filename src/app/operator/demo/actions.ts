"use server";

import { redirect } from "next/navigation";
import { z } from "zod";
import { endSession, requireUser } from "@/modules/identity";
import { resetDemoData } from "@/modules/operator";
import { action } from "@/platform/action";

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
