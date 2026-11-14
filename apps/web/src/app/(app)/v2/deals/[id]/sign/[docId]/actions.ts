"use server";

import { z } from "zod";
import { PNG_DATA_URL } from "@/features/signing/hand-state";
import { ru } from "@/i18n/ru";
import { bankConsentState, giveBankConsent } from "@/modules/deal-core";
import { completeSigning, HAND_IMAGE_MAX_BYTES, readDealDocuments, signByHand, startSigning } from "@/modules/documents";
import { CONSENT_VERSION_CHANGED, requireUser, type CurrentUser } from "@/modules/identity";
import { action } from "@/platform/action";
import { AppError, isAppError } from "@/platform/errors";

// Подпись оферты и акта приёмки стороной сделки (v2): покупатель и мастер. Свои обёртки над теми же функциями модуля
// documents, что и в v1: схема zod, затем `requireUser("CLIENT", "EXECUTOR")` первой строкой; что это документ сделки этого
// человека в его активной роли, что шаг сделки принимает подпись и что подписи ещё нет — проверяет модуль под блокировкой
// (чужой — NOT_FOUND, повтор — CONFLICT). Отказы модуля — тексты экрана (ru.app.deal.sign.errors); в модуле тексты v1.
//
// Замок согласия для банка (как в v1, в интерфейсе — модуль подпись без отметки не запрещает): мастер подписывает оферту
// только после своего согласия на передачу данных банку. Отметка приходит вместе с подписью (`agreed: "on"` и редакция
// показанного текста) и сохраняется до неё (`giveBankConsent`, повтор — та же запись); без отметки и без данного раньше
// согласия — отказ у отметки, подписи нет.

const t = ru.app.deal.sign.errors;
const tc = ru.app.masterSteps.sign.consent;
const m = ru.documents.errors;

const documentId = z.string().trim().min(1).max(64);
const dealId = z.string().trim().min(1).max(64);
/** Отметка согласия для банка (мастер, оферта): `on` и редакция текста, который человек видел. */
const consent = { agreed: z.literal("on").optional(), version: z.string().max(32).optional() };
/** base64 раздувает байты в 4/3 раза плюс префикс data URL; больше — рисунок не принимается до вызова модуля. */
const MAX_DATA_URL = Math.ceil((HAND_IMAGE_MAX_BYTES * 4) / 3) + 64;

/** Рисунок с холста (только PNG data URL ограниченного размера) или ФИО вводом. */
const handSchema = z.union([
  z.object({ dealId, documentId, ...consent, imageDataUrl: z.string().max(MAX_DATA_URL, t.badImage).regex(PNG_DATA_URL, t.badImage) }),
  z.object({ dealId, documentId, ...consent, typedName: z.string().trim().min(2, t.typedName).max(120, t.typedName) }),
]);

const startSchema = z.object({ dealId, documentId, ...consent, method: z.enum(["EGOV_QR", "NCALAYER"]) });
const completeSchema = z.object({ dealId, documentId, sessionId: z.string().min(1).max(4000) });
const consentSchema = z.object({ dealId, agreed: z.literal("on", { error: tc.missing }), version: z.string().max(32) });

type ConsentInput = { dealId: string; documentId: string; agreed?: "on" | undefined; version?: string | undefined };

/** Нет своего согласия для банка: отказ у отметки (`agreed`), подпись не идёт. */
const consentMissing = () => new AppError("VALIDATION", tc.missing, { fieldErrors: { agreed: [tc.missing] } });

/**
 * Замок согласия для банка перед подписью оферты мастером. Покупателя не касается (его согласие — перед оплатой). Документ
 * должен быть среди документов этой сделки (иначе «не найден»: чужая сделка с данным согласием не открывает чужую
 * оферту). Отметки читаются, пока сделка CREATED (`bankConsentState`, иначе `null` — шаг сделки рассудит модуль). Своего
 * согласия нет: с отметкой (`give`) — сохранить его до подписи; без — отказ.
 */
async function bankLock(user: CurrentUser, input: ConsentInput, give: boolean): Promise<void> {
  if (user.role !== "EXECUTOR") return;
  const doc = (await readDealDocuments(user, input.dealId)).find((d) => d.id === input.documentId);
  if (!doc) throw new AppError("NOT_FOUND", t.notFound);
  if (doc.kind !== "CONTRACT") return;
  const bank = await bankConsentState(user, input.dealId);
  if (!bank || bank.mine) return;
  if (!give || input.agreed !== "on") throw consentMissing();
  await giveBankConsent(user, { dealId: input.dealId, version: input.version ?? "" });
}

