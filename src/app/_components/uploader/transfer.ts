import type { UploadTarget } from "@/modules/files/client";

/**
 * Что показывать в выборе файлов. HEIC/HEIF (фото iPhone) — явно: на Windows без кодека HEIF
 * и в части браузеров Android они не входят в image/*. Сервер раскодирует HEIC сам (files.processImage).
 */
export const PHOTO_ACCEPT = "image/*,image/heic,image/heif,.heic,.heif";

/**
 * Тип для подписи цели: у HEIC из галереи браузер иногда не указывает тип или пишет «двоичные данные» —
 * тогда берём по расширению. Окончательно тип проверяет сервер по байтам.
 */
export function contentTypeOf(file: File): string {
  if (file.type && file.type !== "application/octet-stream") return file.type;
  const ext = file.name.split(".").pop()?.toLowerCase();
  if (ext === "heic" || ext === "heif") return `image/${ext}`;
  if (ext === "jpg" || ext === "jpeg") return "image/jpeg";
  return "application/octet-stream";
}

/** HEIC/HEIF: браузеры, кроме Safari, не показывают его в <img>, поэтому превью берём с сервера. */
export function isHeic(file: File): boolean {
  return /^image\/hei[cf]/.test(contentTypeOf(file));
}

function putWithProgress(target: Extract<UploadTarget, { kind: "http" }>, file: File, onProgress: (percent: number) => void): Promise<void> {
  return new Promise((resolve, reject) => {
    // XMLHttpRequest, а не fetch: у fetch нет прогресса отправки.
    const xhr = new XMLHttpRequest();
    xhr.open(target.method, target.url);
    for (const [name, value] of Object.entries(target.headers)) xhr.setRequestHeader(name, value);
    xhr.upload.onprogress = (e) => {
      if (e.lengthComputable) onProgress(Math.round((e.loaded / e.total) * 100));
    };
    xhr.onload = () => (xhr.status >= 200 && xhr.status < 300 ? resolve() : reject(new Error(`upload ${xhr.status}`)));
    xhr.onerror = () => reject(new Error("upload network error"));
    xhr.send(file);
  });
}

/** Отправка байтов напрямую в хранилище по цели из createUpload. */
export async function sendToTarget(target: UploadTarget, file: File, onProgress: (percent: number) => void): Promise<void> {
  if (target.kind === "http") return putWithProgress(target, file, onProgress);
  // SDK Blob нужен только когда выбран vercel-blob — грузим его по требованию.
  const { put } = await import("@vercel/blob/client");
  await put(target.pathname, file, {
    access: "private",
    token: target.clientToken,
    contentType: target.contentType,
    onUploadProgress: ({ percentage }) => onProgress(Math.round(percentage)),
  });
}
