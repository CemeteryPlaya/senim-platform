import "server-only";
import { notify } from "@/modules/notifications";
import { ru } from "@/i18n/ru";
import type { Tx } from "@/platform/db";
import { fail } from "@/platform/errors";
import { links, requestTitle, type RequestWithType } from "./access";

const e = ru.requests.errors;
const n = ru.requests.notify;

/**
 * Кому заявка откроется: прямой запрос — выбранному подтверждённому исполнителю, тендер — подтверждённым
 * исполнителям сегмента. Себе (тот же человек в роли исполнителя) заявка не рассылается: самосделка запрещена.
 */
export async function executorRecipients(tx: Tx, r: RequestWithType): Promise<string[]> {
  if (r.mode === "DIRECT") {
    const target = r.targetExecutorId
      ? await tx.executorProfile.findFirst({ where: { id: r.targetExecutorId, status: "APPROVED" }, select: { userId: true } })
      : null;
    if (!target) return fail.conflict(e.targetUnavailable);
    if (target.userId === r.clientId) return fail.conflict(e.selfDeal);
    return [target.userId];
  }
  const executors = await tx.executorProfile.findMany({
    where: { status: "APPROVED", segment: r.segment, userId: { not: r.clientId } },
    select: { userId: true },
  });
  return executors.map((x) => x.userId);
}

/** Уведомления исполнителям о заявке, которая стала им видна (OPEN). */
export async function announceToExecutors(tx: Tx, r: RequestWithType, recipients: readonly string[]): Promise<void> {
  const title = requestTitle(r);
  const [kind, text] = r.mode === "DIRECT" ? (["request.direct", n.directRequest] as const) : (["request.new", n.newRequest] as const);
  for (const userId of recipients) {
    await notify(tx, { userId, kind, title: text.title, body: text.body(title), link: links.executor(r.id) });
  }
}
