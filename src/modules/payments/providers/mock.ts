import { z } from "zod";
import { hmacHex, randomToken, safeEqual, sha256Hex } from "@/platform/crypto";
import type { PaymentProvider, ProviderResult, WebhookResult } from "../provider";

/**
 * Тестовый провайдер (dev, демо): подтверждает каждую операцию сразу, деньги не двигаются. Номер операции
 * выводится из ключа идемпотентности, поэтому повтор с тем же ключом — та же операция. В интерфейсе
 * операции помечены «тестовый платёж» (isTest). Заменяет прежний симулятор эскроу.
 *
 * Вебхуки mock сам не шлёт; формат нужен тестам и показу повторной доставки: JSON
 * `{ eventId, idempotencyKey, status, externalRef?, error? }`, подпись HMAC-SHA256 от «<время>.<тело>»
 * секретом процесса (снаружи его не подобрать, а в другом процессе подпись не сойдётся — и не должна).
 */

export const MOCK_SIGNATURE_HEADER = "x-mock-signature";
export const MOCK_TIMESTAMP_HEADER = "x-mock-timestamp";
const TOLERANCE_MS = 5 * 60_000;
const secret = randomToken();

const refOf = (idempotencyKey: string) => `MOCK-${sha256Hex(idempotencyKey).slice(0, 12).toUpperCase()}`;
const ok = (idempotencyKey: string): ProviderResult => ({ status: "SUCCEEDED", externalRef: refOf(idempotencyKey) });

/** Подписанная доставка вебхука mock — как её отправил бы провайдер. */
export function signMockWebhook(body: string, now = new Date()): Headers {
  const timestamp = String(Math.floor(now.getTime() / 1000));
  return new Headers({
    "content-type": "application/json",
    [MOCK_TIMESTAMP_HEADER]: timestamp,
    [MOCK_SIGNATURE_HEADER]: `v1=${hmacHex(secret, `${timestamp}.${body}`)}`,
  });
}

function verified(headers: Headers, body: string, now: Date): boolean {
  const timestamp = headers.get(MOCK_TIMESTAMP_HEADER);
  const signature = headers.get(MOCK_SIGNATURE_HEADER);
  if (!timestamp || !signature || !/^\d+$/.test(timestamp)) return false;
  if (Math.abs(now.getTime() - Number(timestamp) * 1000) > TOLERANCE_MS) return false;
  return safeEqual(signature, `v1=${hmacHex(secret, `${timestamp}.${body}`)}`);
}

const eventSchema = z.object({
  eventId: z.string().min(1).max(200),
  idempotencyKey: z.string().min(1).max(200),
  status: z.enum(["SUCCEEDED", "FAILED"]),
  externalRef: z.string().max(200).optional(),
  error: z.string().max(500).optional(),
});

const ACK = { status: 200, contentType: "application/json", body: '{"ok":true}' };

function parseEvent(body: string) {
  try {
    return eventSchema.safeParse(JSON.parse(body));
  } catch {
    return null;
  }
}

export const mockProvider: PaymentProvider = {
  name: "mock",
  isTest: true,
  hold: async (r) => ok(r.idempotencyKey),
  release: async (r) => ok(r.idempotencyKey),
  split: async (r) => ({ master: ok(r.master.idempotencyKey), platform: ok(r.platform.idempotencyKey) }),
  refund: async (r) => ok(r.idempotencyKey),
  getStatus: async (r) => ok(r.idempotencyKey),
  handleWebhook: async ({ headers, body }): Promise<WebhookResult> => {
    if (!verified(headers, body, new Date())) return { kind: "rejected", reason: "bad signature" };
    const parsed = parseEvent(body);
    if (!parsed?.success) return { kind: "rejected", reason: "bad payload" };
    const e = parsed.data;
    const result: ProviderResult =
      e.status === "SUCCEEDED" ? { status: "SUCCEEDED", externalRef: e.externalRef ?? refOf(e.idempotencyKey) } : { status: "FAILED", error: e.error ?? "declined" };
    return { kind: "settled", externalEventId: `mock:${e.eventId}`, idempotencyKey: e.idempotencyKey, result, response: ACK };
  },
};
