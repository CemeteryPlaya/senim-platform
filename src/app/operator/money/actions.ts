"use server";

import { z } from "zod";
import { ru } from "@/i18n/ru";
import { requireUser } from "@/modules/identity";
import { bankConfirmFieldsSchema, bankFailSchema, confirmBankOperation, failBankOperation, saveBankDocument } from "@/modules/operator";
import { action } from "@/platform/action";

const scan = z.instanceof(Blob, { message: ru.payments.validation.bankDocFile });

/**
 * «Деньги поступили на счёт в банке» и другие кнопки manual: номер, дата и скан банковского документа.
 * Скан сохраняется до подтверждения; двойной клик даёт CONFLICT в payments (только из PENDING).
 */
export const confirmBankOperationAction = action("operator.confirmBankOperation", z.unknown().pipe(bankConfirmFieldsSchema.extend({ scan })), async ({ scan: file, ...input }) => {
  const user = await requireUser("OPERATOR");
  const bankDocFileId = await saveBankDocument(user, new Uint8Array(await file.arrayBuffer()));
  await confirmBankOperation(user, { ...input, bankDocFileId });
});

export const failBankOperationAction = action("operator.failBankOperation", z.unknown().pipe(bankFailSchema), async (input) => {
  const user = await requireUser("OPERATOR");
  await failBankOperation(user, input);
});
