import { randomUUID } from "node:crypto";
import type { FilePurpose } from "@/generated/prisma/enums";
import type { StoredFile } from "@/generated/prisma/client";
import { ru } from "@/i18n/ru";
import type { CurrentUser } from "@/modules/identity";
import { sha256Hex } from "@/platform/crypto";
import { db, isUniqueViolation, Prisma, type Db } from "@/platform/db";
import { expectOneUpdated, fail } from "@/platform/errors";
import { logger } from "@/platform/logger";
import { enforceRateLimit } from "@/platform/rate-limit";
import { processImage, processPng, sniffType } from "./image";
import { declaredTypeAllowed, PURPOSE_POLICY, purposesOf, type Accepts, type FileOwner, type OwnerField } from "./policy";
import { fileUrl, storage, storageByName } from "./registry";
import { openUploadToken, sealUploadToken } from "./signing";
import type { UploadTarget } from "./storage";

/** Сколько живёт цель загрузки (PUT) и токен для finalizeUpload. */
const TARGET_TTL_SEC = 15 * 60;
const TOKEN_TTL_MS = 60 * 60 * 1000;
const UPLOADS_PER_HOUR = { limit: 120, windowSec: 3600 };

export type CreateUploadInput = { purpose: FilePurpose; contentType: string; size: number };
export type CreateUploadResult = { token: string; target: UploadTarget };
export type UploadedFile = { id: string; url: string; contentType: string; width: number | null; height: number | null };

const mb = (bytes: number) => Math.round(bytes / (1024 * 1024));

/**
 * Шаг 1. Подписанная цель для прямой загрузки из браузера (s3/blob — в хранилище, local — наш маршрут).
 * Байты не идут через Server Action: у Vercel лимит тела запроса 4,5 МБ.
 */
export async function createUpload(user: CurrentUser, input: CreateUploadInput): Promise<CreateUploadResult> {
  const policy = PURPOSE_POLICY[input.purpose];
  if (!policy.roles.includes(user.role)) return fail.forbidden(ru.files.errors.purposeForbidden);
  if (!declaredTypeAllowed(policy.accepts, input.contentType)) return fail.validation(notAcceptedText(policy.accepts));
  if (input.size > policy.maxBytes) return fail.validation(ru.files.errors.tooLarge(mb(policy.maxBytes)));
  await enforceRateLimit(`files.upload:${user.id}`, UPLOADS_PER_HOUR);

  const provider = await storage();
  if (!provider.uploadTarget) return fail.unavailable();
  const now = Date.now();
  const id = randomUUID();
  const token = sealUploadToken({
    id,
    userId: user.id,
    purpose: input.purpose,
    provider: provider.name,
    stagingKey: `uploads/${id}`,
    contentType: input.contentType,
    maxBytes: policy.maxBytes,
    issuedAt: now,
    exp: now + TOKEN_TTL_MS,
  });
  const target = await provider.uploadTarget(`uploads/${id}`, {
    contentType: input.contentType,
    maxBytes: policy.maxBytes,
    expiresInSec: TARGET_TTL_SEC,
    token,
  });
  return { token, target };
}

const NOT_ACCEPTED_TEXT: Record<Accepts, string> = {
  image: ru.files.errors.notImage,
  imageOrPdf: ru.files.errors.notImageOrPdf,
  png: ru.files.errors.notPng,
};
const notAcceptedText = (accepts: Accepts) => NOT_ACCEPTED_TEXT[accepts];

type Processed = { bytes: Uint8Array; contentType: string; ext: "jpg" | "png" | "pdf"; width: number | null; height: number | null; phash: string | null };

/**
 * Тип — по байтам: фото пережимаются в JPEG без EXIF, PDF сохраняется как есть (его хэш подписывают),
 * рисунок подписи — PNG без метаданных с сохранённой прозрачностью.
 */
async function processBytes(raw: Uint8Array, accepts: Accepts): Promise<Processed> {
  const type = sniffType(raw);
  if (accepts === "png") {
    if (type !== "png") return fail.validation(notAcceptedText(accepts));
    const png = await processPng(raw);
    return { ...png, ext: "png", phash: null };
  }
  if (type === "pdf" && accepts === "imageOrPdf") {
    return { bytes: raw, contentType: "application/pdf", ext: "pdf", width: null, height: null, phash: null };
  }
  if (type === null || type === "pdf") return fail.validation(notAcceptedText(accepts));
  const image = await processImage(raw);
  return { bytes: image.bytes, contentType: image.contentType, ext: "jpg", width: image.width, height: image.height, phash: image.phash };
}

