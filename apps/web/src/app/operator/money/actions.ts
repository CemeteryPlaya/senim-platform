"use server";

import { z } from "zod";
import { ru } from "@/i18n/ru";
import { requireRecentMfa, requireUser } from "@/modules/identity";
import { bankConfirmFieldsSchema, bankFailSchema, confirmBankOperation, failBankOperation, retryBankOperation, saveBankDocument } from "@/modules/operator";
import { retryOperationSchema } from "@/modules/payments";
import { action } from "@/platform/action";

const scan = z.instanceof(Blob, { message: ru.payments.validation.bankDocFile });

/**
 * «Деньги поступили на счёт в банке» и другие кнопки manual: номер, дата и скан банковского документа.
 * Скан сохраняется до подтверждения; двойной клик даёт CONFLICT в payments (только из PENDING).
 * Действия с деньгами — только со свежим кодом из приложения (requireRecentMfa): иначе MFA_REQUIRED до скана и до payments.
 */
export const confirmBankOperationAction = action("operator.confirmBankOperation", z.unknown().pipe(bankConfirmFieldsSchema.extend({ scan })), async ({ scan: file, ...input }) => {
  const user = await requireUser("OPERATOR");
  requireRecentMfa(user);
  const bankDocFileId = await saveBankDocument(user, new Uint8Array(await file.arrayBuffer()));
  await confirmBankOperation(user, { ...input, bankDocFileId });
});

export const failBankOperationAction = action("operator.failBankOperation", z.unknown().pipe(bankFailSchema), async (input) => {
  const user = await requireUser("OPERATOR");
  requireRecentMfa(user);
  await failBankOperation(user, input);
});

/** «Повторить операцию» после отказа банка: новая попытка; двойной клик второй попытки не создаёт. */
export const retryBankOperationAction = action("operator.retryBankOperation", z.unknown().pipe(retryOperationSchema), async (input) => {
  const user = await requireUser("OPERATOR");
  requireRecentMfa(user);
  await retryBankOperation(user, input);
});
