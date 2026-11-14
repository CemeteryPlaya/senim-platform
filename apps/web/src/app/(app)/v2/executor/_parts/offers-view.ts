import { offerGroupCounts, offerGroupParam, offersIn, OFFER_GROUPS, type OfferGroup } from "@/features/executor-requests/incoming";
import { formatRelative } from "@/features/format/format";
import { ru } from "@/i18n/ru";
import type { ChipItem, StatusTone } from "@/kit";
import type { MyOfferItem } from "@/modules/requests";
import { SEGMENT_NAMES } from "@/verticals/furniture";
import { to } from "../../../_shell/paths";

// Вид «Моих предложений» (чистая функция, без React и базы): разделы-чипы в адресе, карточки, пустые состояния.
// Тексты — `ru.app.masterRequests.offers`.

const t = ru.app.masterRequests.offers;

/** Предложение в том объёме, что нужен виду (подмножество `listMyOffers`). */
export type OfferRow = Pick<MyOfferItem, "id" | "requestId" | "number" | "title" | "city" | "segment" | "status" | "priceTiyn" | "durationDays" | "createdAt" | "dealId">;

export type OfferCardView = {
  id: string;
  /** Выбранное со сделкой — на сделку, остальное — на заявку. */
  href: string;
  title: string;
  status: { text: string; tone: StatusTone };
  priceTiyn: bigint;
  /** Город и сегмент, срок, когда отправлено. */
  meta: string[];
};

export type OffersView = {
  group: OfferGroup;
  chips: ChipItem[];
  cards: OfferCardView[];
  /** `none` — предложений нет совсем, `filter` — пуст выбранный раздел, `null` — есть что показать. */
  empty: "none" | "filter" | null;
};

/** Статус простыми словами: у выбранного — «Сделка», когда оферта уже создана. */
export function offerStatus(o: Pick<OfferRow, "status" | "dealId">): { text: string; tone: StatusTone } {
  switch (o.status) {
    case "SENT":
      return { text: t.status.waiting, tone: "warn" };
    case "ACCEPTED":
      return { text: o.dealId ? t.status.deal : t.status.chosen, tone: "accent" };
    case "DECLINED":
      return { text: t.status.declined, tone: "neutral" };
    case "WITHDRAWN":
      return { text: t.status.withdrawn, tone: "neutral" };
  }
}

const groupHref = (group: OfferGroup): string => (group === "all" ? to("/executor/offers") : `${to("/executor/offers")}?${new URLSearchParams({ show: group })}`);

/** Предложение карточкой: заявка, статус, цена, сведения. `now` — для «отправлено N дней назад». */
export function offerCard(o: OfferRow, now: Date = new Date()): OfferCardView {
  const place = o.segment ? `${o.city} · ${SEGMENT_NAMES[o.segment]}` : o.city;
  return {
    id: o.id,
    href: o.dealId ? to(`/deals/${encodeURIComponent(o.dealId)}`) : to(`/executor/requests/${encodeURIComponent(o.requestId)}`),
    title: ru.requests.requestTitle(o.number, o.title),
    status: offerStatus(o),
    priceTiyn: o.priceTiyn,
    meta: [place, t.card.days(o.durationDays), t.card.sent(formatRelative(o.createdAt, now))],
  };
}

/**
 * Группы чипами: «Все», «Ждут ответа», «Выбраны», «Закрыты» (отклонены и отозваны) — с числом; раздел из адреса
 * (`?show=`) разбирает `offerGroupParam`: неизвестное значение — «Все».
 */
export function offersView(list: readonly OfferRow[], show: string | undefined, now: Date = new Date()): OffersView {
  const group = offerGroupParam(show);
  if (list.length === 0) return { group, chips: [], cards: [], empty: "none" };
  const counts = offerGroupCounts(list);
  const chips = OFFER_GROUPS.map((g) => ({ href: groupHref(g), label: t.chip(t.chips[g], counts[g]), active: g === group }));
  const shown = offersIn(list, group);
  return { group, chips, cards: shown.map((o) => offerCard(o, now)), empty: shown.length === 0 ? "filter" : null };
}
