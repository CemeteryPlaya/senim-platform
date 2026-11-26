import type { DealStatus } from "@/generated/prisma/enums";
import { ACTIVE_DEAL } from "@/features/deal-progress/active-deal";
import { ru } from "@/i18n/ru";
import type { ChipItem } from "@/kit";
import type { NextStep } from "@/modules/deal-core";
import type { MoneyBlock } from "@/modules/payments";
import { dealChip, dealMoneyLine, dealProgress, progressCaption, quietChip, stoppedLabel, type DealChip, type DealMoneyLine } from "../../_parts/deal-summary";
import { to } from "../../../_shell/paths";
import type { DealSide } from "../../../_shell/side";

// Вид списка «Сделки» стороны (чистая функция, без React и базы): группы чипами («Идут» / «Завершены»), карточки сделок,
// пустые состояния. Страница читает модули и отдаёт сюда готовые данные; тексты — `ru.app.deal.list` (общие), плашка,
// ход и строка денег — по стороне (`deal-summary`).

const t = ru.app.deal.list;

/** Сделка стороны в том объёме, что нужен списку (подмножество `listDeals`; смета — своя у стороны). Порядок — как отдал модуль. */
export type ListDealInput = {
  id: string;
  title: string;
  status: DealStatus;
  hasOpenDispute: boolean;
  money: MoneyBlock;
  estimate: { totalTiyn: bigint };
  paymentProvider: string;
};

export type DealGroup = "active" | "done";

export type DealCardView = {
  id: string;
  href: string;
  title: string;
  /**
   * Плашка — общая `dealChip`, но только когда она говорит что-то сверх хода и денег на карточке: нужен шаг человека,
   * ждём другую сторону, спор, возврат, итог. Обычный ход («Деньги под защитой», «Мастер делает мебель», «В работе»…)
   * не подписывается: его уже называют строка хода и строка денег (`null` — плашки нет).
   */
  chip: DealChip | null;
  /**
   * Ход: строка «Шаг N из M: …» с полосой или строка остановки (спор, отмена); у возврата строки нет — о нём говорят
   * плашка и строка денег («N ₸ вернулись вам»), третий повтор не нужен.
   */
  progress: { kind: "steps"; caption: string; done: number; total: number } | { kind: "stopped"; label: string } | null;
  /** Строка денег из журнала: сумма (если есть) и подпись. */
  money: DealMoneyLine;
};

export type DealListView = {
  group: DealGroup;
  chips: ChipItem[];
  cards: DealCardView[];
  /** `none` — сделок нет совсем (обучающий экран), `group` — пуста выбранная группа, `null` — есть что показать. */
  empty: "none" | "group" | null;
};

export const groupHref = (group: DealGroup): string => `${to("/deals")}?${new URLSearchParams({ group })}`;

const groupOf = (status: DealStatus): DealGroup => (ACTIVE_DEAL.has(status) ? "active" : "done");

/** Выбранная группа: из адреса, иначе «Идут», а когда идущих нет, но есть завершённые, — «Завершены». */
function chosenGroup(raw: string | undefined, counts: Record<DealGroup, number>): DealGroup {
  if (raw === "active" || raw === "done") return raw;
  return counts.active === 0 && counts.done > 0 ? "done" : "active";
}


/**
 * Карточка сделки: плашка называет шаг, когда от человека что-то нужно (тоже она), поэтому отдельного признака «нужно ваше
 * действие» нет; у обычного хода плашки нет.
 * `bankWait` — оплата закрыта до согласия для банка: у покупателя — согласия мастера, у мастера — своего.
 */
function cardOf(deal: ListDealInput, next: NextStep | null, bankWait: boolean, side: DealSide): DealCardView {
  const progress = dealProgress(deal.status, deal.hasOpenDispute);
  const bank = side === "CLIENT" ? { payWaitsMaster: bankWait } : { consentMissing: bankWait };
  return {
    id: deal.id,
    href: to(`/deals/${encodeURIComponent(deal.id)}`),
    title: deal.title,
    chip: quietChip(dealChip({ ...deal, side, next, ...bank })),
    progress:
      progress.kind === "steps"
        ? { kind: "steps", caption: progressCaption(progress, side) ?? "", done: progress.done, total: progress.total }
        : progress.reason === "refunded"
          ? null
          : { kind: "stopped", label: stoppedLabel(progress.reason, side) },
    money: dealMoneyLine(deal.money, deal.estimate, side),
  };
}

/**
 * Список сделок стороны: группы «Идут» (`ACTIVE_DEAL`) и «Завершены» (завершённые, отменённые, с возвратом), карточки
 * выбранной группы. `nexts` — «что дальше» по сделкам из модуля; нет записи — признака действия нет. `bankWaits` — сделки,
 * где оплата закрыта до согласия для банка: покупателю — согласия мастера (`payWaitingMaster`), мастеру — своего
 * (`consentMissingOf`). `side` — чьими глазами (по умолчанию покупатель).
 */
export function dealListView(
  deals: readonly ListDealInput[],
  nexts: ReadonlyMap<string, NextStep>,
  rawGroup: string | undefined,
  bankWaits: ReadonlySet<string> = new Set(),
  side: DealSide = "CLIENT",
): DealListView {
  const counts: Record<DealGroup, number> = { active: 0, done: 0 };
  for (const d of deals) counts[groupOf(d.status)] += 1;
  const group = chosenGroup(rawGroup, counts);
  if (deals.length === 0) return { group, chips: [], cards: [], empty: "none" };
  const chips: ChipItem[] = (["active", "done"] as const).map((g) => ({ href: groupHref(g), label: t.groups[g](counts[g]), active: g === group }));
  const cards = deals.filter((d) => groupOf(d.status) === group).map((d) => cardOf(d, nexts.get(d.id) ?? null, bankWaits.has(d.id), side));
  return { group, chips, cards, empty: cards.length === 0 ? "group" : null };
}
