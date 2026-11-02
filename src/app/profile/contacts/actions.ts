"use server";

import { contactsInputSchema, requireUser, updateContacts } from "@/modules/identity";
import { action } from "@/platform/action";

/** Instagram своего профиля: пользователь берётся из сессии, id в запросе нет. */
export const saveContacts = action("identity.updateContacts", contactsInputSchema, async (input) => {
  const user = await requireUser("CLIENT", "EXECUTOR");
  return updateContacts(user, { instagram: input.instagram ?? "" });
});
