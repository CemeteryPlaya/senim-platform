import "server-only";
import { VISIBLE_EXECUTOR } from "@/modules/companies";
import { notify } from "@/modules/notifications";
import { ru } from "@/i18n/ru";
import type { Tx } from "@/platform/db";
import { fail } from "@/platform/errors";
import { links, requestTitle, type RequestWithType } from "./access";

const e = ru.requests.errors;
const n = ru.requests.notify;

/**
 * Кому заявка откроется: прямой запрос — выбранному исполнителю, тендер — исполнителям сегмента; в обоих случаях — по
 * правилу видимости companies (`VISIBLE_EXECUTOR`: подтверждён и не заблокирован — то же, что у каталога, «Хочу похожее»
 * и прямой заявки по номеру). Заблокированный после создания черновика исполнитель прямую заявку не получает — отказ, как
 * у отклонённого. Себе (тот же человек в роли исполнителя) заявка не рассылается: самосделка запрещена.
 */
export async function executorRecipients(tx: Tx, r: RequestWithType): Promise<string[]> {
  if (r.mode === "DIRECT") {
    const target = r.targetExecutorId
      ? await tx.executorProfile.findFirst({ where: { id: r.targetExecutorId, ...VISIBLE_EXECUTOR }, select: { userId: true } })
      : null;
    if (!target) return fail.conflict(e.targetUnavailable);
    if (target.userId === r.clientId) return fail.conflict(e.selfDeal);
    return [target.userId];
  }
  const executors = await tx.executorProfile.findMany({
    where: { ...VISIBLE_EXECUTOR, segment: r.segment, userId: { not: r.clientId } },
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
