import type { OfferStatus, RequestStatus, Segment } from "@/generated/prisma/enums";
import { formatDays, formatDeals, formatMonths } from "@/features/format/format";
import { ru } from "@/i18n/ru";
import type { StatusTone } from "@/kit";
import { TZ_PATH, type OfferSort, type RequestDetails, type RequestPath } from "@/modules/requests/client";
import { COUNTERTOPS, FACADES, HARDWARE, SEGMENT_NAMES, STYLES, type StyleKey } from "@/verticals/furniture";
import { to } from "../../../../_shell/paths";
import type { RequestState } from "../../../_parts/request-state";

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

export type NowKind = "draft" | "waiting" | "waiting-direct" | "offers" | "site-measuring" | "chosen" | "deal" | "done" | "cancelled";

export type NowInput = {
  id: string;
  mode: "TENDER" | "DIRECT";
  /** Путь заявки (`pathOf`): ТЗ или сценарий до договора. */
  path: RequestPath;
  /** Состояние заявки — общая `requestState` (то же, что на главной и в «Моих заявках»): что сейчас и сколько действующих предложений. */
  state: Pick<RequestState, "kind" | "liveOffers">;
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
  /** Второстепенное действие («Посмотреть мастеров»): ссылка рядом с «Сейчас», не главная кнопка. */
  secondary: { label: string; href: string } | null;
};

/**
 * Что сейчас с заявкой — по общему состоянию `requestState` (таблица там). Главное действие — только когда есть куда
 * вести: на сделку или на выбранное предложение. «Пришло N предложений» (N — действующие) действия не имеет: действие —
 * сами карточки предложений ниже.
 */
export function nowView(i: NowInput): NowView {
  return { ...nowState(i), secondary: executorsLink(i) };
}

/**
 * «Посмотреть мастеров» — у открытой заявки (ждёт предложений или они пришли) на всех мастеров, идущей путём ТЗ: общий
 * список мастеров с заявкой в адресе. Главное действие экрана не меняет.
 */
function executorsLink(i: NowInput): NowView["secondary"] {
  const open = i.state.kind === "waiting" || i.state.kind === "choose";
  if (!open || i.mode !== "TENDER" || i.path !== TZ_PATH) return null;
  return { label: t.now.executors, href: `${to("/executors")}?${new URLSearchParams({ request: i.id })}` };
}

function nowState(i: NowInput): Omit<NowView, "secondary"> {
  const dealAction = (label: string) => (i.dealId ? { label, href: to(`/deals/${encodeURIComponent(i.dealId)}`) } : null);
  switch (i.state.kind) {
    case "draft":
      return { kind: "draft", ...buyer.draft, primary: { label: buyer.draft.action, href: draftHref(i.id) } };
    case "choose":
      return { kind: "offers", title: buyer.offers.title(i.state.liveOffers), body: t.now.offers.body, next: t.now.offers.next, primary: null };
    case "waiting":
      return i.mode === "DIRECT"
        ? { kind: "waiting-direct", ...t.now.waitingDirect, primary: null }
        : { kind: "waiting", ...t.now.waiting, primary: null };
    case "site-measuring":
      return { kind: "site-measuring", ...t.now.siteMeasuring, primary: null };
    case "chosen":
    case "measuring":
      return {
        kind: "chosen",
        title: buyer.requestChosen.title,
        next: buyer.requestChosen.next,
        primary: i.chosenOfferId ? { label: t.now.chosen.action, href: `${requestHref(i.id)}/offers/${encodeURIComponent(i.chosenOfferId)}` } : null,
      };
    case "deal":
      return { kind: "deal", title: t.now.deal.title, body: t.now.deal.body, next: t.now.deal.next, primary: dealAction(t.now.deal.action) };
    case "done":
      return { kind: "done", title: t.now.done.title, body: t.now.done.body, primary: dealAction(t.now.deal.action) };
    case "cancelled":
      return { kind: "cancelled", ...t.now.cancelled, primary: null };
  }
}

/** Плашка «Заявка отправлена мастерам» — разово, после отправки из мастера, пока предложений нет. */
export function sentNotice(sent: boolean, status: RequestStatus, mode: "TENDER" | "DIRECT", offersCount: number): { title: string; text: string } | null {
  // «Когда придёт первое предложение…» верно, только пока предложений нет.
  if (!sent || offersCount > 0 || (status !== "OPEN" && status !== "PLATFORM_MEASURING")) return null;
  return { title: mode === "DIRECT" ? t.sent.titleDirect : t.sent.title, text: t.sent.text };
}

