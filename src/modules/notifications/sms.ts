import { logger } from "@/platform/logger";

/** Отправка SMS. mock пишет в лог, http — скелет под казахстанского провайдера (фаза B). */
export interface SmsProvider {
  readonly name: "mock" | "http";
  send(input: { phone: string; text: string }): Promise<{ providerMessageId: string }>;
}

export const mockSmsProvider: SmsProvider = {
  name: "mock",
  async send({ text }) {
    // Телефон в лог не пишем (logger скрывает phone); текст SMS в моке — это и есть демо-код.
    logger.info("sms.mock.sent", { text });
    return { providerMessageId: `mock-${Date.now()}` };
  },
};