/**
 * Повтор подписи, которая уже есть (двойное нажатие, вторая вкладка): эффект один, ответ — тот же успех. «Подписан всеми
 * сторонами» — тоже успех: параллельный вызов последнего подписанта уже довёл документ до SIGNED, значит, и эта подпись
 * покупателя есть.
 */
function repeated(e: unknown): { fullySigned: boolean } | null {
  if (!isAppError(e) || e.code !== "CONFLICT") return null;
  if (e.message === m.alreadySignedByYou) return { fullySigned: false };
  if (e.message === m.alreadySigned) return { fullySigned: true };
  return null;
}

/** Отказ модуля → тот же код с текстом экрана. Не AppError и неизвестные — как есть (их разберёт `action()`). */
function retext(e: unknown): unknown {
  if (!isAppError(e)) return e;
  // Отказ замка согласия — уже текст экрана с ошибкой у отметки.
  if (e.message === tc.missing) return e;
  if (e.details?.reason === CONSENT_VERSION_CHANGED) return new AppError(e.code, tc.changed);
  const byMessage: Readonly<Record<string, string>> = {
    [m.pending]: t.pending,
    [m.otherSigner]: t.otherSigner,
    [m.signerIinMissing]: t.iinMissing,
    [m.dealNotSignable]: t.changed,
    [m.handNotRequired]: t.changed,
    [m.superseded]: t.superseded,
    [m.badSignatureImage]: t.badImage,
    [m.typedNameLength]: t.typedName,
    [m.notFound]: t.notFound,
    [m.ncalayerUnavailable]: t.ncalayer,
  };
  const known = byMessage[e.message];
  if (known) return new AppError(e.code, known);
  // «Подпись не принята: <причина провайдера>» и прочие отказы проверки подписи.
  if (e.code === "VALIDATION") return new AppError(e.code, t.rejected);
  if (e.code === "UNAVAILABLE") return new AppError(e.code, t.unavailable);
  if (e.code === "NOT_FOUND") return new AppError(e.code, t.notFound);
  if (e.code === "CONFLICT") return new AppError(e.code, t.changed);
  return e;
}

/**
 * Собственноручная подпись: рисунок с холста (PNG) или ФИО вводом. IP и устройство берёт модуль. Изображение в журнал не
 * пишется. Двойное нажатие — одна подпись: второй вызов получает от модуля «уже подписано» и отвечает тем же успехом.
 */
export const signByHandAction = action("deals.sign.hand", handSchema, async (input) => {
  const user = await requireUser("CLIENT", "EXECUTOR");
  try {
    await bankLock(user, input, true);
    if ("imageDataUrl" in input) {
      const image = new Uint8Array(Buffer.from(input.imageDataUrl.slice(input.imageDataUrl.indexOf(",") + 1), "base64"));
      return await signByHand(user, { documentId: input.documentId, image });
    }
    return await signByHand(user, { documentId: input.documentId, typedName: input.typedName });
  } catch (e) {
    const again = repeated(e);
    if (again) return again;
    throw retext(e);
  }
});

/** Начать подпись ЭЦП: сессия у провайдера подписи (для eGov Mobile — QR картинкой). */
export const startSigningAction = action("deals.sign.start", startSchema, async (input) => {
  const user = await requireUser("CLIENT", "EXECUTOR");
  try {
    await bankLock(user, input, true);
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
  const user = await requireUser("CLIENT", "EXECUTOR");
  try {
    await bankLock(user, input, false);
    return await completeSigning(user, { documentId: input.documentId, sessionId: input.sessionId });
  } catch (e) {
    const again = repeated(e);
    if (again) return again;
    throw retext(e);
  }
});

/**
 * Согласие мастера для банка без подписи: оферта уже подписана, а своей отметки нет (Ruling 7) — банк иначе не примет
 * оплату. Только мастер (покупатель даёт согласие на экране оплаты); сделка CREATED, чужая — «не найдено» (модуль).
 * Повтор — та же запись в identity.
 */
export const giveBankConsentAction = action("deals.sign.consent", consentSchema, async (input) => {
  const user = await requireUser("EXECUTOR");
  try {
    await giveBankConsent(user, { dealId: input.dealId, version: input.version });
  } catch (e) {
    throw retext(e);
  }
});
