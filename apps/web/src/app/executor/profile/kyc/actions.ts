"use server";

import { kycSubmitSchema, requireUser, submitKycDocuments } from "@/modules/identity";
import { action } from "@/platform/action";

/** Отправить документы на проверку: свой профиль из сессии; файлы — свои загруженные (проверяет web), статус — identity. */
export const submitKyc = action("identity.submitKycDocuments", kycSubmitSchema, async (input) => {
  const user = await requireUser("EXECUTOR");
  await submitKycDocuments(user, input);
});
