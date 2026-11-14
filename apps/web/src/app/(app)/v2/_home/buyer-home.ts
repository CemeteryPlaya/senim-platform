import { ACTIVE_DEAL } from "@/features/deal-progress/active-deal";
import type { DealStatus, RequestStatus } from "@/generated/prisma/enums";
import type { NextAction } from "@/modules/deal-core";
import { ru } from "@/i18n/ru";
import { to } from "../../_shell/paths";

// Ход и тон плашки сделки — общие с экранами сделок (`../_parts/deal-summary`).
export { dealProgress, dealTone, type DealProgress, type DealTone } from "../_parts/deal-summary";

/**
 * Что показать покупателю на главной: чистая логика без React и без обращений к модулям. Страница читает данные
 * (заявки, сделки, «что дальше» по сделке) и отдаёт их сюда; функция выбирает одно «Сейчас», одно главное действие и
 * то, что идёт ниже. Тексты — в `ru.app.buyer.home` (здесь только виды и адреса).
 */

/** Сделка покупателя в объёме, нужном главной. Порядок — как отдал модуль (свежие первыми). */
export type HomeDealInput = {
  id: string;
  title: string;
  status: DealStatus;
  hasOpenDispute: boolean;
  /** Деньги по журналу уже внесены (всё, кроме «ждём оплату»): первые шаги больше не нужны. */
  paid: boolean;
  /** «Что дальше» из модуля; `null` — не удалось прочитать (сделка всё равно показывается). */
  next: { action: NextAction; mine: boolean } | null;
  /** Шаг — оплата, но она закрыта до согласия мастера для банка (`payWaitsMaster`): это ожидание, а не моё действие. */
  payWaitsMaster?: boolean;
};

/** Заявка покупателя; порядок — как отдал модуль (свежие первыми). */
export type HomeRequestInput = {
  id: string;
  number: number;
  title: string;
  status: RequestStatus;
  offersCount: number;
};

export type HomeInput = { deals: readonly HomeDealInput[]; requests: readonly HomeRequestInput[] };

/** Что стоит в карточке «Сейчас». */
export type NowKind =
  | "sign-offer"
  | "pay"
  | "accept"
  | "review"
  | "deal-dispute"
  | "deal-waiting"
  | "deal-unknown"
  | "offers"
  | "draft"
  | "request-waiting"
  | "request-chosen"
  | "empty";

/** Единственное главное действие экрана: какой подписью (ключ в `ru.app.buyer.home.now`) и куда. */
export type PrimaryAction = { kind: "signOffer" | "pay" | "accept" | "review" | "offers" | "draft" | "order"; href: string };

export type BuyerHomeView = {
  now: {
    kind: NowKind;
    /** Для `deal-waiting`: что именно ждём (подпись); `null` — общая. */
    waitAction: WaitAction | null;
    /** Для `offers`: сколько предложений. */
    offersCount: number;
    /** Заявка, о которой говорит «Сейчас» (для названия и отдельной карточки в списке). */
    request: HomeRequestInput | null;
  };
  /** Одно главное действие или `null`, когда от человека ничего не нужно. */
  primary: PrimaryAction | null;
  /** Второстепенная ссылка под «Сейчас» (ожидание заявки): `null`, если не нужна. */
  secondary: { href: string } | null;
  /** Сделка для карточки со сделкой: та, о которой «Сейчас», иначе самая свежая из идущих. */
  deal: HomeDealInput | null;
  /** Сколько ещё идущих сделок, кроме показанной: «Все сделки». */
  moreDeals: number;
  /** До двух живых заявок для списка; заявка из «Сейчас» отдельной карточкой не повторяется. */
  requests: HomeRequestInput[];
  /** Первые шаги; `null` — у человека уже есть оплаченная сделка. */
  firstSteps: { order: FirstStepState; master: FirstStepState; pay: FirstStepState } | null;
};

export type FirstStepState = { done: boolean; href?: string };

/** Какое действие от покупателя; порядок — срочность между разными сделками. */
const MINE: readonly { action: NextAction; now: NowKind; primary: PrimaryAction["kind"] }[] = [
  { action: "pay", now: "pay", primary: "pay" },
  { action: "signAct", now: "accept", primary: "accept" },
  { action: "signContract", now: "sign-offer", primary: "signOffer" },
  { action: "leaveReview", now: "review", primary: "review" },
];

