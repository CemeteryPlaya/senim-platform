import type { DealListItem } from "@/modules/deal-core";
import type { IncomingListItem, MyOfferItem } from "@/modules/requests";
import { ACTIVE_DEAL } from "@/features/deal-progress/active-deal";

/**
 * Чистая логика экранов мастера: входящие заявки (фильтр, сводка) и «Мои предложения» (группы).
 * Без текстов: подписи чипов и статусов — у экрана.
 */

/** Параметры адреса входящих: `?f=new|direct` или `?type=<название типа>`. */
export type IncomingSearch = { f?: string; type?: string };

export type IncomingFilter = { key: string; keep: (r: IncomingListItem) => boolean };

/** Выбранный чип из адреса: раздел (без отклика, прямые) или тип мебели; неизвестное — «Все». */
export function selectedIncoming(sp: IncomingSearch, list: readonly Pick<IncomingListItem, "title">[]): IncomingFilter {
  if (sp.type && list.some((r) => r.title === sp.type)) return { key: `type:${sp.type}`, keep: (r) => r.title === sp.type };
  if (sp.f === "new") return { key: "new", keep: (r) => r.myOfferStatus === null };
  if (sp.f === "direct") return { key: "direct", keep: (r) => r.mode === "DIRECT" };
  return { key: "all", keep: () => true };
}

/** Новая заявка: мастер ещё не откликался. */
export const isFreshIncoming = (r: Pick<IncomingListItem, "myOfferStatus">): boolean => r.myOfferStatus === null;

/** Типы мебели во входящих по порядку первого появления, без повторов. */
export function incomingTypes(list: readonly Pick<IncomingListItem, "title">[]): string[] {
  return [...new Set(list.map((r) => r.title))];
}

export type IncomingCounts = { all: number; fresh: number; direct: number; byType: { type: string; count: number }[] };

/** Числа для чипов входящих. Чипы по типам нужны, когда типов больше одного (решает экран по `byType.length`). */
export function incomingCounts(list: readonly IncomingListItem[]): IncomingCounts {
  return {
    all: list.length,
    fresh: list.filter(isFreshIncoming).length,
    direct: list.filter((r) => r.mode === "DIRECT").length,
    byType: incomingTypes(list).map((type) => ({ type, count: list.filter((r) => r.title === type).length })),
  };
}

/** Сделки мастера в работе: идущие, где он исполнитель. */
export function inWorkCount(deals: readonly Pick<DealListItem, "myRole" | "status">[]): number {
  return deals.filter((d) => d.myRole === "EXECUTOR" && ACTIVE_DEAL.has(d.status)).length;
}

export const OFFER_GROUPS = ["all", "waiting", "chosen", "closed"] as const;
export type OfferGroup = (typeof OFFER_GROUPS)[number];

/** Раздел предложения: отправлено — ждёт, принято — выбрано, остальное — закрыто. */
export const offerGroupOf = (o: Pick<MyOfferItem, "status">): Exclude<OfferGroup, "all"> =>
  o.status === "SENT" ? "waiting" : o.status === "ACCEPTED" ? "chosen" : "closed";

/** Раздел из адреса (`?show=`): неизвестное значение — «Все». */
export const offerGroupParam = (value: string | undefined): OfferGroup => OFFER_GROUPS.find((g) => g === value) ?? "all";

/** Предложения выбранного раздела. */
export function offersIn<T extends Pick<MyOfferItem, "status">>(list: readonly T[], group: OfferGroup): T[] {
  return group === "all" ? [...list] : list.filter((o) => offerGroupOf(o) === group);
}

/** Сколько предложений в каждом разделе (для чипов). */
export function offerGroupCounts(list: readonly Pick<MyOfferItem, "status">[]): Record<OfferGroup, number> {
  return { all: list.length, waiting: offersIn(list, "waiting").length, chosen: offersIn(list, "chosen").length, closed: offersIn(list, "closed").length };
}
