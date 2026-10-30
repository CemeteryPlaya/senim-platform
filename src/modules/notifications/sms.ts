import { logger } from "@/platform/logger";

/** Отправка SMS. mock пишет в лог, http — скелет под казахстанского провайдера (провайдер ещё не выбран). */
export interface SmsProvider {
  readonly name: "mock" | "http";
  /** idempotencyKey — повтор задачи после сбоя не должен дать второе SMS, если шлюз умеет дедупликацию. */
  send(input: { phone: string; text: string; idempotencyKey?: string }): Promise<{ providerMessageId: string }>;
}

export const mockSmsProvider: SmsProvider = {
  name: "mock",
  async send({ text, idempotencyKey }) {
    // Телефон в лог не пишем (logger скрывает phone); текст SMS в моке — это и есть демо-код.
    logger.info("sms.mock.sent", { text });
    return { providerMessageId: idempotencyKey ? `mock-${idempotencyKey}` : `mock-${Date.now()}` };
  },
};

export type HttpSmsConfig = { url: string; token: string; sender: string };
type FetchFn = (url: string | URL | Request, init?: RequestInit) => Promise<Response>;

/**
 * Универсальный HTTP-шлюз: POST JSON { to, text, sender } с Bearer-токеном из SMS_HTTP_TOKEN
 * и заголовком Idempotency-Key. Ответ 2xx — успех; id сообщения берётся из JSON-поля id, если оно есть.
 * TODO(владелец): провайдер SMS ещё не выбран. Когда будет документация — привести формат запроса,
 * авторизацию, разбор ответа и коды ошибок к его API (API не выдумываем, это только общий каркас).
 */
export function createHttpSmsProvider(config: HttpSmsConfig, fetchFn: FetchFn = fetch): SmsProvider {
  return {
    name: "http",
    async send({ phone, text, idempotencyKey }) {
      const headers: Record<string, string> = { authorization: `Bearer ${config.token}`, "content-type": "application/json" };
      if (idempotencyKey) headers["idempotency-key"] = idempotencyKey;
      const response = await fetchFn(config.url, {
        method: "POST",
        headers,
        body: JSON.stringify({ to: phone, text, sender: config.sender }),
        signal: AbortSignal.timeout(10_000),
      });
      // Текст SMS (в нём может быть код) в ошибку и лог не попадает.
      if (!response.ok) throw new Error(`SMS-шлюз ответил ${response.status}`);
      const body: unknown = await response.json().catch(() => null);
      const id = body && typeof body === "object" && "id" in body ? String(body.id) : null;
      return { providerMessageId: id ?? `http-${idempotencyKey ?? Date.now()}` };
    },
  };
}
