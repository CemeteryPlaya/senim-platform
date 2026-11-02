import { z } from "zod";
import { hashPii } from "@/platform/crypto";
import { env } from "@/platform/env";
import { logger } from "@/platform/logger";
import { parseInput } from "@/platform/validation";

/**
 * Письма (ТЗ п. 7: акт приёмки обеим сторонам). Выбор — EMAIL_PROVIDER (env.ts): пока только mock.
 * TODO(владелец): почтовый сервис не выбран. Когда будет его документация — добавить провайдер
 * с этим интерфейсом (ключ идемпотентности — в заголовок, который сервис поддерживает); API не выдумываем.
 */

export type EmailAttachment = { filename: string; contentType: string; content: Uint8Array };
export type EmailMessage = {
  to: string;
  subject: string;
  text: string;
  attachments?: readonly EmailAttachment[];
  /** Одно письмо на ключ: повтор задачи после сбоя не отправляет второе (например, «act:<documentId>:<userId>»). */
  idempotencyKey: string;
};
export type EmailResult = { providerMessageId: string; duplicate: boolean };

export interface EmailProvider {
  readonly name: "mock";
  send(message: EmailMessage): Promise<EmailResult>;
}

/** Письмо в журнал разработки. Без адреса, текста и вложений: только хэш адресата, тема и размеры. */
export function createMockEmailProvider(): EmailProvider {
  const sent = new Map<string, string>();
  return {
    name: "mock",
    async send(message) {
      const known = sent.get(message.idempotencyKey);
      if (known) return { providerMessageId: known, duplicate: true };
      const providerMessageId = `mock-email-${sent.size + 1}`;
      sent.set(message.idempotencyKey, providerMessageId);
      logger.info("email.mock.sent", {
        toHash: hashPii(message.to.toLowerCase()).slice(0, 16),
        subject: message.subject,
        textLength: message.text.length,
        attachments: (message.attachments ?? []).map((a) => ({ filename: a.filename, contentType: a.contentType, bytes: a.content.byteLength })),
      });
      return { providerMessageId, duplicate: false };
    },
  };
}

const mockEmailProvider = createMockEmailProvider();

export function emailProvider(): EmailProvider {
  switch (env().EMAIL_PROVIDER) {
    case "mock":
      return mockEmailProvider;
  }
}

/** Вложения письма — до 10 МБ вместе: акт и выписка — сотни килобайт. */
const MAX_ATTACHMENTS_BYTES = 10 * 1024 * 1024;

const emailSchema = z.object({
  to: z.email().max(254),
  subject: z.string().trim().min(1).max(200),
  text: z.string().min(1).max(20_000),
  attachments: z
    .array(z.object({ filename: z.string().min(1).max(200), contentType: z.string().min(1).max(100), content: z.instanceof(Uint8Array) }))
    .max(5)
    .refine((list) => list.reduce((sum, a) => sum + a.content.byteLength, 0) <= MAX_ATTACHMENTS_BYTES)
    .optional(),
  idempotencyKey: z.string().min(1).max(200),
});

/**
 * Отправить письмо. Вызывать вне транзакции БД — из фоновой задачи (Job с dedupeKey) или после коммита:
 * откат не может вернуть уже ушедшее письмо. Повтор с тем же ключом письмо второй раз не шлёт.
 */
export async function sendEmail(message: EmailMessage, provider: EmailProvider = emailProvider()): Promise<EmailResult> {
  return provider.send(parseInput(emailSchema, message));
}
