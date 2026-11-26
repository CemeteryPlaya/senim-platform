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
export type OfferRow = Pick<MyOfferItem, "id" | "requestId" | "number" | "title" | "city" | "segment" | "status" | "priceTiyn" | "createdAt" | "dealId"> &
  Partial<Pick<MyOfferItem, "buyerPriceOpen">>;

export type OfferCardView = {
  id: string;
  /** Выбранное со сделкой — на сделку, остальное — на заявку. */
  href: string;
  /** «Кухня · №18». */
  title: string;
  /** Плашка — только где нужно действие мастера или есть исход; обычное «ждёт ответа покупателя» не подписываем. */
  status: { text: string; tone: StatusTone } | null;
  priceTiyn: bigint;
  /** Город и сегмент, когда отправлено (срок — внутри предложения). Части не рвутся, перенос — между ними. */
  meta: string[];
};

export type OffersView = {
  group: OfferGroup;
  chips: ChipItem[];
  cards: OfferCardView[];
  /** `none` — предложений нет совсем, `filter` — пуст выбранный раздел, `null` — есть что показать. */
  empty: "none" | "filter" | null;
};

/**
 * Статус простыми словами: у выбранного — «Сделка», когда оферта уже создана. Отправленное, по которому покупатель назвал
 * свою цену, — «Ждёт вашего ответа» (`warn`: ход мастера); отправленное, которое ждёт покупателя, — без плашки (обычный ход).
 */
export function offerStatus(o: Pick<OfferRow, "status" | "dealId" | "buyerPriceOpen">): { text: string; tone: StatusTone } | null {
  switch (o.status) {
    case "SENT":
      return o.buyerPriceOpen ? { text: t.status.buyerPrice, tone: "warn" } : null;
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
    title: t.card.title(o.number, o.title),
    status: offerStatus(o),
    priceTiyn: o.priceTiyn,
    meta: [place, formatRelative(o.createdAt, now)],
  };
}

/**
 * Группы чипами: «Все», «Ждут ответа», «Выбраны», «Закрыты» (отклонены и отозваны) — с числом; пустая группа чипом не
 * рисуется (кроме выбранной по адресу). Раздел из адреса (`?show=`) разбирает `offerGroupParam`: неизвестное значение — «Все».
 */
export function offersView(list: readonly OfferRow[], show: string | undefined, now: Date = new Date()): OffersView {
  const group = offerGroupParam(show);
  if (list.length === 0) return { group, chips: [], cards: [], empty: "none" };
  const counts = offerGroupCounts(list);
  const chips = OFFER_GROUPS.filter((g) => counts[g] > 0 || g === group).map((g) => ({ href: groupHref(g), label: t.chip(t.chips[g], counts[g]), active: g === group }));
  const shown = offersIn(list, group);
  return { group, chips, cards: shown.map((o) => offerCard(o, now)), empty: shown.length === 0 ? "filter" : null };
}
