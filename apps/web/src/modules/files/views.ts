import { logger } from "@/platform/logger";
import { PDF_TYPE } from "./policy";
import { fileUrl } from "./registry";

/** Файл для экрана: фото — в галерею, PDF — строкой со ссылкой. `n` — номер с 1 по порядку списка. */
export type FileView = { id: string; kind: "image" | "pdf"; src: string; n: number };

/**
 * Вид файлов (фото или PDF) с подписанными ссылками — его читают и requests, и deal-core, без импорта друг друга.
 * PDF отдаётся с именем для скачивания `pdfName(n)`: исходное имя файла не хранится. Права проверяет вызывающий
 * (как у fileUrl). Сбой ссылки одного файла не роняет экран: файл пропускается с предупреждением в журнал (как фото
 * сделки), номера `n` остальных — по исходному порядку.
 */
export async function fileViews(
  files: readonly { id: string; provider: string; storageKey: string; contentType: string }[],
  pdfName: (n: number) => string,
): Promise<FileView[]> {
  const settled = await Promise.allSettled(
    files.map(async (f, i): Promise<FileView> => {
      const n = i + 1;
      return f.contentType.toLowerCase() === PDF_TYPE
        ? { id: f.id, kind: "pdf", src: await fileUrl(f, { fileName: pdfName(n) }), n }
        : { id: f.id, kind: "image", src: await fileUrl(f), n };
    }),
  );
  return settled.flatMap((result, i) => {
    if (result.status === "fulfilled") return [result.value];
    logger.warn("file view url failed", { fileId: files[i]?.id, error: result.reason });
    return [];
  });
}
