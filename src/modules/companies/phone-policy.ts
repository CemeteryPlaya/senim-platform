import { ru } from "@/i18n/ru";
import { fail } from "@/platform/errors";
import type { ChatClosedReason, ChatParty } from "./chat-policy";

/**
 * Телефон заказчика исполнителю отклика (ответ №21, ADR-008): только по согласию заказчика
 * и только после переписки в чате этого отклика. Телефон исполнителя не раскрывается нигде.
 * Состояние — Offer.clientPhoneSharedAt (null — HIDDEN).
 */
export type ClientPhoneState = "HIDDEN" | "SHOWN";
export type ClientPhoneAction = "share" | "revoke";

export const CLIENT_PHONE = {
  share: { from: "HIDDEN", to: "SHOWN", who: "client" },
  revoke: { from: "SHOWN", to: "HIDDEN", who: "client" },
} as const satisfies Record<ClientPhoneAction, { from: ClientPhoneState; to: ClientPhoneState; who: ChatParty }>;

/**
 * talked — в чате есть хотя бы одно сообщение заказчика и хотя бы одно исполнителя.
 * chatClosed — почему в чат нельзя писать (отклик отозван или отклонён, заявка отменена, сделка
 * отменена или расторгнута, чат закрыт оператором). Пока чат закрыт, показать номер нельзя, а
 * показанный не виден исполнителю; скрыть можно всегда.
 */
export type ClientPhoneFacts = { state: ClientPhoneState; talked: boolean; chatClosed: ChatClosedReason | null };

const t = ru.companies.chat;

/** Куда ведёт действие; не та сторона — FORBIDDEN, не то состояние (повтор, двойной клик) или условие не выполнено — CONFLICT. */
export function clientPhoneTarget(action: ClientPhoneAction, facts: ClientPhoneFacts, who: ChatParty): ClientPhoneState {
  const rule = CLIENT_PHONE[action];
  if (who !== rule.who) return fail.forbidden();
  if (facts.state !== rule.from) return fail.conflict(t.phone.errors[action]);
  if (action === "share" && facts.chatClosed) return fail.conflict(t.closed[facts.chatClosed]);
  if (action === "share" && !facts.talked) return fail.conflict(t.phone.errors.notTalked);
  return rule.to;
}

/** Показывать ли заказчику кнопку «Показать мой телефон исполнителю». */
export function canShareClientPhone(facts: ClientPhoneFacts): boolean {
  return facts.state === "HIDDEN" && facts.talked && facts.chatClosed === null;
}

/** Видит ли исполнитель отклика номер заказчика. */
export function executorSeesClientPhone(facts: Pick<ClientPhoneFacts, "state" | "chatClosed">): boolean {
  return facts.state === "SHOWN" && facts.chatClosed === null;
}
