import type { DealStatus } from "@/generated/prisma/enums";
import { homeDealMoney, type HomeDealMoney } from "@/features/deal-money/home-deal-money";
import { ACTIVE_DEAL } from "@/features/deal-progress/active-deal";
import { ru } from "@/i18n/ru";
import type { ChipItem } from "@/kit";
import type { NextAction, NextStep } from "@/modules/deal-core";
import type { MoneyBlock } from "@/modules/payments";
import { dealProgress, dealStatusText, dealTone, progressCaption, stoppedLabel, type DealTone } from "../../_parts/deal-summary";
import { to } from "../../../_shell/paths";

// Вид списка «Сделки» покупателя (чистая функция, без React и базы): группы чипами («Идут» / «Завершены»), карточки
// сделок, пустые состояния. Страница читает модули и отдаёт сюда готовые данные; тексты — `ru.app.deal.list`.

const t = ru.app.deal.list;

/** Сделка покупателя в том объёме, что нужен списку (подмножество `listDeals`). Порядок — как отдал модуль. */
export type ListDealInput = {
  id: string;
  title: string;
  status: DealStatus;
  hasOpenDispute: boolean;
  money: MoneyBlock;
  estimate: { totalTiyn: bigint };
};

export type DealGroup = "active" | "done";

export type DealCardView = {
  id: string;
  href: string;
  title: string;
  chip: { text: string; tone: DealTone };
  /** Ход: строка «Шаг N из M: …» с полосой или строка остановки (спор, отмена, возврат). */
  progress: { kind: "steps"; caption: string; done: number; total: number } | { kind: "stopped"; label: string };
  /** Строка денег из журнала: сумма (если есть) и подпись. */
  money: HomeDealMoney;
  /** «Нужно ваше действие»: что именно; `null` — от человека ничего не нужно (или неизвестно). */
  mine: string | null;
};

export type DealListView = {
  group: DealGroup;
  chips: ChipItem[];
  cards: DealCardView[];
  /** `none` — сделок нет совсем (обучающий экран), `group` — пуста выбранная группа, `null` — есть что показать. */
  empty: "none" | "group" | null;
};

/** Действия покупателя, о которых говорит признак на карточке. */
const MINE: Partial<Record<NextAction, string>> = t.mine;

export const groupHref = (group: DealGroup): string => `${to("/deals")}?${new URLSearchParams({ group })}`;

const groupOf = (status: DealStatus): DealGroup => (ACTIVE_DEAL.has(status) ? "active" : "done");

/** Выбранная группа: из адреса, иначе «Идут», а когда идущих нет, но есть завершённые, — «Завершены». */
function chosenGroup(raw: string | undefined, counts: Record<DealGroup, number>): DealGroup {
  if (raw === "active" || raw === "done") return raw;
  return counts.active === 0 && counts.done > 0 ? "done" : "active";
}

function cardOf(deal: ListDealInput, next: NextStep | null): DealCardView {
  const progress = dealProgress(deal.status, deal.hasOpenDispute);
  const action = next?.action ?? null;
  return {
    id: deal.id,
    href: to(`/deals/${encodeURIComponent(deal.id)}`),
    title: deal.title,
    chip: { text: dealStatusText(deal.status, deal.hasOpenDispute), tone: dealTone({ ...deal, next }) },
    progress:
      progress.kind === "steps"
        ? { kind: "steps", caption: progressCaption(progress, action) ?? "", done: progress.done, total: progress.total }
        : { kind: "stopped", label: stoppedLabel(progress.reason) },
    money: homeDealMoney(deal.money, deal.estimate),
    mine: next?.mine && action ? (MINE[action] ?? null) : null,
  };
}

/**
 * Список сделок покупателя: группы «Идут» (`ACTIVE_DEAL`) и «Завершены» (завершённые, отменённые, с возвратом), карточки
 * выбранной группы. `nexts` — «что дальше» по сделкам из модуля; нет записи — признака действия нет.
 */
export function dealListView(deals: readonly ListDealInput[], nexts: ReadonlyMap<string, NextStep>, rawGroup: string | undefined): DealListView {
  const counts: Record<DealGroup, number> = { active: 0, done: 0 };
  for (const d of deals) counts[groupOf(d.status)] += 1;
  const group = chosenGroup(rawGroup, counts);
  if (deals.length === 0) return { group, chips: [], cards: [], empty: "none" };
  const chips: ChipItem[] = (["active", "done"] as const).map((g) => ({ href: groupHref(g), label: t.groups[g](counts[g]), active: g === group }));
  const cards = deals.filter((d) => groupOf(d.status) === group).map((d) => cardOf(d, nexts.get(d.id) ?? null));
  return { group, chips, cards, empty: cards.length === 0 ? "group" : null };
}
