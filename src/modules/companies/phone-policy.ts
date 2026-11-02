import { ru } from "@/i18n/ru";
import { fail } from "@/platform/errors";
import type { ChatClosedReason, ChatParty } from "./chat-policy";
import type { ContactStage } from "./contacts-policy";

/**
 * Телефон заказчика исполнителю отклика ДО оферты (ответ №21, ADR-008): по согласию заказчика и
 * только после переписки в чате этого отклика. ТЗ п. 3 скрывает контакты до оферты, поэтому путь —
 * под флагом clientPhoneConsent (по умолчанию выключен): без флага кнопки нет, вызов — FORBIDDEN.
 * После оферты согласие не нужно: контакты обеих сторон видны по contacts-policy.ts.
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
 * отменена или с возвратом, чат закрыт оператором). Пока чат закрыт, показать номер нельзя, а
 * показанный не виден исполнителю. consentEnabled — флаг clientPhoneConsent; stage — заключена ли оферта.
 * Скрыть можно всегда.
 */
export type ClientPhoneFacts = { state: ClientPhoneState; talked: boolean; chatClosed: ChatClosedReason | null; consentEnabled: boolean; stage: ContactStage };

const t = ru.companies.chat;

/**
 * Куда ведёт действие. Порядок проверок: сторона и флаг — FORBIDDEN; оферта заключена, не то состояние
 * (повтор, двойной клик), закрытый чат, нет переписки — CONFLICT.
 */
export function clientPhoneTarget(action: ClientPhoneAction, facts: ClientPhoneFacts, who: ChatParty): ClientPhoneState {
  const rule = CLIENT_PHONE[action];
  if (who !== rule.who) return fail.forbidden();
  if (action === "share" && !facts.consentEnabled) return fail.forbidden(t.phone.errors.disabled);
  if (action === "share" && facts.stage === "AFTER_OFFER") return fail.conflict(t.phone.errors.afterOffer);
  if (facts.state !== rule.from) return fail.conflict(t.phone.errors[action]);
  if (action === "share" && facts.chatClosed) return fail.conflict(t.closed[facts.chatClosed]);
  if (action === "share" && !facts.talked) return fail.conflict(t.phone.errors.notTalked);
  return rule.to;
}

/** Путь согласия вообще действует: флаг включён и оферта ещё не заключена. */
export function consentPathOpen(facts: Pick<ClientPhoneFacts, "consentEnabled" | "stage">): boolean {
  return facts.consentEnabled && facts.stage === "BEFORE_OFFER";
}

/** Показывать ли заказчику кнопку «Показать мой телефон исполнителю». */
export function canShareClientPhone(facts: ClientPhoneFacts): boolean {
  return consentPathOpen(facts) && facts.state === "HIDDEN" && facts.talked && facts.chatClosed === null;
}

/** Видит ли исполнитель отклика номер заказчика по согласию (до оферты). */
export function executorSeesClientPhone(facts: Omit<ClientPhoneFacts, "talked">): boolean {
  return consentPathOpen(facts) && facts.state === "SHOWN" && facts.chatClosed === null;
}
