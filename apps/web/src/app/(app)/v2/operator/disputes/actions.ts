"use server";

import { z } from "zod";
import { requireRecentMfa, requireUser } from "@/modules/identity";
import { previewDisputeSplit, resolveDispute, resolveDisputeSchema, splitPreviewSchema } from "@/modules/operator";
import { action } from "@/platform/action";

/**
 * Решение спора делит деньги сделки: только со свежим кодом из приложения (`requireRecentMfa` до модуля: иначе MFA_REQUIRED —
 * форма спросит код и повторит). Вход проверяет схема (итог из списка, сумма мастеру в тенге → тиыны, обоснование); права и
 * двойное решение — модуль (второе решение того же спора — CONFLICT).
 */
export const resolveDisputeAction = action("app.operator.resolveDispute", z.unknown().pipe(resolveDisputeSchema), async (input) => {
  const user = await requireUser("OPERATOR");
  requireRecentMfa(user);
  await resolveDispute(user, input);
});

/**
 * Расчёт раздела до решения — без кода (ничего не меняет): та же `computeSplit`, что и при решении. В клиент — тиыны
 * строками (число не теряет точность) и сумма мастеру из цены, для которой посчитано: форма сверяет её с полем.
 */
export const previewSplitAction = action("app.operator.previewDisputeSplit", z.unknown().pipe(splitPreviewSchema), async (input) => {
  const user = await requireUser("OPERATOR");
  const split = await previewDisputeSplit(user, input);
  return {
    shareTiyn: split.shareTiyn.toString(),
    masterTiyn: split.masterTiyn.toString(),
    platformTiyn: split.platformTiyn.toString(),
    refundTiyn: split.refundTiyn.toString(),
  };
});
