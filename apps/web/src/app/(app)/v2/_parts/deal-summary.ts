import type { DealStatus } from "@/generated/prisma/enums";
import { dealProgressView } from "@/features/deal-progress/deal-progress";
import { ru } from "@/i18n/ru";
import type { StepState } from "@/kit";
import type { NextAction, NextStep } from "@/modules/deal-core";

/**
 * Сделка покупателя коротко — общее для главной, списка «Сделки» и карточки сделки (чистые функции без React и базы):
 * ход сделки, тон и текст плашки статуса. Одно правило в одном месте: главная, список и карточка говорят одно и то же.
 */

const s = ru.app.buyer.home.deal;

/** Шаги сделки по-человечески; до подписи оферты первый шаг называется шире — «Оферта и оплата». */
function stepNames(action: NextAction | null): readonly string[] {
  return action === "signContract" || action === "waitContractSignature" ? [s.offerStep, ...s.steps.slice(1)] : s.steps;
}

export type DealProgress =
  | { kind: "steps"; /** Сколько шагов пройдено: номер текущего шага минус один; равен `total`, когда пройдены все. */ done: number; total: number }
  | { kind: "stopped"; reason: "dispute" | "cancelled" | "refunded" };

/** Ход сделки для компактной карточки: сколько шагов из пяти пройдено; спор, отмена и возврат — «остановлено». */
export function dealProgress(status: DealStatus, hasOpenDispute: boolean): DealProgress {
  const view = dealProgressView(status, hasOpenDispute);
  if (view.kind === "banner") return { kind: "stopped", reason: view.tone };
  if (view.muted) return { kind: "stopped", reason: "dispute" };
  return { kind: "steps", done: view.current, total: s.steps.length };
}

/** Строка хода компактной карточки: «Шаг 2 из 5: Изготовление» или «Все шаги пройдены»; остановленной — `null`. */
export function progressCaption(progress: DealProgress, action: NextAction | null): string | null {
  if (progress.kind === "stopped") return null;
  if (progress.done >= progress.total) return s.allDone;
  return s.caption(progress.done + 1, progress.total, stepNames(action)[progress.done] ?? "");
}

/** Подпись остановленного хода: спор, отмена, возврат. */
export const stoppedLabel = (reason: Extract<DealProgress, { kind: "stopped" }>["reason"]): string => s.stopped[reason];

export type DealStepsView = { kind: "steps"; items: { label: string; state: StepState }[] } | { kind: "stopped"; label: string };

/** Полный ход сделки для `Steps` карточки: пять шагов с отметками; спор, отмена и возврат — строка вместо шкалы. */
export function dealStepsView(status: DealStatus, hasOpenDispute: boolean, action: NextAction | null): DealStepsView {
  const progress = dealProgress(status, hasOpenDispute);
  if (progress.kind === "stopped") return { kind: "stopped", label: stoppedLabel(progress.reason) };
  const items = stepNames(action).map((label, index) => {
    const state: StepState = index < progress.done ? "done" : index === progress.done ? "current" : "todo";
    return { label, state };
  });
  return { kind: "steps", items };
}

export type DealTone = "accent" | "neutral" | "warn";

/**
 * Тон плашки статуса сделки. Зелёный — только когда деньги уже в банке под защитой или работа идёт к концу (оплачено);
 * сделка, которая ждёт оплаты, — нейтральная; ждёт моего действия или спор — «внимание»; отмена и возврат — нейтральные.
 */
export function dealTone(deal: { status: DealStatus; hasOpenDispute: boolean; next: Pick<NextStep, "mine"> | null }): DealTone {
  if (deal.hasOpenDispute || deal.next?.mine === true) return "warn";
  if (deal.status === "CANCELLED" || deal.status === "REFUNDED" || deal.status === "CREATED") return "neutral";
  return "accent";
}

/** Текст плашки статуса: открытый спор важнее статуса. */
export function dealStatusText(status: DealStatus, hasOpenDispute: boolean): string {
  return hasOpenDispute ? ru.app.deal.status.dispute : ru.app.deal.status[status];
}
