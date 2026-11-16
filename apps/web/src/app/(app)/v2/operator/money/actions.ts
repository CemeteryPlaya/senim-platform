"use server";

import { z } from "zod";
import { ru } from "@/i18n/ru";
import { requireRecentMfa, requireUser } from "@/modules/identity";
import { bankConfirmFieldsSchema, bankFailSchema, confirmBankOperationWithScan, failBankOperation, retryBankOperation } from "@/modules/operator";
import { retryOperationSchema } from "@/modules/payments";
import { action } from "@/platform/action";

const t = ru.app.operatorQueues.money;

/**
 * Скан документа банка — файл из формы (`Blob`). Пустой файл (поле не выбрано, браузер прислал пустую запись) — та же
 * ошибка у поля, что и отсутствие файла. Тип (PDF, JPEG, PNG), размер и очистку метаданных проверяет files
 * (`PURPOSE_POLICY.BANK_DOCUMENT`).
 */
const scan = z.instanceof(Blob, { message: t.scanRequired }).refine((file) => file.size > 0, t.scanRequired);

/**
 * «Деньги поступили на счёт в банке» и другие подтверждения manual: номер, дата и скан документа банка. Действие с
 * деньгами — только со свежим кодом из приложения: `requireRecentMfa` до сохранения скана и до payments (иначе
 * MFA_REQUIRED — форма спросит код и повторит). Двойное подтверждение даёт CONFLICT в payments (только из PENDING).
 */
export const confirmBankOperationAction = action(
  "app.operator.confirmBankOperation",
  z.unknown().pipe(bankConfirmFieldsSchema.extend({ scan })),
  async ({ scan: file, ...input }) => {
    const user = await requireUser("OPERATOR");
    requireRecentMfa(user);
    await confirmBankOperationWithScan(user, { ...input, scan: new Uint8Array(await file.arrayBuffer()) });
  },
);

/** «Банк отклонил операцию»: причина обязательна (до 500 символов), её увидят стороны сделки; свежий код. */
export const failBankOperationAction = action("app.operator.failBankOperation", z.unknown().pipe(bankFailSchema), async (input) => {
  const user = await requireUser("OPERATOR");
  requireRecentMfa(user);
  await failBankOperation(user, input);
});

/** «Повторить операцию» после отказа банка: новая попытка; двойное нажатие второй попытки не создаёт (payments). */
export const retryBankOperationAction = action("app.operator.retryBankOperation", z.unknown().pipe(retryOperationSchema), async (input) => {
  const user = await requireUser("OPERATOR");
  requireRecentMfa(user);
  await retryBankOperation(user, input);
});
