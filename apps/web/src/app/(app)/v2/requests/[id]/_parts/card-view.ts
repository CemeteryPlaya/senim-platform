import type { OfferStatus, RequestStatus, Segment } from "@/generated/prisma/enums";
import { formatDays, formatDeals, formatMonths } from "@/features/format/format";
import { ru } from "@/i18n/ru";
import type { StatusTone } from "@/kit";
import type { OfferSort, RequestDetails } from "@/modules/requests/client";
import { COUNTERTOPS, FACADES, HARDWARE, SEGMENT_NAMES, STYLES, type StyleKey } from "@/verticals/furniture";
import { to } from "../../../../_shell/paths";

// Вид карточки заявки покупателя (чистая логика без React и базы): «Сейчас / Дальше» по состоянию, предложения мастеров,
// «Что в заявке». Страница читает модули и отдаёт сюда готовые данные; тексты — `ru.app.requestCard` и `ru.app.buyer`.

const t = ru.app.requestCard;
const buyer = ru.app.buyer.home.now;

/** Порядок сортировки предложений: как у модуля (`OFFER_SORTS`), по умолчанию — дешевле (как в v1). */
export const SORTS = ["price", "duration", "rating"] as const satisfies readonly OfferSort[];
export const DEFAULT_SORT: OfferSort = "price";

/** Сортировка из адреса: неизвестное значение — по умолчанию. */
export function parseSort(value: string | undefined): OfferSort {
  return SORTS.find((s) => s === value) ?? DEFAULT_SORT;
}

const requestHref = (id: string) => to(`/requests/${encodeURIComponent(id)}`);

/** Адрес карточки с выбранной сортировкой. */
export const sortHref = (id: string, sort: OfferSort) => `${requestHref(id)}?${new URLSearchParams({ sort })}`;

/** Адрес мастера заявки для черновика. */
export const draftHref = (id: string) => `${to("/requests/new")}?${new URLSearchParams({ draft: id })}`;

// ─── «Сейчас / Дальше» ───────────────────────────────────────────────────────────────────────────────────────────────

export type NowKind = "draft" | "waiting" | "waiting-direct" | "offers" | "site-measuring" | "chosen" | "deal" | "cancelled";

export type NowInput = {
  id: string;
  status: RequestStatus;
  mode: "TENDER" | "DIRECT";
  /** Действующие предложения (без отозванных). */
  offersCount: number;
  dealId: string | null;
  chosenOfferId: string | null;
};

export type NowView = {
  kind: NowKind;
  title: string;
  body?: string;
  next?: string;
  /** Единственное главное действие экрана; `null` — от человека ничего не нужно или действие в списке ниже. */
  primary: { label: string; href: string } | null;
};

/**
 * Что сейчас с заявкой (таблица состояний). Главное действие — только когда есть куда вести: на сделку или на выбранное
 * предложение. «Пришло N предложений» действия не имеет: действие — сами карточки предложений ниже.
 */
export function nowView(i: NowInput): NowView {
  switch (i.status) {
    case "DRAFT":
      return { kind: "draft", ...buyer.draft, primary: { label: buyer.draft.action, href: draftHref(i.id) } };
    case "OPEN":
      if (i.offersCount > 0) {
        return { kind: "offers", title: buyer.offers.title(i.offersCount), body: t.now.offers.body, next: t.now.offers.next, primary: null };
      }
      return i.mode === "DIRECT"
        ? { kind: "waiting-direct", ...t.now.waitingDirect, primary: null }
        : { kind: "waiting", ...t.now.waiting, primary: null };
    case "PLATFORM_MEASURING":
      return { kind: "site-measuring", ...t.now.siteMeasuring, primary: null };
    case "OFFER_CHOSEN":
    case "MEASURING":
      return {
        kind: "chosen",
        title: buyer.requestChosen.title,
        next: buyer.requestChosen.next,
        primary: i.chosenOfferId ? { label: t.now.chosen.action, href: `${requestHref(i.id)}/offers/${encodeURIComponent(i.chosenOfferId)}` } : null,
      };
    case "CONTRACTING":
    case "CLOSED":
      return {
        kind: "deal",
        title: t.now.deal.title,
        body: t.now.deal.body,
        next: t.now.deal.next,
        primary: i.dealId ? { label: t.now.deal.action, href: to(`/deals/${encodeURIComponent(i.dealId)}`) } : null,
      };
    case "CANCELLED":
      return { kind: "cancelled", ...t.now.cancelled, primary: null };
  }
}

/** Плашка «Заявка отправлена мастерам» — разово, после отправки из мастера. */
export function sentNotice(sent: boolean, status: RequestStatus, mode: "TENDER" | "DIRECT"): { title: string; text: string } | null {
  if (!sent || (status !== "OPEN" && status !== "PLATFORM_MEASURING")) return null;
  return { title: mode === "DIRECT" ? t.sent.titleDirect : t.sent.title, text: t.sent.text };
}

// ─── Предложения ─────────────────────────────────────────────────────────────────────────────────────────────────────

/** Предложение в объёме, нужном списку (подмножество `listOffers`). */
export type OfferInput = {
  id: string;
  status: OfferStatus;
  priceTiyn: bigint;
  durationDays: number;
  warrantyMonths: number;
  executor: { label: string; ratingAvg: number; reviewsCount: number; completedDeals: number };
};

