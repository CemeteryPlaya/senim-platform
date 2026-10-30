"use server";

import { redirect } from "next/navigation";
import { z } from "zod";
import { homePathFor, loginAsDemoPersona } from "@/modules/identity";
import { action } from "@/platform/action";
import { clientInfo } from "../_components/auth/client-info";

/**
 * Вход демо-персоной. Гостевое действие: requireUser не нужен — loginAsDemoPersona сам
 * проверяет DEMO_MODE и isDemo и создаёт сессию на сервере (id из формы — только ключ поиска).
 */
export const loginAsPersonaAction = action("identity.demoLogin", z.object({ userId: z.string().min(1).max(64) }), async ({ userId }) => {
  const { userAgent } = await clientInfo();
  const persona = await loginAsDemoPersona(userId, userAgent);
  redirect(homePathFor(persona));
});
