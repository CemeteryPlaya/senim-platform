import { ru } from "@/i18n/ru";
import type { CurrentUser } from "@/modules/identity";
import { fail } from "@/platform/errors";
import { contentDisposition } from "./disposition";
import { storageByName } from "./registry";
import { openUploadToken, verifyDownload, type DownloadQuery } from "./signing";

/**
 * Обмен байтами с local-хранилищем через наши маршруты (только разработка):
 * PUT /api/files/upload?token=… и GET /api/files/<ключ>?exp&sig. s3 и blob обходятся без них.
 */

const MB = 1024 * 1024;

async function readLimited(body: ReadableStream<Uint8Array>, maxBytes: number): Promise<Uint8Array> {
  const reader = body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.length;
    if (total > maxBytes) {
      await reader.cancel();
      return fail.validation(ru.files.errors.tooLarge(Math.round(maxBytes / MB)));
    }
    chunks.push(value);
  }
  const out = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    out.set(chunk, offset);
    offset += chunk.length;
  }
  return out;
}

export async function receiveLocalUpload(user: CurrentUser, input: { token: string; body: ReadableStream<Uint8Array> | null }): Promise<void> {
  const claims = openUploadToken(input.token);
  if (!claims || claims.provider !== "local") return fail.validation(ru.files.errors.expired);
  if (claims.userId !== user.id) return fail.forbidden();
  if (!input.body) return fail.validation(ru.files.errors.notUploaded);
  const bytes = await readLimited(input.body, claims.maxBytes);
  if (bytes.length === 0) return fail.validation(ru.files.errors.notUploaded);
  await (await storageByName("local")).put(claims.stagingKey, bytes, claims.contentType);
}

const TYPES: Record<string, string> = { jpg: "image/jpeg", jpeg: "image/jpeg", png: "image/png", webp: "image/webp", pdf: "application/pdf" };

/** null — подпись неверна или истекла, ключ временный или файла нет: маршрут отвечает 404. */
export async function readLocalDownload(query: DownloadQuery): Promise<{ bytes: Uint8Array; contentType: string; disposition: string } | null> {
  if (query.key.startsWith("uploads/")) return null; // непроверенные байты наружу не отдаём
  if (!verifyDownload(query)) return null;
  const bytes = await (await storageByName("local")).get(query.key).catch(() => null);
  if (!bytes) return null;
  const ext = query.key.split(".").pop()?.toLowerCase() ?? "";
  return { bytes, contentType: TYPES[ext] ?? "application/octet-stream", disposition: contentDisposition(query.name) };
}
