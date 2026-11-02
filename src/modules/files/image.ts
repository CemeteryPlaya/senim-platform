import sharp, { type SharpOptions } from "sharp";
import { ru } from "@/i18n/ru";
import { fail } from "@/platform/errors";
import { logger } from "@/platform/logger";

/** Тип по сигнатуре байтов. Заявленному браузером типу и расширению не доверяем. */
export type SniffedType = "jpeg" | "png" | "webp" | "heic" | "pdf";

const HEIF_BRANDS = new Set(["heic", "heix", "hevc", "hevx", "heim", "heis", "mif1", "msf1"]);

function ascii(bytes: Uint8Array, from: number, to: number): string {
  return String.fromCharCode(...bytes.subarray(from, to));
}

/** Сигнатуры по порядку проверки: первая совпавшая определяет тип. */
const SIGNATURES: readonly [SniffedType, (b: Uint8Array) => boolean][] = [
  ["jpeg", (b) => b.length >= 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff],
  ["png", (b) => b.length >= 8 && ascii(b, 0, 8) === "\x89PNG\r\n\x1a\n"],
  ["webp", (b) => b.length >= 12 && ascii(b, 0, 4) === "RIFF" && ascii(b, 8, 12) === "WEBP"],
  ["heic", (b) => b.length >= 12 && ascii(b, 4, 8) === "ftyp" && HEIF_BRANDS.has(ascii(b, 8, 12))],
  ["pdf", (b) => b.length >= 5 && ascii(b, 0, 5) === "%PDF-"],
];

export function sniffType(bytes: Uint8Array): SniffedType | null {
  return SIGNATURES.find(([, matches]) => matches(bytes))?.[0] ?? null;
}

/** Длинная сторона после сжатия: хватает для просмотра на экране и для акта в PDF. */
export const MAX_SIDE = 2560;
const JPEG_QUALITY = 82;
/**
 * Предел пикселей на входе sharp: PNG в десятки килобайт может заявить 100 млн пикселей и занять
 * гигабайты памяти при раскодировании. 50 млн — с запасом для фото телефона (48 Мп).
 */
export const MAX_INPUT_PIXELS = 50_000_000;

export type ProcessedImage = {
  bytes: Uint8Array;
  contentType: "image/jpeg";
  width: number;
  height: number;
  phash: string;
};

/**
 * HEIC/HEIF (фото iPhone): готовая сборка sharp не декодирует HEVC, поэтому раскодируем libheif (WASM,
 * пакет heic-decode) в пиксели RGBA и дальше обрабатываем их как любое фото. Поворот из коробок
 * irot/imir libheif применяет сам, а EXIF в пиксели не попадает — повторного поворота нет.
 * Размер проверяем до раскодирования: декодер синхронный и держит весь кадр в памяти.
 */
async function decodeHeif(input: Uint8Array): Promise<{ input: Uint8Array; options: SharpOptions }> {
  // Загружаем по требованию: 2 МБ WASM нужны только когда пришёл HEIC.
  const { default: heic } = await import("heic-decode");
  const images = await heic.all({ buffer: input });
  try {
    const first = images[0];
    if (!first || first.width * first.height > MAX_INPUT_PIXELS) throw new Error("heif: no image or too many pixels");
    const { width, height, data } = await first.decode();
    return { input: new Uint8Array(data.buffer, data.byteOffset, data.byteLength), options: { raw: { width, height, channels: 4 } } };
  } finally {
    images.dispose();
  }
}

/**
 * Фото → JPEG без метаданных: ориентация из EXIF применяется к пикселям (autoOrient),
 * затем все метаданные (геолокация, модель телефона) отбрасываются — sharp не пишет их без withMetadata.
 * JPEG — потому что его встраивает pdf-lib в акты и понимает любой браузер.
 */
export async function processImage(raw: Uint8Array): Promise<ProcessedImage> {
  try {
    const { input, options } = sniffType(raw) === "heic" ? await decodeHeif(raw) : { input: raw, options: {} };
    const { data, info } = await sharp(input, { ...options, failOn: "error", limitInputPixels: MAX_INPUT_PIXELS })
      .autoOrient()
      .resize({ width: MAX_SIDE, height: MAX_SIDE, fit: "inside", withoutEnlargement: true })
      .flatten({ background: "#ffffff" })
      .jpeg({ quality: JPEG_QUALITY, mozjpeg: true })
      .toBuffer({ resolveWithObject: true });
    const bytes = new Uint8Array(data);
    return { bytes, contentType: "image/jpeg", width: info.width, height: info.height, phash: await dHash(bytes) };
  } catch (error) {
    logger.warn("files.image.decode_failed", { error });
    return fail.validation(ru.files.errors.broken);
  }
}

/** Рисунок подписи: хватает для встраивания в PDF и не раздувает документ. */
export const SIGNATURE_MAX_SIDE = 1200;

/**
 * Рисунок подписи → PNG без метаданных: прозрачный фон сохраняется (его кладут поверх строки подписи
 * в PDF), размер ограничен. Перцептивный хэш не нужен — повторы подписи не ищем.
 */
export async function processPng(raw: Uint8Array): Promise<{ bytes: Uint8Array; contentType: "image/png"; width: number; height: number }> {
  try {
    const { data, info } = await sharp(raw, { failOn: "error", limitInputPixels: MAX_INPUT_PIXELS })
      .resize({ width: SIGNATURE_MAX_SIDE, height: SIGNATURE_MAX_SIDE, fit: "inside", withoutEnlargement: true })
      .png({ compressionLevel: 9 })
      .toBuffer({ resolveWithObject: true });
    return { bytes: new Uint8Array(data), contentType: "image/png", width: info.width, height: info.height };
  } catch (error) {
    logger.warn("files.png.decode_failed", { error });
    return fail.validation(ru.files.errors.broken);
  }
}

/**
 * dHash: 9×8 в оттенках серого, бит = «пиксель ярче соседа справа». 64 бита → 16 hex.
 * Устойчив к пережатию и масштабу, поэтому находит одно и то же фото, загруженное разными людьми.
 */
export async function dHash(input: Uint8Array): Promise<string> {
  const pixels = await sharp(input, { limitInputPixels: MAX_INPUT_PIXELS }).autoOrient().grayscale().resize(9, 8, { fit: "fill" }).raw().toBuffer();
  let hash = 0n;
  for (let y = 0; y < 8; y++) {
    for (let x = 0; x < 8; x++) {
      hash = (hash << 1n) | (pixels[y * 9 + x]! > pixels[y * 9 + x + 1]! ? 1n : 0n);
    }
  }
  return hash.toString(16).padStart(16, "0");
}

export function hammingHex(a: string, b: string): number {
  let diff = BigInt(`0x${a}`) ^ BigInt(`0x${b}`);
  let count = 0;
  while (diff > 0n) {
    count += Number(diff & 1n);
    diff >>= 1n;
  }
  return count;
}
