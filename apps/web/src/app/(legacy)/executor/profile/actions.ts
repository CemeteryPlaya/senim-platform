"use server";

import { profileInputSchema, updateProfile } from "@/modules/companies";
import { requireUser } from "@/modules/identity";
import { action } from "@/platform/action";

/** Профиль меняет только сам исполнитель (свой профиль берётся из сессии, id в запросе нет — IDOR невозможен). */
export const saveProfile = action("companies.updateProfile", profileInputSchema, async (input) => {
  const user = await requireUser("EXECUTOR");
  return updateProfile(user, input);
});
