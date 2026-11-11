"use server";

import { z } from "zod";
import { requireUser, resolveConsentRevocation, revocationDecisionSchema } from "@/modules/identity";
import { action } from "@/platform/action";

/** Решение оператора по заявке на отзыв согласия: исполнить или отказать с причиной (3–500 символов). */
export const resolveRevocationAction = action("operator.resolveConsentRevocation", z.unknown().pipe(revocationDecisionSchema), async (input) => {
  const user = await requireUser("OPERATOR");
  await resolveConsentRevocation(user, input);
});