// ─── Предложения ─────────────────────────────────────────────────────────────────────────────────────────────────────

/** Предложение в объёме, нужном списку (`listOffers` и действующая цена из `myOfferStates`). */
export type OfferInput = {
  id: string;
  status: OfferStatus;
  /** Торг по предложению идёт (`myOfferStates.live`): такое предложение действует. */
  live: boolean;
  /** Цена, которую видит покупатель сейчас (`myOfferStates.priceTiyn`): со сделкой — цена сделки, иначе — действующая цена мастера. */
  priceTiyn: bigint;
  /** По предложению создана сделка: цена подписывается «Цена сделки». */
  withDeal: boolean;
  durationDays: number;
  warrantyMonths: number;
  createdAt: Date;
  executor: { label: string; ratingAvg: number; reviewsCount: number; completedDeals: number };
};

export type OfferRow = {
  id: string;
  href: string;
  label: string;
  priceTiyn: bigint;
  /** Подпись к цене: «Цена сделки» у предложения со сделкой; у остальных — без подписи (цена мастера). */
  priceLabel: string | null;
  rating: { value: number | null; count: number };
  /** «Срок: 30 дней», «Гарантия: 24 месяца», «12 сделок в сервисе»: каждая часть не переносится внутри себя. */
  terms: string[];
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
    priceLabel: o.withDeal ? t.offers.dealPrice : null,
    rating: { value: o.executor.reviewsCount > 0 ? o.executor.ratingAvg : null, count: o.executor.reviewsCount },
    terms: parts,
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

/**
 * «Дешевле» — по той цене, что показана (действующая цена торга или цена сделки), а не по первой цене отклика, как
 * сортирует модуль; при равной цене — быстрее, затем раньше присланное (как у модуля). Другие порядки — как отдал модуль.
 */
function byShownPrice(offers: readonly OfferInput[], sort: OfferSort): OfferInput[] {
  if (sort !== "price") return [...offers];
  return [...offers].sort((a, b) => (a.priceTiyn < b.priceTiyn ? -1 : a.priceTiyn > b.priceTiyn ? 1 : a.durationDays - b.durationDays || a.createdAt.getTime() - b.createdAt.getTime()));
}

/**
 * Список предложений. Пока заявка ждёт предложений (OPEN, замер площадки), в нём только действующие (`live`: торг идёт) —
 * отклонённые и закрытые не считаются и не показываются; у заявки со сделкой или отменённой — вся история с плашками.
 */
export function offersView(i: { id: string; status: RequestStatus; mode: "TENDER" | "DIRECT" }, offers: readonly OfferInput[], sort: OfferSort): OffersView {
  const expecting = i.status === "OPEN" || i.status === "PLATFORM_MEASURING";
  const rows = byShownPrice(expecting ? offers.filter((o) => o.live) : offers, sort).map((o) => offerRow(i.id, o));
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

/** Сводка заявки строками «подпись — значение»; пустое не показывается. Длинное (размеры, описание, адрес, пожелания) — стопкой: в одну строку оно наезжало на подпись. */
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
    [t.details.size, size, true],
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

// ─── Приглашённые мастера ────────────────────────────────────────────────────────────────────────────────────────────

/** Приглашение в объёме, нужном списку (`listInvitations`). */
export type InvitationInput = { publicNumber: number; label: string; status: "INVITED" | "DECLINED" | "OFFERED"; reason: string | null };

export type InvitationRow = { key: string; label: string; href: string; status: string };

/** Мастер — ссылкой на его страницу; статус по ответу: «Ждём ответа», «Отказался: причина», «Прислал предложение». */
export function invitationRows(list: readonly InvitationInput[]): InvitationRow[] {
  const s = t.invitations;
  return list.map((x) => ({
    key: String(x.publicNumber),
    label: x.label,
    href: to(`/executors/${x.publicNumber}`),
    status: x.status === "DECLINED" ? (x.reason?.trim() ? s.declined(x.reason.trim()) : s.declinedNoReason) : s.status[x.status],
  }));
}