/** Ожидание другой стороны или банка, у которого есть своя подпись; остальное — общая. */
export const WAIT_ACTIONS = [
  "waitContractSignature",
  "waitPaymentConfirmation",
  "waitStart",
  "waitReady",
  "waitMasterActSignature",
  "waitPayout",
  "waitRefund",
] as const satisfies readonly NextAction[];
/** Ожидание другой стороны: шаги модуля и закрытая до согласия мастера оплата (`waitMasterBank`). */
export type WaitAction = (typeof WAIT_ACTIONS)[number] | "waitMasterBank";
const waitOf = (action: NextAction | undefined): WaitAction | null => WAIT_ACTIONS.find((w) => w === action) ?? null;

/**
 * Живая заявка без сделки. CONTRACTING и CLOSED — сделка по заявке уже создана (оферта), её показывает карточка сделки,
 * поэтому в «Мои заявки» и в «Сейчас» такая заявка не попадает.
 */
const LIVE_REQUEST: ReadonlySet<RequestStatus> = new Set(["PLATFORM_MEASURING", "OPEN", "OFFER_CHOSEN", "MEASURING"]);
const CHOSEN_REQUEST: ReadonlySet<RequestStatus> = new Set(["OFFER_CHOSEN", "MEASURING"]);
const WITH_DEAL_REQUEST: ReadonlySet<RequestStatus> = new Set(["CONTRACTING", "CLOSED"]);

const dealHref = (id: string) => to(`/deals/${encodeURIComponent(id)}`);
const requestHref = (id: string) => to(`/requests/${encodeURIComponent(id)}`);
const draftHref = (id: string) => to(`/requests/new?draft=${encodeURIComponent(id)}`);
const ORDER_HREF = to("/requests/new");

type Now = BuyerHomeView["now"];
type Picked = { now: Now; primary: PrimaryAction | null; secondary: { href: string } | null; deal: HomeDealInput | null };

const nowOf = (kind: NowKind, rest: Partial<Now> = {}): Now => ({ kind, waitAction: null, offersCount: 0, request: null, ...rest });

/**
 * Выбор «Сейчас» по приоритету: (1) сделка ждёт действия покупателя; (2) спор или ожидание другой стороны;
 * (3) заявка с предложениями; (4) черновик; (5) заявка без предложений или с выбранным мастером; (6) пусто.
 */
function pick({ deals, requests }: HomeInput): Picked {
  // (1) Моё действие по сделке: самая срочная, при равенстве — самая свежая.
  for (const rule of MINE) {
    const deal = deals.find((d) => d.next?.mine === true && d.next.action === rule.action && !d.payWaitsMaster);
    if (deal) return { now: nowOf(rule.now), primary: { kind: rule.primary, href: dealHref(deal.id) }, secondary: null, deal };
  }
  // (2) Спор — раньше обычного ожидания; ожидание — у идущих сделок.
  const dispute = deals.find((d) => ACTIVE_DEAL.has(d.status) && d.hasOpenDispute);
  if (dispute) return { now: nowOf("deal-dispute"), primary: null, secondary: null, deal: dispute };
  const waiting = deals.find((d) => ACTIVE_DEAL.has(d.status));
  if (waiting) {
    if (waiting.payWaitsMaster) return { now: nowOf("deal-waiting", { waitAction: "waitMasterBank" }), primary: null, secondary: null, deal: waiting };
    // «От вас ничего не требуется» — только при известном «чужом ходе»; не знаем (или действие не из известных) — открыть сделку.
    if (waiting.next === null || waiting.next.mine) {
      return { now: nowOf("deal-unknown"), primary: null, secondary: { href: dealHref(waiting.id) }, deal: waiting };
    }
    return { now: nowOf("deal-waiting", { waitAction: waitOf(waiting.next.action) }), primary: null, secondary: null, deal: waiting };
  }
  // (3) Заявка с предложениями.
  const offered = requests.find((r) => r.status === "OPEN" && r.offersCount > 0);
  if (offered) {
    const now = nowOf("offers", { offersCount: offered.offersCount, request: offered });
    return { now, primary: { kind: "offers", href: requestHref(offered.id) }, secondary: null, deal: null };
  }
  // (4) Черновик.
  const draft = requests.find((r) => r.status === "DRAFT");
  if (draft) return { now: nowOf("draft", { request: draft }), primary: { kind: "draft", href: draftHref(draft.id) }, secondary: null, deal: null };
  // (5) Живая заявка: ждём мастеров или идёт с выбранным.
  const live = requests.find((r) => LIVE_REQUEST.has(r.status));
  if (live) {
    const kind = CHOSEN_REQUEST.has(live.status) ? "request-chosen" : "request-waiting";
    return { now: nowOf(kind, { request: live }), primary: null, secondary: { href: requestHref(live.id) }, deal: null };
  }
  // (6) Ничего нет.
  return { now: nowOf("empty"), primary: { kind: "order", href: ORDER_HREF }, secondary: null, deal: null };
}

