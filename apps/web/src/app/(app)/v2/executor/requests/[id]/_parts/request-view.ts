import { formatDate, formatDateTime, formatDays, formatMonths, formatRelative } from "@/features/format/format";
import { ru } from "@/i18n/ru";
import { formatMoney } from "@/kit";
import type { IncomingRequest, NegotiationView } from "@/modules/requests";
import { COUNTERTOPS, FACADES, HARDWARE, SEGMENT_NAMES, STYLES, type StyleKey } from "@/verticals/furniture";
import { to } from "../../../../../_shell/paths";
import { designView, type DesignView } from "../../../../_parts/design-files";

// Вид заявки глазами мастера (чистая логика без React и базы): состояние заявки и торга, «Сейчас / Дальше», действия,
// смета мастера, сводка заявки, своё предложение и история цены. Страница читает модули (`getIncomingRequest`,
// `getNegotiation`) и отдаёт сюда готовые данные; тексты — `ru.app.masterOffer`. Зеркало `offer-view.ts` покупателя.
// Только путь ТЗ: заявку порядка «до оферты» (флаг preContractFlows) страница сразу уводит в v1.

const t = ru.app.masterOffer;

type Round = NegotiationView["rounds"][number];
type MyOffer = NonNullable<IncomingRequest["myOffer"]>;

/**
 * Состояние экрана глазами мастера — по тому, что отдают модули:
 *
 * | kind         | когда                                                                         | главное              | второстепенное        |
 * |--------------|-------------------------------------------------------------------------------|----------------------|-----------------------|
 * | `form`       | можно отправить предложение: своего нет или оператор разрешил новую попытку   | «Отправить…» (форма) | —                     |
 * | `unavailable`| своего предложения нет, а отправить нельзя                                    | —                    | к другим заявкам      |
 * | `deal`       | цена принята, сделка есть                                                     | «Открыть сделку»     | —                     |
 * | `closed`     | торг не идёт и сделки нет: заявка отменена, выбран другой мастер, отозвано    | —                    | к другим заявкам      |
 * | `buyerPrice` | открыта цена покупателя                                                       | «Принять X»          | «Предложить…»         |
 * | `waiting`    | открыта своя цена, ждёт покупателя                                            | —                    | «Отозвать мою цену»   |
 * | `noPrice`    | торг идёт, открытой цены нет: отозвал мастер или покупатель                   | «Предложить…»        | —                     |
 *
 * Пока торг идёт (`buyerPrice`, `waiting`, `noPrice`), от заявки можно отказаться (отозвать предложение целиком) — пунктом меню.
 */
export type MasterState =
  | { kind: "form"; retry: boolean }
  | { kind: "unavailable" }
  | { kind: "deal"; dealId: string }
  | { kind: "closed"; reason: "requestCancelled" | "otherChosen" | "withdrawn" | "closed" }
  | { kind: "buyerPrice" | "waiting"; proposalId: string; amountTiyn: bigint }
  | { kind: "noPrice"; by: "you" | "buyer" };

export type MasterStateInput = Pick<IncomingRequest, "canOffer" | "retryAllowed" | "status"> & {
  myOffer: Pick<MyOffer, "status" | "dealId"> | null;
  negotiation: (Pick<NegotiationView, "live" | "open" | "dealId"> & { rounds: readonly Pick<Round, "mine">[] }) | null;
};

/** Чистая функция: состояние экрана (правила переходов — в модуле; здесь только чтение). */
export function masterState(i: MasterStateInput): MasterState {
  // Форма: своего предложения ещё нет или оператор разрешил новую попытку (как в v1).
  if (i.canOffer && (!i.myOffer || i.retryAllowed)) return { kind: "form", retry: i.myOffer !== null };
  if (!i.myOffer) return { kind: "unavailable" };
  const dealId = i.negotiation?.dealId ?? i.myOffer.dealId;
  if (dealId) return { kind: "deal", dealId };
  if (i.myOffer.status === "WITHDRAWN") return { kind: "closed", reason: "withdrawn" };
  const n = i.negotiation;
  if (!n || !n.live) {
    if (i.status === "CANCELLED") return { kind: "closed", reason: "requestCancelled" };
    if (i.myOffer.status === "DECLINED") return { kind: "closed", reason: "otherChosen" };
    return { kind: "closed", reason: "closed" };
  }
  if (n.open) return { kind: n.open.mine ? "waiting" : "buyerPrice", proposalId: n.open.id, amountTiyn: n.open.amountTiyn };
  return { kind: "noPrice", by: n.rounds.at(-1)?.mine ? "you" : "buyer" };
}

