"use server";

import { redirect } from "next/navigation";
import { z } from "zod";
import { endSession, requireUser } from "@/modules/identity";
import { resetDemoData } from "@/modules/operator";
import { action } from "@/platform/action";
import { logger } from "@/platform/logger";

/**
 * Сброс завершает в identity все сессии (ResetDemo): оператор тоже выходит. Удаляем его cookie и ведём
 * на выбор демо-персоны (модалка предупреждает об этом заранее). Сессия уже завершена сбросом, поэтому
 * сбой SignOut после успешного сброса — не ошибка: cookie удаляется в любом случае.
 */
export const resetDemoAction = action("operator.resetDemo", z.object({}), async () => {
  const user = await requireUser("OPERATOR");
  await resetDemoData(user);
  await endSession().catch((e: unknown) => logger.warn("operator.reset_demo.sign_out_failed", { error: e }));
  redirect("/demo");
});
