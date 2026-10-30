"use server";

import { redirect } from "next/navigation";
import { EXECUTOR_REGISTRATION_PATH, executorRegistrationSchema, registerExecutor, requireUser } from "@/modules/identity";
import { action } from "@/platform/action";

export const registerExecutorAction = action("identity.registerExecutor", executorRegistrationSchema, async (input) => {
  const user = await requireUser("CLIENT", "EXECUTOR");
  await registerExecutor(user, input);
  // Та же страница покажет «Ожидаем подтверждения оператором».
  redirect(EXECUTOR_REGISTRATION_PATH);
});