/** Главное действие экрана (не больше одного). `send` — кнопка формы предложения (её рисует форма). */
export type PrimaryAction =
  | { kind: "send" }
  | { kind: "accept"; proposalId: string; label: string; confirmTitle: string; confirmDescription: string }
  | { kind: "propose" }
  | { kind: "deal"; href: string; label: string };

/** Второстепенное действие: под карточкой «Сейчас», не в доке. */
export type SecondaryAction = { kind: "propose" } | { kind: "withdrawPrice"; proposalId: string } | { kind: "link"; href: string; label: string };

export type MoneyView = {
  title: string;
  amountTiyn: bigint;
  rows: { label: string; amountTiyn: bigint; total?: true; explain?: true }[];
};

/** Точка и адрес для ссылок «Открыть на карте» под строкой (только то, что отдал модуль после договорённости о цене). */
export type DetailMap = { point: { lat: number; lng: number } | null; address: string | null };

export type DetailRow = { label: string; value: string; stacked: boolean; map?: DetailMap };

export type RequestViewModel = {
  state: MasterState;
  title: string;
  lead: { number: string; direct: string | null; invited: string | null };
  back: { href: string; label: string };
  now: { title: string; body?: string };
  next?: string;
  primary: PrimaryAction | null;
  secondary: SecondaryAction | null;
  /** Предложение целиком можно отозвать (меню «Действия с предложением»): торг идёт. */
  withdrawOffer: { offerId: string } | null;
  /** От приглашения можно отказаться (приглашён, ответа ещё нет, заявка открыта): окно с причиной. */
  declineInvitation: { requestId: string } | null;
  /** id своего предложения: торг и переписка идут по нему. */
  offerId: string | null;
  /** Описание окна «Ваша цена»: открытая цена покупателя, если она есть. */
  proposeDescription: string;
  /** Смета мастера по цене, которую можно принять или ждать (`partyEstimate("EXECUTOR")` модуля); иначе — нет. */
  money: MoneyView | null;
  /** Своё предложение: срок, гарантия, комментарий. */
  conditions: { label: string; value: string; stacked?: true }[];
  details: DetailRow[];
  photos: { id: string; src: string; alt: string }[];
  /** Свой дизайн-проект покупателя (модуль не отдаёт скрытые оператором файлы); `null` — файлов нет, раздела нет. */
  design: DesignView | null;
  /** Переписка с покупателем по своему предложению: «Написать покупателю», у закрытого торга — «Переписка». */
  chat: { href: string; label: string } | null;
  /** Строка о скрытых контактах покупателя: до оферты — «откроются после оферты», у сделки — «на экране сделки». */
  contactsNote: string | null;
  history: { title: string; time: string; text: string; amountTiyn: bigint }[];
};

function nowOf(state: MasterState, n: NegotiationView | null): Pick<RequestViewModel, "now" | "next"> {
  switch (state.kind) {
    case "form": {
      const s = state.retry ? t.now.retry : t.now.form;
      return { now: { title: s.title, body: s.body }, next: s.next };
    }
    case "unavailable":
      return { now: { ...t.now.unavailable } };
    case "buyerPrice":
      return { now: { title: t.now.buyerPrice.title(formatMoney(state.amountTiyn)), body: t.now.buyerPrice.body }, next: t.now.buyerPrice.next };
    case "waiting":
      return { now: { title: t.now.waiting.title, body: t.now.waiting.body(formatMoney(state.amountTiyn)) }, next: t.now.waiting.next };
    case "noPrice": {
      const s = state.by === "you" ? t.now.youWithdrew : t.now.buyerWithdrew;
      return { now: { title: s.title, body: s.body }, next: s.next };
    }
    case "deal":
      // Цена сделки — принятая цена торга (priceTiyn модуля); без торга (не должно быть на пути ТЗ) — без суммы.
      return { now: { title: t.now.deal.title, ...(n ? { body: t.now.deal.body(formatMoney(n.priceTiyn)) } : {}) }, next: t.now.deal.next };
    case "closed": {
      const s = t.now[state.reason];
      return { now: { title: s.title, body: n ? `${s.body} ${t.now.lastPrice(formatMoney(n.priceTiyn))}` : s.body } };
    }
  }
}

const toRequests = (): SecondaryAction => ({ kind: "link", href: to("/executor/requests"), label: t.actions.toRequests });

