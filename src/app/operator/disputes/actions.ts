"use server";

import { z } from "zod";
import { requireUser } from "@/modules/identity";
import { previewDisputeSplit, resolveDispute, resolveDisputeSchema, splitPreviewSchema } from "@/modules/operator";
import { action } from "@/platform/action";
import { formatTiyn } from "@/ui/format";

export const resolveDisputeAction = action("operator.resolveDispute", z.unknown().pipe(resolveDisputeSchema), async (input) => {
  const user = await requireUser("OPERATOR");
  await resolveDispute(user, input);
});

/** Расчёт раздела до решения: та же computeSplit, что и в решении; в клиент — готовые суммы. */
export const previewSplitAction = action("operator.previewDisputeSplit", z.unknown().pipe(splitPreviewSchema), async (input) => {
  const user = await requireUser("OPERATOR");
  const split = await previewDisputeSplit(user, input);
  return { master: formatTiyn(split.masterTiyn), platform: formatTiyn(split.platformTiyn), refund: formatTiyn(split.refundTiyn) };
});
