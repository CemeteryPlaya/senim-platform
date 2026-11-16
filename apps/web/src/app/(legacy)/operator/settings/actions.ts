"use server";

import { z } from "zod";
import { EXECUTOR_IDENTITY_MODES, setExecutorIdentityMode } from "@/modules/companies";
import { requireUser } from "@/modules/identity";
import { setPreContractFlow, setPreContractFlowSchema } from "@/modules/requests";
import { action } from "@/platform/action";

// Настройки площадки оператора. Свежий второй фактор (requireRecentMfa) и аудит проверяют модули companies и requests:
// без кода — MFA_REQUIRED, форма (useActionForm) спросит код и повторит действие.

/** Переключатель «имя исполнителя скрыто / показано» (ответ №6, ADR-006). */
export const setExecutorIdentityAction = action(
  "companies.setExecutorIdentity",
  // Форма оператора отдаёт поля строками (useActionForm) — разбираем как unknown.
  z.unknown().pipe(z.object({ mode: z.enum(EXECUTOR_IDENTITY_MODES) })),
  async (input) => {
    const user = await requireUser("OPERATOR");
    await setExecutorIdentityMode(user, input.mode);
  },
);

/** «Сценарий до договора» для новых заявок (ADR-005). */
export const setPreContractFlowAction = action(
  "requests.setPreContractFlow",
  // Форма оператора отдаёт поля строками (useActionForm) — разбираем как unknown.
  z.unknown().pipe(setPreContractFlowSchema),
  async (input) => {
    const user = await requireUser("OPERATOR");
    await setPreContractFlow(user, input);
  },
);
