import type { StorageName } from "./signing";

export type { StorageName } from "./signing";

/**
 * Хранилище файлов. В БД лежат только метаданные (StoredFile), байты — у провайдера:
 *  - local: папка на диске, только разработка; ссылки подписывает HMAC (/api/files/<ключ>);
 *  - s3: любое S3-совместимое хранилище, в том числе облако в РК;
 *  - vercel-blob: демо на Vercel (приватное хранилище, подписанные ссылки);
 *  - static: только чтение из public/ — демо-файлы сида (ключ — путь внутри public/).
 * Провайдер файла записан в StoredFile.provider: читаем тем, которым записали.
 * Ключи не содержат персональных данных: <purpose>/<yyyy>/<mm>/<id>.<ext>.
 */
export interface StorageProvider {
  readonly name: StorageName;
  put(key: string, body: Uint8Array, contentType: string): Promise<void>;
  /** null — объекта нет (например, браузер так и не загрузил файл). */
  get(key: string): Promise<Uint8Array | null>;
  delete(key: string): Promise<void>;
  /** Ссылка на скачивание с ограниченным сроком жизни. */
  downloadUrl(key: string, opts: { expiresInSec: number; fileName?: string }): Promise<string>;
  /** Цель для прямой загрузки из браузера, минуя тело запроса к функции (лимит Vercel 4,5 МБ). */
  uploadTarget?(key: string, opts: UploadTargetOpts): Promise<UploadTarget>;
}

export type UploadTargetOpts = {
  contentType: string;
  maxBytes: number;
  expiresInSec: number;
  /** Подписанный токен загрузки: local кладёт его в адрес своего маршрута. */
  token: string;
};

/**
 * Куда браузер отправляет байты:
 *  - http: обычный PUT по подписанному адресу (local, s3) с указанными заголовками;
 *  - vercel-blob: `put` из `@vercel/blob/client` с клиентским токеном.
 */
export type UploadTarget =
  | { kind: "http"; url: string; method: "PUT"; headers: Record<string, string> }
  | { kind: "vercel-blob"; pathname: string; clientToken: string; contentType: string };
