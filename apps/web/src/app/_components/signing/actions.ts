"use server";

import { z } from "zod";
import { ru } from "@/i18n/ru";
import { completeSigning, createReleaseReceipt, HAND_IMAGE_MAX_BYTES, shareDocument, signByHand, startSigning } from "@/modules/documents";
import { requireUser } from "@/modules/identity";
import { action } from "@/platform/action";
import { PNG_DATA_URL } from "./hand-state";

const documentId = z.string().min(1).max(64);
/** base64 раздувает байты в 4/3 раза плюс префикс data URL. */
const MAX_DATA_URL = Math.ceil((HAND_IMAGE_MAX_BYTES * 4) / 3) + 64;

/** Начать подпись ЭЦП стороной сделки: сессия у провайдера, для eGov Mobile — QR. */
export const startSigningAction = action(
  "documents.startSigning",
  z.object({ documentId, method: z.enum(["EGOV_QR", "NCALAYER"]) }),
  async (input) => {
    const user = await requireUser("CLIENT", "EXECUTOR");
    return startSigning(user, input.documentId, input.method);
  },
);

/**
 * Завершить подпись ЭЦП: сервер сам проверяет CMS, хэш и ИИН подписанта. Когда есть все требуемые подписи,
 * documents в той же транзакции зовёт deal-core.onDocumentSigned (оферта заключена / акт → выплата).
 */
export const completeSigningAction = action(
  "documents.completeSigning",
  z.object({ documentId, sessionId: z.string().min(1).max(4000) }),
  async (input) => {
    const user = await requireUser("CLIENT", "EXECUTOR");
    return completeSigning(user, input);
  },
);

const handSchema = z.union([
  z.object({ documentId, imageDataUrl: z.string().max(MAX_DATA_URL, ru.documents.errors.badSignatureImage).regex(PNG_DATA_URL, ru.documents.errors.badSignatureImage) }),
  z.object({ documentId, typedName: z.string().trim().min(2, ru.documents.errors.typedNameLength).max(120, ru.documents.errors.typedNameLength) }),
]);

/** Собственноручная подпись: рисунок с холста (PNG) или напечатанное имя. IP и устройство берёт сервер. */
export const signByHandAction = action("documents.signByHand", handSchema, async (input) => {
  const user = await requireUser("CLIENT", "EXECUTOR");
  if ("imageDataUrl" in input) {
    const image = new Uint8Array(Buffer.from(input.imageDataUrl.slice(input.imageDataUrl.indexOf(",") + 1), "base64"));
    return signByHand(user, { documentId: input.documentId, image });
  }
  return signByHand(user, { documentId: input.documentId, typedName: input.typedName });
});

/** Подписанная ссылка на документ для «Поделиться в WhatsApp»: стороны сделки и оператор. */
export const shareDocumentAction = action("documents.share", z.object({ documentId }), async (input) => {
  const user = await requireUser();
  return shareDocument(user, input.documentId);
});

/** Оператор: расписка на раскрытие для банка (manual). Возвращает документ; PDF — /api/documents/<id>/pdf. */
export const createReleaseReceiptAction = action("documents.createReleaseReceipt", z.object({ dealId: z.string().min(1).max(64) }), async (input) => {
  const user = await requireUser("OPERATOR");
  return createReleaseReceipt(user, input.dealId);
});
