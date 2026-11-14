import { ACTIVE_DEAL } from "@/features/deal-progress/active-deal";
import type { DealStatus } from "@/generated/prisma/enums";
import type { NextAction } from "@/modules/deal-core";
import type { KycState } from "@/modules/identity";
import { to } from "../../_shell/paths";

/**
 * Что показать мастеру на главной: чистая логика без React и без обращений к модулям. Страница читает данные (сделки,
 * «что дальше», торг, новые заявки, документы и счёт) и отдаёт их сюда; функция выбирает одно «Сейчас», одно главное
 * действие и ссылку. Тексты — в `ru.app.masterRequests.home` (здесь только виды и адреса).
 *
 * Приоритет «Сейчас» (первое подходящее):
 *  1. сделка ждёт моего действия — подписать акт, подписать оферту, дать согласие для банка, начать работу;
 *  2. покупатель ответил в торге своей ценой;
 *  3. есть новые заявки (на которые я ещё не отвечал);
 *  4. документы не загружены или отклонены; счёт для выплаты не указан; документы на проверке;
 *  5. идёт работа по сделке (сдать работу можно с экрана сделки; главной кнопки нет);
 *  6. ничего.
 */

/** Сделка мастера в объёме, нужном главной. Порядок — как отдал модуль (свежие первыми). */
export type MasterDealInput = {
  id: string;
  title: string;
  status: DealStatus;
  hasOpenDispute: boolean;
  /** «Что дальше» из модуля; `null` — не удалось прочитать (сделка всё равно показывается). */
  next: { action: NextAction; mine: boolean } | null;
  /** Оферта заключена, а согласия мастера для банка нет (`masterConsentMissing`): оплату закрывает он. */
  consentMissing: boolean;
};

/** Встречная цена покупателя по моему предложению: торг идёт, ход мой. */
export type MasterCounterInput = { requestId: string; requestTitle: string; amountTiyn: bigint };

/** Документы и счёт: читаются, только когда нет более срочного. `null` — не читались или не прочитались. */
export type MasterDocsInput = { kyc: KycState; payoutSet: boolean };

export type MasterHomeInput = {
  deals: readonly MasterDealInput[];
  counters: readonly MasterCounterInput[];
  /** Новые заявки: мастер ещё не отвечал. */
  freshCount: number;
  docs: MasterDocsInput | null;
};

export type MasterNowKind =
  | "sign-offer"
  | "bank-consent"
  | "start"
  | "sign-act"
  | "counter"
  | "fresh"
  | "kyc"
  | "kyc-rejected"
  | "payout"
  | "kyc-pending"
  | "in-work"
  | "empty";

/** Главное действие: ключ подписи в `ru.app.masterRequests.home.now.<ключ>.action` и адрес. */
export type MasterPrimary = {
  kind: "signOffer" | "bankConsent" | "start" | "signAct" | "counter" | "fresh" | "kyc" | "kycRejected" | "payout";
  href: string;
};

export type MasterHomeView = {
  now: {
    kind: MasterNowKind;
    /** Сделка, о которой «Сейчас» (для названия); иначе `null`. */
    deal: MasterDealInput | null;
    counter: MasterCounterInput | null;
    /** Для `fresh`: сколько новых заявок. */
    freshCount: number;
  };
  primary: MasterPrimary | null;
  /** Ссылка под «Сейчас», когда главного действия нет. */
  secondary: { href: string } | null;
};

const dealHref = (id: string) => to(`/deals/${encodeURIComponent(id)}`);
export const MASTER_HREFS = {
  fresh: to("/executor/requests?f=new"),
  kyc: to("/executor/profile/kyc"),
  payout: to("/executor/profile/payout"),
  company: to("/executor/profile"),
  requests: to("/executor/requests"),
} as const;

/** Шаги сделки, где ход мастера, по срочности: акт, оферта, согласие для банка, начало работы. */
const DEAL_RULES: readonly { now: MasterNowKind; primary: MasterPrimary["kind"]; match: (d: MasterDealInput) => boolean }[] = [
  { now: "sign-act", primary: "signAct", match: (d) => d.next?.action === "signActEcp" && d.next.mine },
  { now: "sign-offer", primary: "signOffer", match: (d) => d.next?.action === "signContract" && d.next.mine },
  { now: "bank-consent", primary: "bankConsent", match: (d) => d.consentMissing },
  { now: "start", primary: "start", match: (d) => d.next?.action === "startWork" && d.next.mine },
];

const base = (kind: MasterNowKind, rest: Partial<MasterHomeView["now"]> = {}): MasterHomeView["now"] => ({ kind, deal: null, counter: null, freshCount: 0, ...rest });

/** Идущие сделки мастера: завершённые, отменённые и с возвратом в «Сейчас» не попадают. */
export const runningDeals = (deals: readonly MasterDealInput[]): MasterDealInput[] => deals.filter((d) => ACTIVE_DEAL.has(d.status));

