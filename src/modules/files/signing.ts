import { randomBytes } from "node:crypto";
import { z } from "zod";
import { FilePurpose } from "@/generated/prisma/enums";
import { hmacHex, safeEqual } from "@/platform/crypto";
import { env } from "@/platform/env";

/**
 * Подписи HMAC-SHA256 для файлов:
 *  - ссылка на скачивание из local-хранилища (`/api/files/<ключ>?exp&sig`);
 *  - токен загрузки: что, кто и куда загружает (без таблицы «ожидающих загрузок»).
 * Секрет — FILE_URL_SECRET; в production env.ts без него не запускается. В разработке — случайный секрет
 * процесса (как у ссылок documents/links.ts): литерального запасного ключа нет, подделать ссылку или токен
 * загрузки по исходному коду нельзя. Ключ лежит в globalThis — переживает горячую перезагрузку модулей
 * и общий для всех слоёв сборки в одном процессе; после перезапуска сервера старые ссылки недействительны.
 */

const PROCESS_SECRET = Symbol.for("senim.files.processSecret");
type WithSecret = typeof globalThis & { [PROCESS_SECRET]?: string };

export type SignOpts = { now: number; secret: string };

export function fileSecret(): string {
  const configured = env().FILE_URL_SECRET;
  if (configured) return configured;
  const g = globalThis as WithSecret;
  g[PROCESS_SECRET] ??= randomBytes(32).toString("hex");
  return g[PROCESS_SECRET];
}

const defaults = (): SignOpts => ({ now: Date.now(), secret: fileSecret() });

function downloadPayload(key: string, exp: string, name: string | undefined) {
  return `dl\n${key}\n${exp}\n${name ?? ""}`;
}

/** Ключ в адресе: каждый сегмент кодируется отдельно, «/» остаются разделителями. */
export function encodeKeyPath(key: string): string {
  return key.split("/").map(encodeURIComponent).join("/");
}

export function localDownloadUrl(key: string, opts: { expiresInSec: number; fileName?: string }, sign: SignOpts = defaults()): string {
  const exp = String(Math.floor(sign.now / 1000) + opts.expiresInSec);
  const params = new URLSearchParams({ exp, sig: hmacHex(sign.secret, downloadPayload(key, exp, opts.fileName)) });
  if (opts.fileName) params.set("name", opts.fileName);
  return `/api/files/${encodeKeyPath(key)}?${params}`;
}

export type DownloadQuery = { key: string; exp: string; sig: string; name?: string };

export function verifyDownload(q: DownloadQuery, sign: SignOpts = defaults()): boolean {
  if (!/^\d{1,12}$/.test(q.exp)) return false;
  if (Number(q.exp) * 1000 < sign.now) return false;
  return safeEqual(q.sig, hmacHex(sign.secret, downloadPayload(q.key, q.exp, q.name)));
}

export const STORAGE_NAMES = ["local", "s3", "vercel-blob", "static"] as const;
export type StorageName = (typeof STORAGE_NAMES)[number];

const claimsSchema = z.object({
  id: z.string().min(1),
  userId: z.string().min(1),
  purpose: z.enum(FilePurpose),
  provider: z.enum(STORAGE_NAMES),
  stagingKey: z.string().min(1),
  contentType: z.string().min(1),
  maxBytes: z.number().int().positive(),
  issuedAt: z.number().int(),
  exp: z.number().int(),
});

export type UploadClaims = z.infer<typeof claimsSchema>;

export function sealUploadToken(claims: UploadClaims, secret = fileSecret()): string {
  const body = Buffer.from(JSON.stringify(claims)).toString("base64url");
  return `${body}.${hmacHex(secret, `up\n${body}`)}`;
}

/** null — токен подделан, испорчен или истёк. */
export function openUploadToken(token: string, sign: SignOpts = defaults()): UploadClaims | null {
  const [body, sig, extra] = token.split(".");
  if (!body || !sig || extra !== undefined) return null;
  if (!safeEqual(sig, hmacHex(sign.secret, `up\n${body}`))) return null;
  let json: unknown;
  try {
    json = JSON.parse(Buffer.from(body, "base64url").toString("utf8"));
  } catch {
    return null;
  }
  const parsed = claimsSchema.safeParse(json);
  if (!parsed.success || parsed.data.exp < sign.now) return null;
  return parsed.data;
}
