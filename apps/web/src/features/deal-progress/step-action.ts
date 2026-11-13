import type { BankConsentState, DealView } from "@/modules/deal-core";

/**
 * Шаг закрыт до отметки о передаче данных банку-партнёру: мастеру — подпись оферты (своя отметка), покупателю — оплата
 * (обе отметки: payForDeal иначе откажет BANK_CONSENT_MISSING).
 */
export function bankLocked(deal: DealView, bank: BankConsentState | null): boolean {
  if (!bank) return false;
  if (deal.viewer === "EXECUTOR" && deal.next.action === "signContract") return !bank.mine;
  if (deal.viewer === "CLIENT" && deal.next.action === "pay") return !bank.mine || !bank.other;
  return false;
}

/**
 * Шаг смотрящего, который есть действие одной кнопкой (deal-core.nextStep), без разметки: null — действия нет
 * (ждём другую сторону или банк, шаг закрыт отметкой банка) или оно — форма в «Что дальше».
 * Разметку кнопки по этому значению строит экран.
 */
export function stepActionKind(deal: DealView, bank: BankConsentState | null): DealView["next"]["action"] | null {
  if (!deal.next.mine) return null;
  if (bankLocked(deal, bank)) return null;
  return deal.next.action;
}
