import { PDFDocument } from "pdf-lib";
import { ru } from "@/i18n/ru";
import { saveFile } from "@/modules/files";
import type { Tx } from "@/platform/db";
import { fail } from "@/platform/errors";

/** Рисунок подписи с холста: PNG, не больше 256 КБ и 2000×1000 px. */
export const HAND_IMAGE_MAX_BYTES = 256 * 1024;
const MAX = { width: 2000, height: 1000 };
const PNG_MAGIC = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];

/** Размеры из заголовка IHDR; null — не PNG. */
export function pngSize(bytes: Uint8Array): { width: number; height: number } | null {
  if (bytes.length < 24 || PNG_MAGIC.some((b, i) => bytes[i] !== b)) return null;
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  return { width: view.getUint32(16), height: view.getUint32(20) };
}

/**
 * Проверка на входе: PNG разумного размера, который pdf-lib сможет встроить в лист подписей.
 * Иначе VALIDATION — подпись не сохраняется, человек рисует ещё раз.
 */
export async function assertHandImage(bytes: Uint8Array): Promise<void> {
  const size = pngSize(bytes);
  const bad = () => fail.validation(ru.documents.errors.badSignatureImage);
  if (!size || bytes.length > HAND_IMAGE_MAX_BYTES) return bad();
  if (size.width < 20 || size.height < 10 || size.width > MAX.width || size.height > MAX.height) return bad();
  try {
    await (await PDFDocument.create()).embedPng(bytes);
  } catch {
    return bad();
  }
}

/** Сохранить рисунок подписи файлом files (назначение HAND_SIGNATURE) в транзакции подписи. */
export const storeHandImage = (tx: Tx, bytes: Uint8Array, uploadedById: string) => saveFile({ purpose: "HAND_SIGNATURE", bytes, uploadedById, tx });
