import type { UploadTarget } from "@/modules/files/client";

/** Тип для подписи цели: у HEIC из галереи браузер иногда не указывает тип — берём по расширению. */
export function contentTypeOf(file: File): string {
  if (file.type) return file.type;
  const ext = file.name.split(".").pop()?.toLowerCase();
  if (ext === "heic" || ext === "heif") return `image/${ext}`;
  if (ext === "jpg" || ext === "jpeg") return "image/jpeg";
  return "application/octet-stream";
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