export type OfferRow = {
  id: string;
  href: string;
  label: string;
  priceTiyn: bigint;
  rating: { value: number | null; count: number };
  /** «Срок: 30 дней · Гарантия: 24 месяца · 12 сделок в сервисе». */
  terms: string;
  chip: { tone: StatusTone; text: string } | null;
};

const CHIPS: Partial<Record<OfferStatus, { tone: StatusTone; text: string }>> = {
  ACCEPTED: { tone: "accent", text: t.offers.status.accepted },
  DECLINED: { tone: "neutral", text: t.offers.status.declined },
};

export function offerRow(requestId: string, o: OfferInput): OfferRow {
  const parts = [t.offers.term(formatDays(o.durationDays)), t.offers.warranty(formatMonths(o.warrantyMonths))];
  if (o.executor.completedDeals > 0) parts.push(t.offers.deals(formatDeals(o.executor.completedDeals)));
  return {
    id: o.id,
    href: `${requestHref(requestId)}/offers/${encodeURIComponent(o.id)}`,
    label: o.executor.label,
    priceTiyn: o.priceTiyn,
    rating: { value: o.executor.reviewsCount > 0 ? o.executor.ratingAvg : null, count: o.executor.reviewsCount },
    terms: parts.join(" · "),
    chip: CHIPS[o.status] ?? null,
  };
}

export type OffersView = {
  rows: OfferRow[];
  sort: OfferSort;
  /** Сортировка нужна от двух предложений. */
  sortable: boolean;
  /** Обучающая пустая карточка: предложений нет, и они ещё могут прийти. */
  empty: { title: string; body: string } | null;
  /** Раздела нет вовсе (отменена или со сделкой и без предложений). */
  shown: boolean;
};

export function offersView(i: { id: string; status: RequestStatus; mode: "TENDER" | "DIRECT" }, offers: readonly OfferInput[], sort: OfferSort): OffersView {
  const rows = offers.map((o) => offerRow(i.id, o));
  const expecting = i.status === "OPEN" || i.status === "PLATFORM_MEASURING";
  return {
    rows,
    sort,
    sortable: rows.length > 1,
    empty: rows.length === 0 && expecting ? (i.mode === "DIRECT" ? t.offers.emptyDirect : t.offers.empty) : null,
    shown: rows.length > 0 || expecting,
  };
}

/** Сегменты сортировки: значение и подпись. */
export const sortOptions = (): { value: OfferSort; label: string }[] => SORTS.map((value) => ({ value, label: t.offers.sort[value] }));

// ─── Что в заявке ────────────────────────────────────────────────────────────────────────────────────────────────────

export type DetailRow = { label: string; value: string; stacked: boolean };

/** Заявка в объёме, нужном сводке (подмножество `getClientRequest` и `getDraft`). */
export type DetailsInput = {
  title: string;
  style: string | null;
  segment: Segment | null;
  details: RequestDetails;
  city: string | null;
  address: string | null;
  wishes: string | null;
  /** Заявка для одного мастера: подпись «Исполнитель №N». */
  directLabel: string | null;
};

/** Значение материала: «не знаю» — явно, иначе название из справочника. */
function material(unknown: ReadonlySet<string>, key: "facade" | "countertop" | "hardware", value: string | undefined, names: Record<string, { name: string }>): string | null {
  if (unknown.has(key)) return t.details.unknown;
  return value ? (names[value]?.name ?? value) : null;
}

/** Сводка заявки строками «подпись — значение»; пустое не показывается. Длинное (описание, адрес, пожелания) — стопкой. */
export function detailRows(i: DetailsInput): DetailRow[] {
  const d = i.details;
  const unknown = new Set<string>(d.unknown ?? []);
  const size = unknown.has("size") ? t.details.unknown : d.widthCm || d.heightCm || d.depthCm ? t.details.sizeValue(d.widthCm, d.heightCm, d.depthCm) : null;
  const rows: [string, string | null | undefined, boolean?][] = [
    [t.details.directFor, i.directLabel],
    [t.details.type, i.title],
    [t.details.segment, i.segment ? SEGMENT_NAMES[i.segment] : null],
    [t.details.style, i.style ? (STYLES[i.style as StyleKey]?.name ?? i.style) : null],
    [t.details.styleNote, d.styleNote, true],
    [t.details.size, size],
    [t.details.facade, material(unknown, "facade", d.facade, FACADES)],
    [t.details.countertop, material(unknown, "countertop", d.countertop, COUNTERTOPS)],
    [t.details.hardware, material(unknown, "hardware", d.hardware, HARDWARE)],
    [t.details.color, d.color],
    [t.details.extras, d.extras?.length ? d.extras.map((x) => ru.requests.extras[x]).join(", ") : null],
    [t.details.description, d.description, true],
    [t.details.city, i.city],
    [t.details.address, i.address, true],
    [t.details.wishes, i.wishes, true],
  ];
  return rows.flatMap(([label, value, stacked]) => (value ? [{ label, value, stacked: stacked === true }] : []));
}

export type Photo = { id: string; src: string | null };

/** Снимки помещения с описанием по порядку; снимок без адреса (ещё нельзя показать) пропускается. */
export function photoView(photos: readonly Photo[]): { id: string; src: string; alt: string }[] {
  const shown = photos.flatMap((p) => (p.src ? [{ id: p.id, src: p.src }] : []));
  return shown.map((p, index) => ({ ...p, alt: t.details.photoAlt(index + 1, shown.length) }));
}