/** <purpose>/<yyyy>/<mm>/<id> — без персональных данных; дата из момента выдачи токена, поэтому ключ детерминирован. */
function finalKeyBase(purpose: FilePurpose, at: Date, id: string) {
  const month = String(at.getUTCMonth() + 1).padStart(2, "0");
  return `${purpose.toLowerCase()}/${at.getUTCFullYear()}/${month}/${id}`;
}

async function toUploaded(file: StoredFile): Promise<UploadedFile> {
  return { id: file.id, url: await fileUrl(file), contentType: file.contentType, width: file.width, height: file.height };
}

/**
 * Шаг 2. Браузер загрузил байты — проверяем и сохраняем. Идемпотентно: повтор с тем же токеном
 * (двойной клик, повтор после сбоя) возвращает тот же файл — ключ выводится из токена, storageKey уникален.
 */
export async function finalizeUpload(user: CurrentUser, input: { token: string }): Promise<UploadedFile> {
  const claims = openUploadToken(input.token);
  if (!claims) return fail.validation(ru.files.errors.expired);
  if (claims.userId !== user.id) return fail.forbidden();

  const policy = PURPOSE_POLICY[claims.purpose];
  const base = finalKeyBase(claims.purpose, new Date(claims.issuedAt), claims.id);
  const existing = await db.storedFile.findFirst({ where: { storageKey: { startsWith: `${base}.` } } });
  if (existing) return toUploaded(existing);

  const provider = await storageByName(claims.provider);
  const declared = await provider.size?.(claims.stagingKey);
  if (declared === null) return fail.validation(ru.files.errors.notUploaded);
  try {
    // Сначала размер по HEAD (S3): объект больше лимита в память не читаем.
    if (declared !== undefined && declared > claims.maxBytes) return fail.validation(ru.files.errors.tooLarge(mb(claims.maxBytes)));
    const raw = await provider.get(claims.stagingKey);
    if (!raw) return fail.validation(ru.files.errors.notUploaded);
    if (raw.length > claims.maxBytes) return fail.validation(ru.files.errors.tooLarge(mb(claims.maxBytes)));
    const file = await persist(provider.name, `${base}`, claims.purpose, await processBytes(raw, policy.accepts), { uploadedById: user.id });
    return toUploaded(file);
  } finally {
    await provider.delete(claims.stagingKey).catch((error: unknown) => logger.warn("files.staging.delete_failed", { error }));
  }
}

async function persist(
  providerName: string,
  base: string,
  purpose: FilePurpose,
  processed: Processed,
  extra: { uploadedById?: string; isAiGenerated?: boolean; tx?: Db },
): Promise<StoredFile> {
  const client = extra.tx ?? db;
  const storageKey = `${base}.${processed.ext}`;
  const provider = await storageByName(providerName);
  await provider.put(storageKey, processed.bytes, processed.contentType);
  try {
    return await client.storedFile.create({
      data: {
        storageKey,
        provider: providerName,
        purpose,
        contentType: processed.contentType,
        size: processed.bytes.length,
        sha256: sha256Hex(processed.bytes),
        phash: processed.phash,
        width: processed.width,
        height: processed.height,
        uploadedById: extra.uploadedById,
        isAiGenerated: extra.isAiGenerated ?? false,
      },
    });
  } catch (e) {
    // Параллельный finalize того же токена успел раньше: тот же ключ — тот же файл.
    if (isUniqueViolation(e)) return client.storedFile.findUniqueOrThrow({ where: { storageKey } });
    throw e;
  }
}

/**
 * Серверное сохранение (documents — PDF договора, ai — сгенерированная картинка): та же проверка
 * типа по байтам и та же обработка фото, но без браузера. PDF сохраняется байт в байт.
 */
