"use server";

import { redirect } from "next/navigation";
import { z } from "zod";
import { homePathFor, loginAsDemoPersona, safeReturnTo } from "@/modules/identity";
import { action } from "@/platform/action";
import { clientInfo } from "../_components/auth/client-info";

/**
 * Вход демо-персоной. Гостевое действие: requireUser не нужен — loginAsDemoPersona сам
 * проверяет DEMO_MODE и isDemo и создаёт сессию на сервере (id из формы — только ключ поиска).
 * next — внутренний адрес, куда перейти после входа (шаг показа банку); иначе — главная роли.
 */
export const loginAsPersonaAction = action("identity.demoLogin", z.object({ userId: z.string().min(1).max(64), next: z.string().max(512).optional() }), async ({ userId, next }) => {
  const { userAgent } = await clientInfo();
  const persona = await loginAsDemoPersona(userId, userAgent);
  redirect(safeReturnTo(next) ?? homePathFor(persona));
});
