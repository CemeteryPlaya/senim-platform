import { selectedIncoming, incomingCounts, type IncomingSearch } from "@/features/executor-requests/incoming";
import { formatRelative, formatShortDate } from "@/features/format/format";
import type { OfferStatus } from "@/generated/prisma/enums";
import { ru } from "@/i18n/ru";
import type { ChipItem, StatusTone } from "@/kit";
import type { IncomingListItem } from "@/modules/requests";
import { SEGMENT_NAMES } from "@/verticals/furniture";
import { to } from "../../../_shell/paths";

// Вид входящих заявок мастера (чистая функция, без React и базы): чипы-фильтры в адресе, карточки заявок, какое пустое
// состояние показать. Общий для экрана «Заявки» и блока «Новые заявки» на главной. Тексты — `ru.app.masterRequests.incoming`.

const t = ru.app.masterRequests.incoming;

/** Заявка во входящих в том объёме, что нужен виду (подмножество `listIncomingRequests`). */
export type IncomingRow = Pick<
  IncomingListItem,
  "id" | "number" | "title" | "mode" | "segment" | "city" | "desiredDate" | "publishedAt" | "offersCount" | "myOfferStatus"
> & {
  /** Покупатель позвал мастера и приглашение в силе. */
  invited?: boolean;
  /** Обложка — первое фото помещения (модуль); нет — `null`. */
  cover?: { src: string } | null;
};

export type IncomingBadge = { text: string; tone: StatusTone };

export type IncomingCardView = {
  id: string;
  href: string;
  /** «Заявка №5: Кухня» — что нужно покупателю. */
  title: string;
  /** Метки: «Новая», «Прямая заявка вам», моё предложение. */
  badges: IncomingBadge[];
  /** Строка под названием: город и сегмент; срок; когда опубликована; число предложений. */
  meta: string[];
  /**
   * Те же сведения двумя строками (разбор 2.2): «где и к какому сроку» («Астана · Комфорт», «Нужно к 5 дек») и «когда и
   * сколько предложений» («Опубликована вчера», «Предложений: 2»); части строки разделяются « · », переносится только
   * между частями. Пустая вторая строка — пустой массив.
   */
  lines: [string[], string[]];
  /** Адрес миниатюры 56 px (первое фото помещения); `null` — фото нет. */
  cover: string | null;
};

export type IncomingListView = {
  /** Ключ выбранного чипа: `all`, `new`, `direct`, `type:<название>`. */
  key: string;
  chips: ChipItem[];
  cards: IncomingCardView[];
  /** `none` — заявок нет совсем (обучающий экран), `filter` — пуст выбранный раздел, `null` — есть что показать. */
  empty: "none" | "filter" | null;
};

const BASE = to("/executor/requests");

/** Тон метки моего предложения: выбрано — зелёный, ждёт — нейтральный. */
const OFFER_TONE: Record<OfferStatus, StatusTone> = { SENT: "neutral", ACCEPTED: "accent", DECLINED: "neutral", WITHDRAWN: "neutral" };

/** Строка заявки: ссылка на экран заявки, метки и мелкие сведения. `now` — для «опубликована N дней назад». */
export function incomingCard(r: IncomingRow, now: Date = new Date()): IncomingCardView {
  const badges: IncomingBadge[] = [];
  if (r.myOfferStatus === null) badges.push({ text: t.card.fresh, tone: "warn" });
  if (r.invited) badges.push({ text: t.card.invited, tone: "accent" });
  if (r.mode === "DIRECT") badges.push({ text: t.card.direct, tone: "accent" });
  // В строке — короткая подпись плашки (без переноса); полная — `t.card.myOffer` на экране заявки.
  if (r.myOfferStatus) badges.push({ text: t.card.myOfferShort[r.myOfferStatus], tone: OFFER_TONE[r.myOfferStatus] });
  const place = r.segment ? `${r.city} · ${SEGMENT_NAMES[r.segment]}` : r.city;
  const where = [place, ...(r.desiredDate ? [t.card.wanted(formatShortDate(r.desiredDate, now))] : [])];
  const when = [...(r.publishedAt ? [t.card.published(formatRelative(r.publishedAt, now))] : []), ...(r.offersCount > 0 ? [t.card.offers(r.offersCount)] : [])];
  const meta = [...where, ...when];
  const lines: [string[], string[]] = [where, when];
  return { id: r.id, href: to(`/executor/requests/${encodeURIComponent(r.id)}`), title: ru.requests.requestTitle(r.number, r.title), badges, meta, lines, cover: r.cover?.src ?? null };
}

/**
 * Чипы: «Все», «Новые» (без моего предложения), «Прямые вам» (когда есть), по типу мебели (когда типов больше одного) —
 * каждый с числом; выбранный берётся из адреса (`?f=new|direct`, `?type=`), неизвестное значение — «Все».
 */
export function incomingListView(list: readonly IncomingListItem[], search: IncomingSearch, now: Date = new Date()): IncomingListView {
  const counts = incomingCounts(list);
  const picked = selectedIncoming(search, list);
  // Чип выбранного раздела может не рисоваться (прямых заявок нет, тип один): тогда адрес читается как «Все», а не пустой список без активного чипа.
  const hidden = (picked.key === "direct" && counts.direct === 0) || (picked.key.startsWith("type:") && counts.byType.length <= 1);
  const current = hidden ? selectedIncoming({}, list) : picked;
  if (list.length === 0) return { key: current.key, chips: [], cards: [], empty: "none" };
  const chip = (key: string, label: string, n: number, href: string): ChipItem => ({ href, label: t.chip(label, n), active: current.key === key });
  const chips: ChipItem[] = [
    chip("all", t.chips.all, counts.all, BASE),
    chip("new", t.chips.fresh, counts.fresh, `${BASE}?f=new`),
    ...(counts.direct > 0 ? [chip("direct", t.chips.direct, counts.direct, `${BASE}?f=direct`)] : []),
    ...(counts.byType.length > 1 ? counts.byType.map((x) => chip(`type:${x.type}`, x.type, x.count, `${BASE}?${new URLSearchParams({ type: x.type })}`)) : []),
  ];
  const shown = list.filter(current.keep);
  return { key: current.key, chips, cards: shown.map((r) => incomingCard(r, now)), empty: shown.length === 0 ? "filter" : null };
}
