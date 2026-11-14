"use server";

import { z } from "zod";
import { PNG_DATA_URL } from "@/features/signing/hand-state";
import { ru } from "@/i18n/ru";
import { completeSigning, HAND_IMAGE_MAX_BYTES, signByHand, startSigning } from "@/modules/documents";
import { requireUser } from "@/modules/identity";
import { action } from "@/platform/action";
import { AppError, isAppError } from "@/platform/errors";

// Подпись оферты и акта приёмки покупателем (v2). Свои обёртки над теми же функциями модуля documents, что и в v1: схема
// zod, затем `requireUser("CLIENT")` первой строкой; что это документ сделки этого покупателя, что шаг сделки принимает
// подпись и что подписи ещё нет — проверяет модуль под блокировкой (чужой — NOT_FOUND, повтор — CONFLICT).
// Отказы модуля — тексты экрана (ru.app.deal.sign.errors); в модуле тексты v1.

const t = ru.app.deal.sign.errors;
const m = ru.documents.errors;

const documentId = z.string().trim().min(1).max(64);
/** base64 раздувает байты в 4/3 раза плюс префикс data URL; больше — рисунок не принимается до вызова модуля. */
const MAX_DATA_URL = Math.ceil((HAND_IMAGE_MAX_BYTES * 4) / 3) + 64;

/** Рисунок с холста (только PNG data URL ограниченного размера) или ФИО вводом. */
const handSchema = z.union([
  z.object({ documentId, imageDataUrl: z.string().max(MAX_DATA_URL, t.badImage).regex(PNG_DATA_URL, t.badImage) }),
  z.object({ documentId, typedName: z.string().trim().min(2, t.typedName).max(120, t.typedName) }),
]);

const startSchema = z.object({ documentId, method: z.enum(["EGOV_QR", "NCALAYER"]) });
const completeSchema = z.object({ documentId, sessionId: z.string().min(1).max(4000) });

/** Повтор подписи, которая уже есть (двойное нажатие, вторая вкладка): эффект один, ответ — тот же успех. */
const alreadySigned = (e: unknown): boolean => isAppError(e) && e.code === "CONFLICT" && e.message === m.alreadySignedByYou;

/** Отказ модуля → тот же код с текстом экрана. Не AppError и неизвестные — как есть (их разберёт `action()`). */
function retext(e: unknown): unknown {
  if (!isAppError(e)) return e;
  const byMessage: Readonly<Record<string, string>> = {
    [m.pending]: t.pending,
    [m.otherSigner]: t.otherSigner,
    [m.signerIinMissing]: t.iinMissing,
    [m.dealNotSignable]: t.changed,
    [m.alreadySigned]: t.changed,
    [m.handNotRequired]: t.changed,
    [m.superseded]: t.superseded,
    [m.badSignatureImage]: t.badImage,
    [m.typedNameLength]: t.typedName,
    [m.notFound]: t.notFound,
  };
  const known = byMessage[e.message];
  if (known) return new AppError(e.code, known);
  // «Подпись не принята: <причина провайдера>» и прочие отказы проверки подписи.
  if (e.code === "VALIDATION") return new AppError(e.code, t.rejected);
  if (e.code === "NOT_FOUND") return new AppError(e.code, t.notFound);
  if (e.code === "CONFLICT") return new AppError(e.code, t.changed);
  return e;
}

/**
 * Собственноручная подпись: рисунок с холста (PNG) или ФИО вводом. IP и устройство берёт модуль. Изображение в журнал не
 * пишется. Двойное нажатие — одна подпись: второй вызов получает от модуля «уже подписано» и отвечает тем же успехом.
 */
export const signByHandAction = action("deals.sign.hand", handSchema, async (input) => {
  const user = await requireUser("CLIENT");
  try {
    if ("imageDataUrl" in input) {
      const image = new Uint8Array(Buffer.from(input.imageDataUrl.slice(input.imageDataUrl.indexOf(",") + 1), "base64"));
      return await signByHand(user, { documentId: input.documentId, image });
    }
    return await signByHand(user, { documentId: input.documentId, typedName: input.typedName });
  } catch (e) {
    if (alreadySigned(e)) return { fullySigned: false };
    throw retext(e);
  }
});

/** Начать подпись ЭЦП: сессия у провайдера подписи (для eGov Mobile — QR картинкой). */
export const startSigningAction = action("deals.sign.start", startSchema, async (input) => {
  const user = await requireUser("CLIENT");
  try {
    const s = await startSigning(user, input.documentId, input.method);
    // Клиенту — только то, что нужно экрану (CMS и данные провайдера для NCALayer остаются у сервера).
    return { sessionId: s.sessionId, method: s.method, qrImage: s.qrImage, expiresAt: s.expiresAt, provider: s.provider };
  } catch (e) {
    throw retext(e);
  }
});

/**
 * Завершить подпись ЭЦП: модуль сам берёт подпись у провайдера и проверяет её против хэша документа и ИИН подписанта.
 * Двойное нажатие — одна подпись (повтор — тот же успех).
 */
export const completeSigningAction = action("deals.sign.complete", completeSchema, async (input) => {
  const user = await requireUser("CLIENT");
  try {
    return await completeSigning(user, input);
  } catch (e) {
    if (alreadySigned(e)) return { fullySigned: false };
    throw retext(e);
  }
});
