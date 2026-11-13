import type { DealStatus, RequestStatus } from "@/generated/prisma/enums";
import type { NextAction } from "@/modules/deal-core";
import { dealProgressView } from "@/features/deal-progress/deal-progress";
import { to } from "../../_shell/paths";

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

/** Сделка идёт (то, что показывает главная): до выплаты включительно. */
const ACTIVE: ReadonlySet<DealStatus> = new Set(["CREATED", "PAID_HOLD", "IN_PROGRESS", "READY", "ACCEPTED"]);

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
export type WaitAction = (typeof WAIT_ACTIONS)[number];
const waitOf = (action: NextAction | undefined): WaitAction | null => WAIT_ACTIONS.find((w) => w === action) ?? null;

const LIVE_REQUEST: ReadonlySet<RequestStatus> = new Set(["PLATFORM_MEASURING", "OPEN", "OFFER_CHOSEN", "MEASURING", "CONTRACTING"]);
const CHOSEN_REQUEST: ReadonlySet<RequestStatus> = new Set(["OFFER_CHOSEN", "MEASURING", "CONTRACTING"]);

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
    const deal = deals.find((d) => d.next?.mine === true && d.next.action === rule.action);
    if (deal) return { now: nowOf(rule.now), primary: { kind: rule.primary, href: dealHref(deal.id) }, secondary: null, deal };
  }
  // (2) Спор — раньше обычного ожидания; ожидание — у идущих сделок.
  const dispute = deals.find((d) => ACTIVE.has(d.status) && d.hasOpenDispute);
  if (dispute) return { now: nowOf("deal-dispute"), primary: null, secondary: null, deal: dispute };
  const waiting = deals.find((d) => ACTIVE.has(d.status));
  if (waiting) {
    return { now: nowOf("deal-waiting", { waitAction: waitOf(waiting.next?.action) }), primary: null, secondary: null, deal: waiting };
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
  const running = deals.filter((d) => ACTIVE.has(d.status));
  // Карточка сделки: та, о которой «Сейчас»; иначе самая свежая из идущих.
  const deal = picked.deal ?? running[0] ?? null;
  const moreDeals = deal && ACTIVE.has(deal.status) ? running.length - 1 : running.length;

  const listed = requests.filter((r) => (LIVE_REQUEST.has(r.status) || r.status === "DRAFT") && r.id !== picked.now.request?.id).slice(0, 2);

  const paid = deals.some((d) => d.paid);
  const ordered = requests.some((r) => r.status !== "DRAFT" && r.status !== "CANCELLED") || deals.length > 0;
  const chosen = deals.length > 0 || requests.some((r) => CHOSEN_REQUEST.has(r.status) || r.status === "CLOSED");
  const firstSteps = paid
    ? null
    : {
        order: { done: ordered, ...(ordered ? {} : { href: ORDER_HREF }) },
        master: { done: chosen, ...(chosen || requests.length === 0 ? {} : { href: to("/requests") }) },
        pay: { done: false, ...(deals[0] ? { href: dealHref(deals[0].id) } : {}) },
      };

  return { now: picked.now, primary: picked.primary, secondary: picked.secondary, deal, moreDeals, requests: listed, firstSteps };
}

export type DealStepState = "done" | "current" | "todo";
export type DealSteps =
  | { kind: "steps"; states: DealStepState[] }
  | { kind: "stopped"; reason: "dispute" | "cancelled" | "refunded" };

/** Ход сделки для `Steps`: пять шагов (оплата … выплата) с состояниями; спор, отмена и возврат — одна строка. */
export function dealSteps(status: DealStatus, hasOpenDispute: boolean): DealSteps {
  const view = dealProgressView(status, hasOpenDispute);
  if (view.kind === "banner") return { kind: "stopped", reason: view.tone };
  if (view.muted) return { kind: "stopped", reason: "dispute" };
  const states = Array.from({ length: 5 }, (_, i): DealStepState => (i < view.current ? "done" : i === view.current ? "current" : "todo"));
  return { kind: "steps", states };
}

/**
 * Имя для приветствия из ФИО «Фамилия Имя [Отчество]» (как в удостоверении, так просит анкета): второе слово. Одно слово
 * или пусто — имени нет (не гадаем, что это). Слова ЗАГЛАВНЫМИ приводятся к «Имя»; дефисные части — каждая отдельно.
 */
export function firstName(fullName: string | null): string | null {
  const words = (fullName ?? "").trim().split(/\s+/).filter(Boolean);
  const name = words[1];
  if (!name) return null;
  return name
    .split("-")
    .map((part) => (part === part.toUpperCase() ? part.charAt(0) + part.slice(1).toLowerCase() : part))
    .join("-");
}
