import { z } from "zod";
import { ru } from "@/i18n/ru";
import { db, type Db } from "@/platform/db";
import { env } from "@/platform/env";
import type { JobHandler } from "@/platform/jobs";
import { logger } from "@/platform/logger";

/**
 * Отправка подписанного акта обеим сторонам на e-mail (ТЗ п. 7) — фоновой задачей после подписи:
 * письмо не держит транзакцию подписи и повторяется при сбое почты.
 */
export const EMAIL_ACT_JOB = "documents.emailSignedAct";

export type EmailAttachment = { fileName: string; contentType: string; bytes: Uint8Array };
export type EmailMessage = { to: string; subject: string; text: string; attachments?: EmailAttachment[] };

/**
 * INTEGRATOR: notifications.EmailProvider — заменить на провайдер из notifications (его делает platform-агент),
 * сигнатура та же: send({ to, subject, text, attachments }) → { id }. Пока — mock по EMAIL_PROVIDER:
 * письмо не уходит, в лог пишется только домен адреса и тема (адрес — персональные данные).
 */
export interface EmailProvider {
  readonly name: "mock";
  send(message: EmailMessage): Promise<{ id: string }>;
}

const mockEmail: EmailProvider = {
  name: "mock",
  async send(m) {
    logger.info("email(mock): письмо не отправлено — тестовый провайдер", { toDomain: m.to.split("@")[1] ?? "", subject: m.subject, attachments: m.attachments?.length ?? 0 });
    return { id: `mock-${Date.now()}` };
  },
};

export function emailProvider(): EmailProvider {
  switch (env().EMAIL_PROVIDER) {
    case "mock":
      return mockEmail;
  }
}

/**
 * INTEGRATOR: identity — e-mail стороны. В профиле (User) поля e-mail пока нет: адрес неизвестен,
 * письмо не отправляется (и задача не падает). Когда identity добавит User.email — читать его здесь.
 */
export const partyEmail: EmailActDeps["emailOf"] = async () => null;

export type EmailActDeps = {
  provider: () => EmailProvider;
  emailOf: (client: Db, userId: string) => Promise<string | null>;
  /** Подписанная копия акта (исходный PDF + лист подписей). */
  signedCopy: (documentId: string) => Promise<{ bytes: Uint8Array; fileName: string }>;
};

const payloadSchema = z.object({ documentId: z.string().min(1).max(64) });

/** Задача: акт подписан — подписанная копия обеим сторонам, у кого есть e-mail; у кого нет — пропуск. */
export function createEmailSignedActHandler(deps: EmailActDeps): JobHandler {
  return async (raw, ctx) => {
    const { documentId } = payloadSchema.parse(raw);
    const doc = await db.document.findUnique({
      where: { id: documentId },
      select: { kind: true, status: true, number: true, deal: { select: { clientId: true, executor: { select: { userId: true } } } } },
    });
    if (!doc || doc.kind !== "ACCEPTANCE_ACT" || doc.status !== "SIGNED") return;
    const recipients = (await Promise.all([doc.deal.clientId, doc.deal.executor.userId].map((id) => deps.emailOf(db, id)))).filter((e): e is string => !!e);
    if (recipients.length === 0) {
      ctx.log.info("documents: e-mail сторон не указан — акт не отправлен", { documentId });
      return;
    }
    const copy = await deps.signedCopy(documentId);
    const e = ru.documents.email;
    const provider = deps.provider();
    for (const to of recipients) {
      await provider.send({ to, subject: e.actSubject(doc.number), text: e.actBody(doc.number), attachments: [{ fileName: copy.fileName, contentType: "application/pdf", bytes: copy.bytes }] });
    }
  };
}
