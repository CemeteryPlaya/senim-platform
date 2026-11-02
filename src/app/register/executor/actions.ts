"use server";

import { redirect } from "next/navigation";
import { EXECUTOR_REGISTRATION_PATH, executorRegistrationSchema, registerExecutor, requireUser, switchRole } from "@/modules/identity";
import { action } from "@/platform/action";

export const registerExecutorAction = action("identity.registerExecutor", executorRegistrationSchema, async (input) => {
  const user = await requireUser("CLIENT", "EXECUTOR");
  await registerExecutor(user, input);
  // Роль исполнителя добавлена к выданным (ADR-004): дальше человек действует как исполнитель.
  await switchRole(user, "EXECUTOR");
  // Та же страница покажет «Ожидаем подтверждения оператором».
  redirect(EXECUTOR_REGISTRATION_PATH);
});