export async function saveFile(input: {
  purpose: FilePurpose;
  bytes: Uint8Array;
  uploadedById?: string;
  isAiGenerated?: boolean;
  /**
   * Транзакция вызывающего: при её откате не останется записи StoredFile. Байты в хранилище при этом
   * остаются (без записи их не найдёт и files.cleanupOrphans) — для PDF это килобайты, допустимо.
   */
  tx?: Db;
}): Promise<StoredFile> {
  const provider = await storage();
  const processed = await processBytes(input.bytes, PURPOSE_POLICY[input.purpose].accepts);
  return persist(provider.name, finalKeyBase(input.purpose, new Date(), randomUUID()), input.purpose, processed, input);
}

/**
 * Файл ещё ни к чему не прикреплён: пусты все поля-владельцы и нет ссылок с другой стороны
 * (документ, операция журнала денег, рисунок подписи, визуализация, фото витрины сделки).
 */
export const UNATTACHED = {
  portfolioItemId: null,
  requestId: null,
  progressReportId: null,
  dealId: null,
  executorProfileId: null,
  disputeId: null,
  messageId: null,
  visualizationId: null,
  document: { is: null },
  bankDocFor: { is: null },
  handSignature: { is: null },
  visualizationSrc: { none: {} },
  portfolioDealPhotos: { none: {} },
} satisfies Prisma.StoredFileWhereInput;

/**
 * Прикрепить загруженные файлы к сущности. Вызывает модуль-владелец в своей транзакции,
 * после своей проверки прав (сторона сделки, свой профиль). Только свои, ещё не прикреплённые файлы
 * подходящего назначения (PURPOSE_POLICY.attachTo); они дописываются после уже прикреплённых к этой
 * сущности в порядке списка (фото добавляют частями — порядок не сбивается). Иначе CONFLICT —
 * транзакция вызывающего откатится.
 *
 * deal-core: { dealId } — фото сдачи (DELIVERY), { progressReportId } — «Ход работ», { disputeId } — спор;
 * identity: { executorProfileId } — KYC_ID и KYC_REGISTRATION.
 */
export async function attachFiles(tx: Db, input: { fileIds: readonly string[]; uploadedById: string; owner: FileOwner }): Promise<void> {
  const [field, ownerId] = Object.entries(input.owner).find(([, v]) => v !== undefined) as [OwnerField, string];
  const purposes = purposesOf(field);
  const last = await tx.storedFile.aggregate({ where: { [field]: ownerId }, _max: { sortOrder: true } });
  const first = (last._max.sortOrder ?? -1) + 1;
  for (const [i, id] of input.fileIds.entries()) {
    const result = await tx.storedFile.updateMany({
      where: { id, uploadedById: input.uploadedById, purpose: { in: purposes }, ...UNATTACHED },
      data: { [field]: ownerId, sortOrder: first + i },
    });
    expectOneUpdated(result, ru.files.errors.notOwn);
  }
}

/** Назначения, которые привязываются ссылкой с другой стороны (уникальный внешний ключ чужой таблицы). */
export type LinkedPurpose = "BANK_DOCUMENT" | "HAND_SIGNATURE";

/**
 * Проверка перед ссылкой на файл с другой стороны: скан банковского документа
 * (payments: MoneyTransaction.bankDocFileId) и рисунок подписи (documents: HandSignature.imageFileId).
 * Файл свой, нужного назначения и ещё ни к чему не прикреплён — иначе CONFLICT. Ссылку пишет вызывающий
 * в той же транзакции; от двойной привязки параллельно защищает уникальный индекс внешнего ключа.
 */
export async function assertAttachable(tx: Db, input: { fileId: string; uploadedById: string; purpose: LinkedPurpose }): Promise<void> {
  const file = await tx.storedFile.findFirst({
    where: { id: input.fileId, uploadedById: input.uploadedById, purpose: input.purpose, ...UNATTACHED },
    select: { id: true },
  });
  if (!file) return fail.conflict(ru.files.errors.notOwn);
}

/** Пользователь убрал фото из формы до сохранения: удаляем, только если файл свой и ещё не прикреплён. */
export async function discardUpload(user: CurrentUser, fileId: string): Promise<void> {
  const file = await db.storedFile.findUnique({ where: { id: fileId } });
  if (!file) return;
  if (file.uploadedById !== user.id) return fail.forbidden();
  const result = await db.storedFile.deleteMany({ where: { id: fileId, ...UNATTACHED } });
  expectOneUpdated(result, ru.files.errors.alreadyAttached);
  await (await storageByName(file.provider)).delete(file.storageKey);
}
