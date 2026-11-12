"use server";

import { z } from "zod";
import { EXECUTOR_IDENTITY_MODES, setExecutorIdentityMode } from "@/modules/companies";
import { requireUser } from "@/modules/identity";
import { action } from "@/platform/action";

/** Переключатель «имя исполнителя скрыто / показано» (ответ №6). DEMO_MODE и аудит проверяет companies. */
export const setExecutorIdentityAction = action(
  "companies.setExecutorIdentity",
  // Форма оператора отдаёт поля строками (useActionForm) — разбираем как unknown.
  z.unknown().pipe(z.object({ mode: z.enum(EXECUTOR_IDENTITY_MODES) })),
  async (input) => {
    const user = await requireUser("OPERATOR");
    await setExecutorIdentityMode(user, input.mode);
  },
);