function actionsOf(state: MasterState, n: NegotiationView | null): Pick<RequestViewModel, "primary" | "secondary"> {
  switch (state.kind) {
    case "form":
      return { primary: { kind: "send" }, secondary: null };
    case "buyerPrice": {
      // Смета мастера по открытой цене покупателя — из модуля (partyEstimate("EXECUTOR")): здесь ничего не считается.
      const e = n?.estimate;
      const price = formatMoney(state.amountTiyn);
      return {
        primary: {
          kind: "accept",
          proposalId: state.proposalId,
          label: t.actions.accept(price),
          confirmTitle: t.acceptConfirm.title(price),
          confirmDescription: e
            ? t.acceptConfirm.description({ price, guarantee: formatMoney(e.extraTiyn), youGet: formatMoney(e.totalTiyn) })
            : t.now.buyerPrice.next,
        },
        secondary: n?.can.propose ? { kind: "propose" } : null,
      };
    }
    case "waiting":
      return { primary: null, secondary: n?.can.withdraw ? { kind: "withdrawPrice", proposalId: state.proposalId } : null };
    case "noPrice":
      return { primary: n?.can.propose ? { kind: "propose" } : null, secondary: null };
    case "deal":
      return { primary: { kind: "deal", href: to(`/deals/${encodeURIComponent(state.dealId)}`), label: t.actions.openDeal }, secondary: null };
    case "unavailable":
    case "closed":
      return { primary: null, secondary: toRequests() };
  }
}

/** Смета мастера из `partyEstimate("EXECUTOR")` модуля (n.estimate): цена, гарантия 4% вниз до тиына, «Вы получите». */
function moneyOf(state: MasterState, n: NegotiationView | null): MoneyView | null {
  if (!n || (state.kind !== "buyerPrice" && state.kind !== "waiting")) return null;
  const e = n.estimate;
  const buyer = state.kind === "buyerPrice";
  return {
    title: buyer ? t.money.title : t.money.titleWaiting,
    amountTiyn: e.totalTiyn,
    rows: [
      { label: buyer ? t.money.price.buyer : t.money.price.yours, amountTiyn: e.priceTiyn },
      { label: t.money.guarantee, amountTiyn: e.extraTiyn, explain: true },
      { label: t.money.youGet, amountTiyn: e.totalTiyn, total: true },
    ],
  };
}

function conditionsOf(state: MasterState, offer: MyOffer | null): RequestViewModel["conditions"] {
  if (!offer || state.kind === "form") return [];
  const rows: RequestViewModel["conditions"] = [
    { label: t.conditions.duration, value: formatDays(offer.durationDays) },
    { label: t.conditions.warranty, value: formatMonths(offer.warrantyMonths) },
  ];
  const comment = offer.comment.trim();
  if (comment) rows.push({ label: t.conditions.comment, value: comment, stacked: true });
  return rows;
}

/** История цены. Торг закрыт, а цена так и осталась ждать ответа (PROPOSED) — «Не принята», а не «Ждёт ответа». */
function historyOf(n: NegotiationView | null): RequestViewModel["history"] {
  if (!n) return [];
  return n.rounds.map((r) => ({
    title: r.mine ? t.history.you : t.history.buyer,
    time: formatDateTime(r.createdAt),
    text: !n.live && r.status === "PROPOSED" ? t.history.notAccepted : t.history.status[r.status],
    amountTiyn: r.amountTiyn,
  }));
}

/** Материал: «не знаю» — явно, иначе название из справочника. */
function material(unknown: ReadonlySet<string>, key: "facade" | "countertop" | "hardware", value: string | undefined, names: Record<string, { name: string }>): string | null {
  if (unknown.has(key)) return t.request.unknown;
  return value ? (names[value]?.name ?? value) : null;
}

export type DetailsInput = Pick<
  IncomingRequest,
  "title" | "style" | "segment" | "details" | "city" | "address" | "location" | "wishes" | "desiredDate" | "publishedAt"
>;

/**
 * Что нужно покупателю строками «подпись — значение»; пустое не показывается. Адрес и точку модуль отдаёт только мастеру,
 * с которым договорились о цене: до того вместо адреса — пояснение, а когда договориться уже нельзя (`addressHint: false`:
 * торг закрыт, заявка не принимает предложений) — строки адреса нет. Длинное (размеры, описание, адрес, пожелания) — стопкой.
 */
