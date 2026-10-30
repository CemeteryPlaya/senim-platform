import { hmacHex, safeEqual } from "@/platform/crypto";

/**
 * Подпись вебхуков рельса: HMAC-SHA256 от «<timestamp>.<тело>».
 * Метка времени в подписи не даёт переиграть старый запрос; допуск — 5 минут.
 * Повторная доставка того же события идёт с новой меткой и новой подписью, а eventId прежний.
 */
export const SIGNATURE_HEADER = "x-senim-signature";
export const TIMESTAMP_HEADER = "x-senim-timestamp";
const TOLERANCE_MS = 5 * 60_000;

export function signWebhook(secret: string, rawBody: string, now = new Date()): Record<string, string> {
  const timestamp = String(Math.floor(now.getTime() / 1000));
  return {
    "content-type": "application/json",
    [TIMESTAMP_HEADER]: timestamp,
    [SIGNATURE_HEADER]: `v1=${hmacHex(secret, `${timestamp}.${rawBody}`)}`,
  };
}

export function verifyWebhookSignature(secret: string, headers: Headers, rawBody: string, now = new Date()): boolean {
  const timestamp = headers.get(TIMESTAMP_HEADER);
  const signature = headers.get(SIGNATURE_HEADER);
  if (!timestamp || !signature || !/^\d+$/.test(timestamp)) return false;
  if (Math.abs(now.getTime() - Number(timestamp) * 1000) > TOLERANCE_MS) return false;
  return safeEqual(signature, `v1=${hmacHex(secret, `${timestamp}.${rawBody}`)}`);
}