/** Что показать на главной покупателя. */
export function buyerHome(input: HomeInput): BuyerHomeView {
  const { deals, requests } = input;
  const picked = pick(input);
  const running = deals.filter((d) => ACTIVE_DEAL.has(d.status));
  // Карточка сделки: та, о которой «Сейчас»; иначе самая свежая из идущих.
  const deal = picked.deal ?? running[0] ?? null;
  const moreDeals = deal && ACTIVE_DEAL.has(deal.status) ? running.length - 1 : running.length;

  const listed = requests.filter((r) => (LIVE_REQUEST.has(r.status) || r.status === "DRAFT") && r.id !== picked.now.request?.id).slice(0, 2);

  // Первые шаги считаем по идущим и завершённым сделкам: отменённая или возвращённая путь не продвигает.
  const counted = deals.filter((d) => d.status !== "CANCELLED" && d.status !== "REFUNDED");
  const paid = counted.some((d) => d.paid);
  const ordered = requests.some((r) => LIVE_REQUEST.has(r.status) || WITH_DEAL_REQUEST.has(r.status)) || counted.length > 0;
  const chosen = counted.length > 0 || requests.some((r) => CHOSEN_REQUEST.has(r.status) || WITH_DEAL_REQUEST.has(r.status));
  const payDeal = running[0];
  const steps = {
    order: { done: ordered, href: ORDER_HREF } as FirstStepState,
    master: { done: chosen, ...(requests.length > 0 ? { href: to("/requests") } : {}) } as FirstStepState,
    pay: { done: false, ...(payDeal ? { href: dealHref(payDeal.id) } : {}) } as FirstStepState,
  };
  // Ссылка только у будущих шагов: текущий (первый невыполненный) — это и есть главное действие «Сейчас».
  const current = (["order", "master", "pay"] as const).find((k) => !steps[k].done);
  if (current) steps[current] = { done: false };
  for (const k of ["order", "master", "pay"] as const) if (steps[k].done) steps[k] = { done: true };
  const firstSteps = paid ? null : steps;

  return { now: picked.now, primary: picked.primary, secondary: picked.secondary, deal, moreDeals, requests: listed, firstSteps };
}

/** Статус заявки словами покупателя (число предложений — внутри текста, не второй раз рядом). */
export function requestStatusText(status: RequestStatus, offersCount: number): string {
  const s = ru.app.buyer.home.requests.status;
  switch (status) {
    case "OPEN":
      return offersCount > 0 ? s.offers(offersCount) : s.open;
    case "DRAFT":
      return s.draft;
    case "PLATFORM_MEASURING":
      return s.platformMeasuring;
    case "OFFER_CHOSEN":
      return s.offerChosen;
    case "MEASURING":
      return s.measuring;
    case "CONTRACTING":
    case "CLOSED":
      return s.deal;
    case "CANCELLED":
      return s.cancelled;
  }
}

/**
 * Имя для приветствия из ФИО «Фамилия Имя Отчество» (как в удостоверении, так просит анкета): второе слово — только когда
 * слов ровно три. Другое число слов — имени нет (порядок не угадать: «Имя Фамилия» и «Фамилия Имя» не отличить). Слова ЗАГЛАВНЫМИ приводятся к «Имя»; дефисные части — каждая отдельно.
 */
export function firstName(fullName: string | null): string | null {
  const words = (fullName ?? "").trim().split(/\s+/).filter(Boolean);
  const name = words.length === 3 ? words[1] : undefined;
  if (!name) return null;
  return name
    .split("-")
    .map((part) => (part === part.toUpperCase() ? part.charAt(0) + part.slice(1).toLowerCase() : part))
    .join("-");
}
