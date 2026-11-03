"use server";

import { z } from "zod";
import { requireUser } from "@/modules/identity";
import { kycReviewSchema, reviewKyc } from "@/modules/operator";
import { action } from "@/platform/action";

export const reviewKycAction = action("operator.reviewKyc", z.unknown().pipe(kycReviewSchema), async (input) => {
  const user = await requireUser("OPERATOR");
  await reviewKyc(user, input);
});
