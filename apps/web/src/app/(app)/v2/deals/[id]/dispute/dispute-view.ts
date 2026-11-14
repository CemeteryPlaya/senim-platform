import type { MoneyBlock } from "@/modules/payments";

/** Границы текста спора и позиции — те же, что у модуля deal-core (сверяет `dispute-view.test.ts`). */
export const TEXT_MIN = 10;
export const TEXT_MAX = 2000;
/** Сколько фото можно приложить к спору (модуль принимает до 12). */
export const MAX_PHOTOS = 5;

/** Какой экран показать по состоянию спора: форма, открытый, решённый или карточка сделки. */
export type DisputeScreen = "form" | "open" | "resolved" | "back";

/**
 * Открытый спор — всегда его состояние. Иначе, если модуль разрешает открыть (`can.openDispute`), — форма (в том числе
 * после решённого спора «сделка продолжается»). Иначе решённый спор — его итог; спора нет и открыть нельзя — карточка.
 */
export function disputeScreen(dispute: { status: "OPEN" | "RESOLVED" } | null, canOpen: boolean): DisputeScreen {
  if (dispute?.status === "OPEN") return "open";
  if (canOpen) return "form";
  return dispute ? "resolved" : "back";
}

/** Текст достаточной длины для отправки (короче границы модуля — до отправки покажем подсказку). */
export const textValid = (text: string): boolean => text.trim().length >= TEXT_MIN;

/**
 * Сумма, которая по решению спора вернулась покупателю, — из журнала (`moneyBlock`), ничего не считается. Доля мастера и
 * доход сервиса покупателю не показываются. Пока возврат не проведён или его нет — `null`.
 */
export function resolvedRefund(block: MoneyBlock): bigint | null {
  if (block.kind === "completed") return block.refundedTiyn > 0n ? block.refundedTiyn : null;
  if (block.kind === "refunded") return block.amountTiyn;
  return null;
}
