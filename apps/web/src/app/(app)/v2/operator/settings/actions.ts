"use server";

import { z } from "zod";
import { EXECUTOR_IDENTITY_MODES, setExecutorIdentityMode } from "@/modules/companies";
import { requireRecentMfa, requireUser } from "@/modules/identity";
import { setPreContractFlow, setPreContractFlowSchema } from "@/modules/requests";
import { action } from "@/platform/action";
import { isEnabled } from "@/platform/features";
import { fail } from "@/platform/errors";

// Настройки площадки меняют то, что видят все: роль оператора — первой строкой, затем свежий код из приложения
// (`requireRecentMfa`: иначе MFA_REQUIRED — форма спросит код и повторит), затем модуль (он проверяет их ещё раз и пишет
// изменение в журнал аудита).

/** Режим «имя исполнителя скрыто / показано» (ADR-006). */
export const setExecutorIdentityAction = action(
  "app.operator.setExecutorIdentity",
  z.unknown().pipe(z.strictObject({ mode: z.enum(EXECUTOR_IDENTITY_MODES) })),
  async (input) => {
    const user = await requireUser("OPERATOR");
    requireRecentMfa(user);
    await setExecutorIdentityMode(user, input.mode);
  },
);

/** «Сценарий до договора» для новых заявок (ADR-005): только при включённом флаге `preContractFlows`, как в v1. */
export const setPreContractFlowAction = action("app.operator.setPreContractFlow", z.unknown().pipe(setPreContractFlowSchema), async (input) => {
  const user = await requireUser("OPERATOR");
  if (!isEnabled("preContractFlows")) fail.forbidden();
  requireRecentMfa(user);
  await setPreContractFlow(user, input);
});
