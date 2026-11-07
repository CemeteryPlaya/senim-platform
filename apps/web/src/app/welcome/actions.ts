"use server";

import { redirect } from "next/navigation";
import { z } from "zod";
import { homePathFor, recordOwnIdentity, requireUser, safeReturnTo } from "@/modules/identity";
import { action } from "@/platform/action";

const schema = z.object({
  fullName: z.string().max(200),
  iin: z
    .string()
    .max(20)
    .transform((v) => v.replace(/\s/g, "")),
  next: z.string().max(512).nullable(),
});

/** Знакомство: ФИО и ИИН один раз (№26). Проверки, шифрование и лимит попыток — в identity.recordOwnIdentity. */
export const introduceAction = action("identity.introduce", schema, async ({ fullName, iin, next }) => {
  const user = await requireUser("CLIENT", "EXECUTOR");
  await recordOwnIdentity(user, { fullName, iin });
  redirect(safeReturnTo(next) ?? homePathFor(user));
});
