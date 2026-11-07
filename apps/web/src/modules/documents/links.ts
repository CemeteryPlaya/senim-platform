import { createHmac, randomBytes } from "node:crypto";
import { safeEqual } from "@/platform/crypto";
import { env } from "@/platform/env";

/**
 * Подписанная ссылка на документ (ТЗ п. 7: «открываются с телефона, скачиваются и пересылаются»):
 * /d/<documentId>.<срок base36>.<HMAC-SHA256 base64url>. Без таблицы ссылок и без персональных данных
 * в адресе — только id документа и срок. Кто получил ссылку (например, переслали в WhatsApp), тот видит
 * документ до срока: срок короткий, каждое открытие пишется в аудит.
 *
 * Секрет — FILE_URL_SECRET; подпись отделена от ссылок files префиксом payload. В production env.ts
 * без него не запускается; в разработке — случайный секрет процесса: ссылки живут до перезапуска
 * сервера, подделать их по исходному коду нельзя (литерального запасного ключа нет).
 */
export const LINK_TTL_SEC = 72 * 3600;

const ID = /^[a-z0-9]{1,64}$/;
let processSecret: string | undefined;

function linkSecret(): string {
  const configured = env().FILE_URL_SECRET;
  if (configured) return configured;
  processSecret ??= randomBytes(32).toString("hex");
  return processSecret;
}

export type LinkOpts = { now: number; secret: string };
export const linkDefaults = (): LinkOpts => ({ now: Date.now(), secret: linkSecret() });

const mac = (secret: string, documentId: string, exp: string) => createHmac("sha256", secret).update(`documents.link.v1\n${documentId}\n${exp}`).digest("base64url");

export function sealDocumentLink(documentId: string, opts: LinkOpts = linkDefaults()): { token: string; expiresAt: Date } {
  const expSec = Math.floor(opts.now / 1000) + LINK_TTL_SEC;
  const exp = expSec.toString(36);
  return { token: `${documentId}.${exp}.${mac(opts.secret, documentId, exp)}`, expiresAt: new Date(expSec * 1000) };
}

export function openDocumentLink(token: string, opts: LinkOpts = linkDefaults()): { documentId: string; expiresAt: Date } | null {
  const [documentId, exp, sig, ...rest] = token.split(".");
  if (rest.length > 0 || !documentId || !exp || !sig || !ID.test(documentId) || !/^[0-9a-z]{1,10}$/.test(exp)) return null;
  if (!safeEqual(sig, mac(opts.secret, documentId, exp))) return null;
  const expiresAt = new Date(Number.parseInt(exp, 36) * 1000);
  return expiresAt.getTime() >= opts.now ? { documentId, expiresAt } : null;
}

/** https://wa.me/?text= — короткий текст без персональных данных и ссылка. */
export function whatsappShareUrl(text: string, url: string): string {
  return `https://wa.me/?text=${encodeURIComponent(`${text}: ${url}`)}`;
}
