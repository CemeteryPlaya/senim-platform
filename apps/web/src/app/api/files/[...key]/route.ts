import { z } from "zod";
import { readLocalDownload } from "@/modules/files";

const query = z.object({
  exp: z.string().regex(/^\d{1,12}$/),
  sig: z.string().regex(/^[0-9a-f]{64}$/),
  name: z.string().max(200).optional(),
});

/**
 * Скачивание из local-хранилища по подписанной ссылке (fileUrl). Сессия не нужна: подпись HMAC
 * с ключом и сроком и есть право доступа — как у подписанных ссылок S3 и Blob. Ссылку выдаёт
 * только экран, который уже проверил права (в том числе гостю — фото портфолио).
 */
export async function GET(request: Request, { params }: { params: Promise<{ key: string[] }> }) {
  const { key } = await params;
  const parsed = query.safeParse(Object.fromEntries(new URL(request.url).searchParams));
  if (!parsed.success) return new Response("Not found", { status: 404 });
  const file = await readLocalDownload({ key: key.join("/"), ...parsed.data });
  if (!file) return new Response("Not found", { status: 404 });

  const maxAge = Math.max(0, Number(parsed.data.exp) - Math.floor(Date.now() / 1000));
  return new Response(new Blob([new Uint8Array(file.bytes)]), {
    headers: {
      "content-type": file.contentType,
      "content-length": String(file.bytes.length),
      "content-disposition": file.disposition,
      "cache-control": `private, max-age=${maxAge}`,
      "x-content-type-options": "nosniff",
      "content-security-policy": "default-src 'none'; img-src 'self'; style-src 'unsafe-inline'; sandbox",
    },
  });
}
