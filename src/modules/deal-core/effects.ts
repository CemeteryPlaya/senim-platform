import { SYSTEM, type Actor } from "@/modules/audit";
import { notify } from "@/modules/notifications";
import type { Tx } from "@/platform/db";
import { maskContacts, sanitizeExecutorText } from "./ports";
import type { Who } from "./transitions";

/** Общие последствия переходов: уведомления сторонам, тексты сторон. Всё — в транзакции перехода. */

export const SYSTEM_ACTOR: Actor = SYSTEM("deal-core");
export const dealLink = (dealId: string) => `/deals/${dealId}`;

type Party = "CLIENT" | "EXECUTOR";
type DealRef = { id: string; clientId: string; executor: { userId: string } };
type Message = { title: string; body: string };

export async function notifyParty(tx: Tx, deal: DealRef, to: Party, kind: string, msg: Message): Promise<void> {
  const userId = to === "CLIENT" ? deal.clientId : deal.executor.userId;
  await notify(tx, { userId, kind, title: msg.title, body: msg.body, link: dealLink(deal.id) });
}

/** Обеим сторонам — каждой свой текст. */
export async function notifyBoth(tx: Tx, deal: DealRef, kind: string, msg: Record<Party, Message> | Message): Promise<void> {
  for (const to of ["CLIENT", "EXECUTOR"] as const) await notifyParty(tx, deal, to, kind, "title" in msg ? msg : msg[to]);
}

/** Всем действующим операторам — только in-app (готовым текстом: номер сделки собирает deal-core). */
export async function notifyOperators(tx: Tx, kind: string, msg: Message, link: string): Promise<void> {
  const operators = await tx.user.findMany({ where: { roles: { has: "OPERATOR" }, blockedAt: null }, select: { id: true } });
  for (const { id } of operators) await notify(tx, { userId: id, kind, ...msg, link });
}

export const otherParty = (who: Party): Party => (who === "CLIENT" ? "EXECUTOR" : "CLIENT");

/**
 * Текст стороны, который увидит другая сторона (отчёт о ходе работ, спор): без контактов, а у мастера —
 * ещё и без наименования/ФИО. Правило то же, что в чате.
 */
export async function partyText(tx: Tx, deal: { executorId: string }, who: Who, text: string): Promise<string> {
  return who === "EXECUTOR" ? (await sanitizeExecutorText(tx, deal.executorId, text)).text : maskContacts(text).text;
}
