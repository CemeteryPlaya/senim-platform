import { DisputeReason } from "@/generated/prisma/enums";
import { ru } from "@/i18n/ru";
import type { MoneyBlock } from "@/modules/payments";
import type { DealSide } from "../../../../_shell/side";

/** Тексты спора по стороне: покупатель — `ru.app.deal.dispute`, мастер — `ru.app.masterDispute` (структура общая). */
export const disputeTexts = (side: DealSide) => (side === "CLIENT" ? ru.app.deal.dispute : ru.app.masterDispute);

/**
 * Кто открыл последний спор — по истории сделки (`dispute.opened`, актёр): `null`, если события нет. Причину спора
 * показываем словами открывшей стороны: покупатель не видит обвинения мастера, которого тот не выдвигал, и наоборот.
 */
export function disputeOpenedBy(history: readonly { action: string; actorRole: string }[]): DealSide | null {
  const role = history.filter((e) => e.action === "dispute.opened").at(-1)?.actorRole;
  return role === "CLIENT" || role === "EXECUTOR" ? role : null;
}

/** Причина спора словами открывшей стороны (неизвестно кто — словами покупателя, как было). */
export function reasonText(reason: DisputeReason, openedBy: DealSide | null): string {
  return (openedBy === "EXECUTOR" ? ru.app.masterDispute.reasons : ru.app.deal.dispute.reasons)[reason];
}

/** Позиции спора: своя и другой стороны — по стороне смотрящего. */
export function positionsOf(side: DealSide, dispute: { clientPosition: string | null; executorPosition: string | null }): { mine: string | null; other: string | null } {
  return side === "CLIENT" ? { mine: dispute.clientPosition, other: dispute.executorPosition } : { mine: dispute.executorPosition, other: dispute.clientPosition };
}

/** Границы текста спора и позиции — те же, что у модуля deal-core (сверяет `dispute-view.test.ts`). */
export const TEXT_MIN = 10;
export const TEXT_MAX = 2000;
/** Сколько фото можно приложить к спору (модуль принимает до 12). */
export const MAX_PHOTOS = 5;

/** Причины спора — перечисление модуля (`DisputeReason`); текст каждой — `ru.app.deal.dispute.reasons[причина]` (сверяет тест). */
export const REASONS: readonly DisputeReason[] = Object.values(DisputeReason);

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

/**
 * Сумма, которую по решению спора получает мастер, — из журнала (`moneyBlock`, часть оплаты мастеру): только при разделе
 * (часть вернулась покупателю). Полный возврат — мастеру ничего (строки нет), сделка продолжается — оплата как обычно, не
 * решение. Суммы покупателя (возврат, защита) мастеру не показываются.
 */
export function resolvedShare(block: MoneyBlock): bigint | null {
  return block.kind === "completed" && block.refundedTiyn > 0n ? block.paidToMasterTiyn : null;
}
