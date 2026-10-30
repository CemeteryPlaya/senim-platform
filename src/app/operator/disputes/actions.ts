"use server";

import { z } from "zod";
import { requireUser } from "@/modules/identity";
import { resolveDispute, resolveDisputeSchema } from "@/modules/operator";
import { action } from "@/platform/action";

export const resolveDisputeAction = action("operator.resolveDispute", z.unknown().pipe(resolveDisputeSchema), async (input) => {
  const user = await requireUser("OPERATOR");
  await resolveDispute(user, input);
});
