import { z } from "zod";
import { ru } from "@/i18n/ru";
import type { EmailMessage, EmailResult } from "@/modules/notifications";
import { db, type Db } from "@/platform/db";
import type { JobHandler } from "@/platform/jobs";

/**
 * Отправка подписанного акта обеим сторонам на e-mail (ТЗ п. 7) — фоновой задачей после подписи:
 * письмо не держит транзакцию подписи и повторяется при сбое почты.
 */
export const EMAIL_ACT_JOB = "documents.emailSignedAct";

/** Отправка письма — notifications.sendEmail (провайдер по EMAIL_PROVIDER, повтор по ключу не шлёт второе письмо). */
export type SendEmail = (message: EmailMessage) => Promise<EmailResult>;

/** E-mail стороны из профиля (User.email, /profile/contacts); не указан — null, письмо этой стороне не уходит. */
export const partyEmail: EmailActDeps["emailOf"] = async (client, userId) => (await client.user.findUnique({ where: { id: userId }, select: { email: true } }))?.email ?? null;

export type EmailActDeps = {
  send: SendEmail;
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
    const parties = [doc.deal.clientId, doc.deal.executor.userId];
    const recipients = (await Promise.all(parties.map(async (userId) => ({ userId, to: await deps.emailOf(db, userId) })))).filter(
      (r): r is { userId: string; to: string } => !!r.to,
    );
    if (recipients.length === 0) {
      ctx.log.info("documents: e-mail сторон не указан — акт не отправлен", { documentId });
      return;
    }
    const copy = await deps.signedCopy(documentId);
    const e = ru.documents.email;
    for (const { userId, to } of recipients) {
      // Ключ на документ и адресата: повтор задачи после сбоя второе письмо не шлёт.
      await deps.send({
        to,
        subject: e.actSubject(doc.number),
        text: e.actBody(doc.number),
        attachments: [{ filename: copy.fileName, contentType: "application/pdf", content: copy.bytes }],
        idempotencyKey: `act:${documentId}:${userId}`,
      });
    }
  };
}
