"use server";

import { z } from "zod";
import { onDocumentSigned } from "@/modules/deal-core";
import { completeSigning, startSigning } from "@/modules/documents";
import { requireUser } from "@/modules/identity";
import { action } from "@/platform/action";

const documentId = z.string().min(1).max(64);

/** Начать подпись договора или акта стороной сделки: сессия у провайдера, для eGov Mobile — QR. */
export const startSigningAction = action(
  "documents.startSigning",
  z.object({ documentId, method: z.enum(["EGOV_QR", "NCALAYER"]) }),
  async (input) => {
    const user = await requireUser("CLIENT", "EXECUTOR");
    return startSigning(user, input.documentId, input.method);
  },
);

/**
 * Завершить подпись: сервер сам проверяет CMS и хэш. Когда подписали обе стороны —
 * deal-core.onDocumentSigned в той же транзакции (договор → сделка в работу, акт → этап может закрыться).
 */
export const completeSigningAction = action(
  "documents.completeSigning",
  z.object({ documentId, sessionId: z.string().min(1).max(4000) }),
  async (input) => {
    const user = await requireUser("CLIENT", "EXECUTOR");
    return completeSigning(user, input, { onFullySigned: onDocumentSigned });
  },
);
