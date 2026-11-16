/**
 * Уменьшение фото перед загрузкой: снимок телефона (3–12 МБ) на мобильном интернете уходит долго, а предел файла
 * иначе отказал бы. Большое JPEG / PNG / WebP сжимается до `MAX_SIDE` по длинной стороне; HEIC / HEIF (браузер не
 * раскодирует — их превращает сервер), PDF, GIF, SVG и фото, что уже не больше, остаются как есть. Любой сбой
 * (нет `createImageBitmap` / canvas, нехватка памяти) — исходный файл: загрузка не должна ломаться из-за оптимизации.
 */

/** Длинная сторона после уменьшения, пикселей. */
export const MAX_SIDE = 2560;
/** Качество JPEG / WebP. */
export const QUALITY = 0.85;

/** Какие типы пересжимаем (остальные уходят как есть). */
const RESIZABLE = new Set(["image/jpeg", "image/png", "image/webp"]);

/** Размер после уменьшения с сохранением пропорций; `null` — уменьшать не нужно. Чистая функция. */
export function fitSize(width: number, height: number, maxSide: number = MAX_SIDE): { width: number; height: number } | null {
  const longest = Math.max(width, height);
  if (!(longest > maxSide) || width <= 0 || height <= 0) return null;
  const scale = maxSide / longest;
  return { width: Math.max(1, Math.round(width * scale)), height: Math.max(1, Math.round(height * scale)) };
}

function toBlob(canvas: HTMLCanvasElement, type: string): Promise<Blob | null> {
  return new Promise((resolve) => canvas.toBlob(resolve, type, QUALITY));
}

/**
 * Файл для загрузки: уменьшенная копия (тот же тип и имя) или сам файл. Ориентация из EXIF применяется к пикселям
 * (`imageOrientation: "from-image"`), поэтому снимок не «ложится на бок», хотя метаданных в копии уже нет.
 */
export async function resizePhoto(file: File): Promise<File> {
  if (!RESIZABLE.has(file.type) || typeof createImageBitmap !== "function" || typeof document === "undefined") return file;
  try {
    const bitmap = await createImageBitmap(file, { imageOrientation: "from-image" });
    const size = fitSize(bitmap.width, bitmap.height);
    if (size === null) {
      bitmap.close();
      return file;
    }
    const canvas = document.createElement("canvas");
    canvas.width = size.width;
    canvas.height = size.height;
    const context = canvas.getContext("2d");
    if (context === null) {
      bitmap.close();
      return file;
    }
    context.drawImage(bitmap, 0, 0, size.width, size.height);
    bitmap.close();
    const blob = await toBlob(canvas, file.type);
    // Копия не меньше исходного (редкий PNG) — оставляем исходный.
    if (blob === null || blob.size >= file.size) return file;
    return new File([blob], file.name, { type: blob.type || file.type, lastModified: file.lastModified });
  } catch {
    return file;
  }
}
