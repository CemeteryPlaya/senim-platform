import "server-only";
import { db, type Db } from "@/platform/db";
import { env } from "@/platform/env";
import { fail } from "@/platform/errors";
import { mockSmsProvider, type SmsProvider } from "./sms";

export type { SmsProvider } from "./sms";

export type NotifyInput = {
  userId: string;
  kind: string; // ключ шаблона, например «offer.received»
  title: string;
  body: string;
  link?: string;
};

/** In-app уведомление. Вызывать в той же транзакции, что и изменение состояния. */
export async function notify(tx: Db, input: NotifyInput): Promise<void> {
  await tx.notification.create({ data: input });
}

export async function listNotifications(userId: string, limit = 30) {
  return db.notification.findMany({ where: { userId }, orderBy: { createdAt: "desc" }, take: limit });
}

export async function unreadCount(userId: string) {
  return db.notification.count({ where: { userId, readAt: null } });
}

export async function markAllRead(userId: string) {
  await db.notification.updateMany({ where: { userId, readAt: null }, data: { readAt: new Date() } });
}

export function smsProvider(): SmsProvider {
  switch (env().SMS_PROVIDER) {
    case "mock":
      return mockSmsProvider;
    case "http":
      return fail.unavailable("SMS-шлюз ещё не подключён");
  }
}

export const jobHandlers = {} as const;
