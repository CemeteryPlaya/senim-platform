/**
 * Хранилище файлов. В БД лежат только метаданные (StoredFile), байты — у провайдера:
 *  - local: папка на диске, только разработка;
 *  - s3: любое S3-совместимое хранилище, в том числе облако в РК;
 *  - vercel-blob: демо на Vercel.
 * Ключи не содержат персональных данных: <purpose>/<yyyy>/<mm>/<cuid>.<ext>.
 */
export interface StorageProvider {
  readonly name: "local" | "s3" | "vercel-blob";
  put(key: string, body: Uint8Array, contentType: string): Promise<void>;
  get(key: string): Promise<Uint8Array>;
  delete(key: string): Promise<void>;
  /** Ссылка на скачивание с ограниченным сроком жизни. */
  downloadUrl(key: string, opts: { expiresInSec: number; fileName?: string }): Promise<string>;
  /** Цель для прямой загрузки из браузера (подписанная ссылка), если провайдер поддерживает. */
  uploadTarget?(key: string, opts: { contentType: string; maxBytes: number; expiresInSec: number }): Promise<UploadTarget>;
}

export type UploadTarget = { url: string; method: "PUT" | "POST"; headers: Record<string, string> };
