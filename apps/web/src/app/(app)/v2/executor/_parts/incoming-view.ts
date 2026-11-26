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
  /** Открыта встречная цена покупателя по моему предложению: ход за мастером (модуль). */
  buyerPriceOpen?: boolean;
};

export type IncomingBadge = { text: string; tone: StatusTone };

export type IncomingCardView = {
  id: string;
  href: string;
  /** «Кухня · №5» — что нужно покупателю, номер после. */
  title: string;
  /** Метки: «Новая», «Прямая заявка вам», моё предложение («Ждёт вашего ответа» — при встречной цене покупателя). */
  badges: IncomingBadge[];
  /** Строка под названием: город и сегмент; срок; когда опубликована; число предложений. */
  meta: string[];
  /**
   * Те же сведения двумя строками (разбор 2.2): «где и к какому сроку» («Астана · Комфорт», «Нужно к 5 дек») и «когда и
   * сколько предложений» («вчера», «Предложений: 2»); части строки разделяются « · », переносится только
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

/** Метка моего предложения: встречная цена покупателя — ход мой (`warn`); иначе — короткая подпись статуса. */
function myOfferBadge(r: IncomingRow): IncomingBadge | null {
  if (!r.myOfferStatus) return null;
  if (r.myOfferStatus === "SENT" && r.buyerPriceOpen) return { text: t.card.buyerPrice, tone: "warn" };
  // В строке — короткая подпись плашки (без переноса); полная — `t.card.myOffer` на экране заявки.
  return { text: t.card.myOfferShort[r.myOfferStatus], tone: OFFER_TONE[r.myOfferStatus] };
}

/**
 * Строка заявки: ссылка на экран заявки, метки и мелкие сведения. `now` — для «N дней назад» (когда опубликована: слово
 * «Опубликована» строку не открывает — оно рвало её). `markFresh: false` — без метки «Новая» (блок «Новые заявки» главной:
 * раздел так и называется).
 */
export function incomingCard(r: IncomingRow, now: Date = new Date(), { markFresh = true }: { markFresh?: boolean } = {}): IncomingCardView {
  const badges: IncomingBadge[] = [];
  if (r.myOfferStatus === null && markFresh) badges.push({ text: t.card.fresh, tone: "warn" });
  if (r.invited) badges.push({ text: t.card.invited, tone: "accent" });
  if (r.mode === "DIRECT") badges.push({ text: t.card.direct, tone: "accent" });
  const mine = myOfferBadge(r);
  if (mine) badges.push(mine);
  const place = r.segment ? `${r.city} · ${SEGMENT_NAMES[r.segment]}` : r.city;
  const where = [place, ...(r.desiredDate ? [t.card.wanted(formatShortDate(r.desiredDate, now))] : [])];
  const when = [...(r.publishedAt ? [formatRelative(r.publishedAt, now)] : []), ...(r.offersCount > 0 ? [t.card.offers(r.offersCount)] : [])];
  const meta = [...where, ...when];
  const lines: [string[], string[]] = [where, when];
  return { id: r.id, href: to(`/executor/requests/${encodeURIComponent(r.id)}`), title: t.card.title(r.number, r.title), badges, meta, lines, cover: r.cover?.src ?? null };
}

/** С какого числа заявок рисуются чипы по типу мебели: в коротком списке искать нечего, а ряд не помещается в экран. */
export const TYPE_CHIPS_FROM = 6;

/**
 * Чипы: «Все», «Новые» (без моего предложения), «Прямые вам» (когда есть), по типу мебели (когда типов больше одного и
 * заявок не меньше `TYPE_CHIPS_FROM`) — каждый с числом; выбранный берётся из адреса (`?f=new|direct`, `?type=`),
 * неизвестное значение — «Все».
 */
export function incomingListView(list: readonly IncomingListItem[], search: IncomingSearch, now: Date = new Date()): IncomingListView {
  const counts = incomingCounts(list);
  const picked = selectedIncoming(search, list);
  const typeChips = counts.byType.length > 1 && list.length >= TYPE_CHIPS_FROM;
  // Чип выбранного раздела может не рисоваться (прямых заявок нет, тип один, заявок мало): тогда адрес читается как «Все», а не пустой список без активного чипа.
  const hidden = (picked.key === "direct" && counts.direct === 0) || (picked.key.startsWith("type:") && !typeChips);
  const current = hidden ? selectedIncoming({}, list) : picked;
  if (list.length === 0) return { key: current.key, chips: [], cards: [], empty: "none" };
  const chip = (key: string, label: string, n: number, href: string): ChipItem => ({ href, label: t.chip(label, n), active: current.key === key });
  const chips: ChipItem[] = [
    chip("all", t.chips.all, counts.all, BASE),
    chip("new", t.chips.fresh, counts.fresh, `${BASE}?f=new`),
    ...(counts.direct > 0 ? [chip("direct", t.chips.direct, counts.direct, `${BASE}?f=direct`)] : []),
    ...(typeChips ? counts.byType.map((x) => chip(`type:${x.type}`, x.type, x.count, `${BASE}?${new URLSearchParams({ type: x.type })}`)) : []),
  ];
  const shown = list.filter(current.keep);
  return { key: current.key, chips, cards: shown.map((r) => incomingCard(r, now)), empty: shown.length === 0 ? "filter" : null };
}
