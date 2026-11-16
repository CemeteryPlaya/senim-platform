"use server";

import { z } from "zod";
import { createReleaseReceipt } from "@/modules/documents";
import { requireUser } from "@/modules/identity";
import { action } from "@/platform/action";

/**
 * «Сформировать расписку» на раскрытие для банка: documents выпускает PDF по суммам раскрытия в журнале денег. Права —
 * оператор (`requireUser("OPERATOR")` первой строкой, дальше проверяет и сам модуль); повтор и двойной клик документ не
 * дублируют (идемпотентность — в documents). В клиент — только id документа.
 */
export const createReleaseReceiptAction = action(
  "app.operator.createReleaseReceipt",
  z.unknown().pipe(z.object({ dealId: z.string().min(1).max(64) })),
  async ({ dealId }) => {
    const user = await requireUser("OPERATOR");
    const document = await createReleaseReceipt(user, dealId);
    return { documentId: document.documentId };
  },
);
