"use server";

import { updateProfile } from "@/modules/companies";
import { requireUser } from "@/modules/identity";
import { action } from "@/platform/action";
import { companySchema } from "./_parts/company-schema";
import { companyFailure } from "./_parts/errors";

/**
 * Компания своего профиля. Схема — правила модуля с текстами v2 (`company-schema.ts`), затем `requireUser` и модуль:
 * профиль берётся из сессии, id в запросе нет — чужой профиль не задать. «О себе» проходит маску модуля; ответ — сохранённый
 * текст и признак «что-то убрано». Повтор того же сохранения безопасен: значения те же.
 */
export const saveCompanyAction = action("app.executor.saveCompany", companySchema, async (input) => {
  const user = await requireUser("EXECUTOR");
  try {
    return await updateProfile(user, input);
  } catch (e) {
    throw companyFailure(e);
  }
});