function docsView(docs: MasterDocsInput | null): MasterHomeView | null {
  if (docs === null) return null;
  if (docs.kyc === "REJECTED") return { now: base("kyc-rejected"), primary: { kind: "kycRejected", href: MASTER_HREFS.kyc }, secondary: null };
  if (docs.kyc === "NOT_SUBMITTED") return { now: base("kyc"), primary: { kind: "kyc", href: MASTER_HREFS.kyc }, secondary: null };
  if (!docs.payoutSet) return { now: base("payout"), primary: { kind: "payout", href: MASTER_HREFS.payout }, secondary: null };
  if (docs.kyc === "PENDING") return { now: base("kyc-pending"), primary: null, secondary: { href: MASTER_HREFS.kyc } };
  return null;
}

/** Выбор «Сейчас», главного действия и ссылки по приоритету (см. шапку файла). */
export function masterHome({ deals, counters, freshCount, docs }: MasterHomeInput): MasterHomeView {
  const running = runningDeals(deals);
  // 1. Моё действие по сделке: самая срочная, при равенстве — самая свежая.
  for (const rule of DEAL_RULES) {
    const deal = running.find(rule.match);
    if (deal) return { now: base(rule.now, { deal }), primary: { kind: rule.primary, href: dealHref(deal.id) }, secondary: null };
  }
  // 2. Покупатель ответил своей ценой.
  const counter = counters[0];
  if (counter) {
    return { now: base("counter", { counter }), primary: { kind: "counter", href: to(`/executor/requests/${encodeURIComponent(counter.requestId)}`) }, secondary: null };
  }
  // 3. Новые заявки.
  if (freshCount > 0) return { now: base("fresh", { freshCount }), primary: { kind: "fresh", href: MASTER_HREFS.fresh }, secondary: null };
  // 4. Документы и счёт.
  const docsNow = docsView(docs);
  if (docsNow) return docsNow;
  // 5. Идёт работа: сдача — с экрана сделки.
  const working = running.find((d) => !d.hasOpenDispute) ?? running[0];
  if (working) return { now: base("in-work", { deal: working }), primary: null, secondary: { href: dealHref(working.id) } };
  // 6. Ничего.
  return { now: base("empty"), primary: null, secondary: { href: MASTER_HREFS.company } };
}

/** Сколько сделок и новых заявок показывает главная; остальные — по ссылкам «Все сделки» и «Все заявки». */
export const SHOWN_DEALS = 2;
export const SHOWN_REQUESTS = 3;

/**
 * Сделки для блока на главной: до `SHOWN_DEALS`, первой — та, о которой «Сейчас» (если она идёт), дальше — как отдал
 * модуль (свежие первыми); `more` — сколько идущих сделок осталось за пределами блока («Все сделки»).
 */
export function shownDeals<T extends { id: string }>(running: readonly T[], nowId: string | null): { shown: T[]; more: number } {
  const first = running.find((d) => d.id === nowId);
  const ordered = first ? [first, ...running.filter((d) => d.id !== nowId)] : [...running];
  return { shown: ordered.slice(0, SHOWN_DEALS), more: Math.max(0, ordered.length - SHOWN_DEALS) };
}

/** Состояние первого шага: сделан и, если нет, куда вести. */
export type MasterStepState = { done: boolean; href?: string };

/** Первые шаги мастера: профиль → документы → счёт → первое предложение. */
export type MasterFirstSteps = { documents: MasterStepState; payout: MasterStepState; offer: MasterStepState };

/**
 * Первые шаги мастера на главной; `null` — не показывать (все сделаны или документы не прочитались). Профиль к этому
 * экрану уже проверен (шаги — только у одобренного), поэтому он всегда сделан. Документы сделаны, когда загружены (на
 * проверке или проверены; отказ — нет), счёт — когда указан, первое предложение — когда есть хоть одно предложение или
 * сделка. Шаг, на который уже ведёт главное действие «Сейчас», без ссылки: действие на экране одно. Только чтение данных
 * модулей, ничего не считается.
 */
export function masterFirstSteps({ docs, offered, primaryHref }: { docs: MasterDocsInput | null; offered: boolean; primaryHref: string | null }): MasterFirstSteps | null {
  if (docs === null) return null;
  const link = (done: boolean, href: string): MasterStepState => (done ? { done } : primaryHref === href ? { done } : { done, href });
  const steps: MasterFirstSteps = {
    documents: link(docs.kyc === "PENDING" || docs.kyc === "VERIFIED", MASTER_HREFS.kyc),
    payout: link(docs.payoutSet, MASTER_HREFS.payout),
    offer: link(offered, MASTER_HREFS.requests),
  };
  return Object.values(steps).every((step) => step.done) ? null : steps;
}