export function detailRows(r: DetailsInput, now: Date = new Date(), addressHint = true): DetailRow[] {
  const d = r.details;
  const unknown = new Set<string>(d.unknown ?? []);
  const size = unknown.has("size") ? t.request.unknown : d.widthCm || d.heightCm || d.depthCm ? t.request.sizeValue(d.widthCm, d.heightCm, d.depthCm) : null;
  const rows: [string, string | null | undefined, boolean?][] = [
    [t.request.type, r.title],
    [t.request.segment, r.segment ? SEGMENT_NAMES[r.segment] : null],
    [t.request.style, r.style ? (STYLES[r.style as StyleKey]?.name ?? r.style) : null],
    [t.request.styleNote, d.styleNote, true],
    [t.request.size, size, true],
    [t.request.facade, material(unknown, "facade", d.facade, FACADES)],
    [t.request.countertop, material(unknown, "countertop", d.countertop, COUNTERTOPS)],
    [t.request.hardware, material(unknown, "hardware", d.hardware, HARDWARE)],
    [t.request.color, d.color],
    [t.request.extras, d.extras?.length ? d.extras.map((x) => ru.requests.extras[x]).join(", ") : null],
    [t.request.description, d.description, true],
    [t.request.city, r.city],
    [t.request.desiredDate, r.desiredDate ? formatDate(r.desiredDate) : null],
    [t.request.published, r.publishedAt ? formatRelative(r.publishedAt, now) : null],
    [t.request.address, r.address ?? (addressHint ? t.request.addressHidden : null), true],
    [t.request.location, r.location && !r.address ? t.request.locationValue : null],
    [t.request.wishes, r.wishes, true],
  ];
  // Ссылки на карты — под адресом (а если адреса нет, а точка есть, — под строкой точки); координаты на экране не показываются.
  const map: DetailMap | null = r.address || r.location ? { point: r.location ?? null, address: r.address ?? null } : null;
  const mapLabel = r.address ? t.request.address : t.request.location;
  return rows.flatMap(([label, value, stacked]) => (value ? [{ label, value, stacked: stacked === true, ...(map && label === mapLabel ? { map } : {}) }] : []));
}

/** Снимки помещения с описанием по порядку; снимок без адреса (ещё нельзя показать) пропускается. */
export function photoView(photos: readonly { id: string; src: string | null }[]): RequestViewModel["photos"] {
  const shown = photos.flatMap((p) => (p.src ? [{ id: p.id, src: p.src }] : []));
  return shown.map((p, index) => ({ ...p, alt: t.request.photoAlt(index + 1, shown.length) }));
}

/**
 * Чистая view-модель экрана заявки мастера: из `getIncomingRequest` и (если есть своё предложение на пути ТЗ)
 * `getNegotiation`. Покупатель не назван: имя и контакты модуль до оферты не отдаёт. Суммы — тиыны из модуля.
 */
export function requestView(r: IncomingRequest, n: NegotiationView | null, now: Date = new Date()): RequestViewModel {
  const state = masterState({
    canOffer: r.canOffer,
    retryAllowed: r.retryAllowed,
    status: r.status,
    myOffer: r.myOffer,
    negotiation: n,
  });
  const live = state.kind === "buyerPrice" || state.kind === "waiting" || state.kind === "noPrice";
  const buyerOpen = n?.open && !n.open.mine ? n.open.amountTiyn : null;
  const offerId = state.kind === "form" ? null : (r.myOffer?.id ?? null);
  // Договориться уже нельзя: ни подсказки об адресе, ни строки о контактах (они не откроются).
  const over = state.kind === "closed" || state.kind === "unavailable";
  return {
    state,
    title: r.title,
    lead: { number: t.numberLine(r.number), direct: r.mode === "DIRECT" ? t.direct : null, invited: r.invited ? t.invited : null },
    back: { href: to("/executor/requests"), label: t.back },
    ...nowOf(state, n),
    ...actionsOf(state, n),
    declineInvitation: r.invitation === "INVITED" && r.status === "OPEN" ? { requestId: r.id } : null,
    withdrawOffer: live && r.myOffer ? { offerId: r.myOffer.id } : null,
    offerId,
    proposeDescription: buyerOpen === null ? t.propose.description : t.propose.buyerPrice(formatMoney(buyerOpen)),
    money: moneyOf(state, n),
    conditions: conditionsOf(state, r.myOffer),
    details: detailRows(r, now, !over),
    photos: photoView(r.photos),
    design: designView(r.design, t.request.design),
    chat: offerId ? { href: to(`/chats/${encodeURIComponent(offerId)}`), label: over ? t.actions.chatClosed : t.actions.chat } : null,
    contactsNote: over ? null : state.kind === "deal" ? t.request.contactsDeal : t.request.contacts,
    // У формы (в том числе новой попытки) истории нет: прошлый торг закрыт и к новому предложению не относится.
    history: state.kind === "form" ? [] : historyOf(n),
  };
}
