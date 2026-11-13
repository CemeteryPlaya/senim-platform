import { formatDateTime, formatDays, formatMonths } from "@/features/format/format";
import { ru } from "@/i18n/ru";
import { formatMoney } from "@/kit";
import type { NegotiationView, OfferDetail } from "@/modules/requests";
import { to } from "../../../../../../_shell/paths";

const t = ru.app.offer;

type Round = NegotiationView["rounds"][number];

/**
 * Состояние торга глазами покупателя — по тому, что отдаёт модуль (`getNegotiation` + статусы отклика и заявки):
 *
 * | kind            | когда                                                            | главное            | второстепенное   |
 * |-----------------|------------------------------------------------------------------|--------------------|------------------|
 * | `deal`          | цена принята, сделка есть (`dealId`)                             | «Открыть сделку»   | —                |
 * | `closed`        | торг не идёт (`live` = false) и сделки нет: заявка отменена,     | —                  | —                |
 * |                 | выбран другой мастер (отклик DECLINED) или иное                  |                    |                  |
 * | `masterPrice`   | открыта цена мастера, покупатель цен ещё не называл              | «Принять X»        | «Предложить…»    |
 * | `masterCounter` | открыта цена мастера в ответ на цену покупателя                  | «Принять X»        | «Предложить…»    |
 * | `waiting`       | открыта своя цена, ждёт мастера                                  | —                  | «Отозвать…»      |
 * | `noPrice`       | торг идёт, открытой цены нет: отозвал мастер или сам покупатель  | «Предложить…»      | —                |
 *
 * Предложение мастера, отозванное целиком (отклик WITHDRAWN), модуль не отдаёт вовсе (`getOfferForClient` → NOT_FOUND):
 * экрана нет, страница отвечает 404.
 */
export type OfferState =
  | { kind: "deal"; dealId: string }
  | { kind: "closed"; reason: "requestCancelled" | "otherChosen" | "closed" }
  | { kind: "masterPrice" | "masterCounter" | "waiting"; proposalId: string; amountTiyn: bigint }
  | { kind: "noPrice"; by: "master" | "you" };

export type OfferStateInput = Pick<NegotiationView, "live" | "open" | "dealId"> & {
  rounds: readonly Pick<Round, "party" | "mine">[];
  offerStatus: OfferDetail["status"];
  requestStatus: OfferDetail["request"]["status"];
};

/** Чистая функция: состояние торга для экрана (правила переходов — в модуле; здесь только чтение). */
export function offerState(input: OfferStateInput): OfferState {
  if (input.dealId) return { kind: "deal", dealId: input.dealId };
  if (!input.live) {
    if (input.requestStatus === "CANCELLED") return { kind: "closed", reason: "requestCancelled" };
    if (input.offerStatus === "DECLINED") return { kind: "closed", reason: "otherChosen" };
    return { kind: "closed", reason: "closed" };
  }
  const open = input.open;
  if (open?.mine) return { kind: "waiting", proposalId: open.id, amountTiyn: open.amountTiyn };
  if (open) {
    const answered = input.rounds.some((r) => r.mine);
    return { kind: answered ? "masterCounter" : "masterPrice", proposalId: open.id, amountTiyn: open.amountTiyn };
  }
  return { kind: "noPrice", by: input.rounds.at(-1)?.mine ? "you" : "master" };
}

/** Главное действие экрана (не больше одного). */
export type PrimaryAction =
  | { kind: "accept"; proposalId: string; label: string; confirmTitle: string; confirmDescription: string }
  | { kind: "propose" }
  | { kind: "deal"; href: string; label: string };

export type SecondaryAction = { kind: "propose" } | { kind: "withdraw"; proposalId: string };

export type MoneyView = {
  title: string;
  amountTiyn: bigint;
  rows: { label: string; amountTiyn: bigint; total?: true; explain?: true }[];
  note?: string;
};

export type OfferViewModel = {
  state: OfferState;
  title: string;
  back: { href: string; label: string };
  now: { title: string; body?: string };
  next?: string;
  primary: PrimaryAction | null;
  secondary: SecondaryAction | null;
  /** Смета покупателя по текущей цене; нет — когда цены, которую можно принять или ждать, нет. */
  money: MoneyView | null;
  conditions: { label: string; value: string; stacked?: true }[];
  executor: { rating: { value: number | null; count: number }; deals: number; profileHref: string };
  chatHref: string;
  history: { title: string; time: string; text: string; amountTiyn: bigint }[];
};

function nowOf(state: OfferState, n: NegotiationView): Pick<OfferViewModel, "now" | "next"> {
  const price = formatMoney(n.estimate.priceTiyn);
  const total = formatMoney(n.estimate.totalTiyn);
  switch (state.kind) {
    case "masterPrice":
    case "masterCounter": {
      const s = t.now[state.kind];
      return { now: { title: s.title(formatMoney(state.amountTiyn)), body: s.body(total) }, next: s.next };
    }
    case "waiting":
      return { now: { title: t.now.waiting.title, body: t.now.waiting.body(formatMoney(state.amountTiyn)) }, next: t.now.waiting.next };
    case "noPrice": {
      const s = state.by === "you" ? t.now.youWithdrew : t.now.masterWithdrew;
      return { now: { title: s.title, body: s.body }, next: s.next };
    }
    case "deal":
      return { now: { title: t.now.deal.title, body: t.now.deal.body(price) }, next: t.now.deal.next };
    case "closed": {
      const s = t.now[state.reason];
      return { now: { title: s.title, body: s.body } };
    }
  }
}

function actionsOf(state: OfferState, n: NegotiationView): Pick<OfferViewModel, "primary" | "secondary"> {
  switch (state.kind) {
    case "masterPrice":
    case "masterCounter": {
      const price = formatMoney(state.amountTiyn);
      return {
        primary: {
          kind: "accept",
          proposalId: state.proposalId,
          label: t.actions.accept(price),
          confirmTitle: t.acceptConfirm.title(price),
          confirmDescription: t.acceptConfirm.description({
            price,
            protection: formatMoney(n.estimate.extraTiyn),
            total: formatMoney(n.estimate.totalTiyn),
          }),
        },
        secondary: n.can.propose ? { kind: "propose" } : null,
      };
    }
    case "waiting":
      return { primary: null, secondary: { kind: "withdraw", proposalId: state.proposalId } };
    case "noPrice":
      return { primary: n.can.propose ? { kind: "propose" } : null, secondary: null };
    case "deal":
      return { primary: { kind: "deal", href: to(`/deals/${encodeURIComponent(state.dealId)}`), label: t.actions.openDeal }, secondary: null };
    case "closed":
      return { primary: null, secondary: null };
  }
}

/** Смета из `partyEstimate` модуля (n.estimate): цена, защита сделки 2% вверх до тиына, к оплате. Ничего не считается здесь. */
function moneyOf(state: OfferState, n: NegotiationView): MoneyView | null {
  const priceLabel =
    state.kind === "masterPrice" || state.kind === "masterCounter"
      ? t.money.price.master
      : state.kind === "waiting"
        ? t.money.price.yours
        : state.kind === "deal"
          ? t.money.price.deal
          : null;
  if (priceLabel === null) return null;
  const e = n.estimate;
  const note = state.kind === "waiting" ? t.money.note.waiting : state.kind === "deal" ? t.money.note.deal : undefined;
  return {
    title: t.money.title,
    amountTiyn: e.totalTiyn,
    rows: [
      { label: priceLabel, amountTiyn: e.priceTiyn },
      { label: t.money.protection, amountTiyn: e.extraTiyn, explain: true },
      { label: t.money.total, amountTiyn: e.totalTiyn, total: true },
    ],
    ...(note ? { note } : {}),
  };
}

function conditionsOf(offer: OfferDetail): OfferViewModel["conditions"] {
  const rows: OfferViewModel["conditions"] = [
    { label: t.conditions.duration, value: formatDays(offer.durationDays) },
    { label: t.conditions.warranty, value: formatMonths(offer.warrantyMonths) },
  ];
  const comment = offer.comment.trim();
  if (comment) rows.push({ label: t.conditions.comment, value: comment, stacked: true });
  return rows;
}

function historyOf(n: NegotiationView): OfferViewModel["history"] {
  return n.rounds.map((r) => ({
    title: r.mine ? t.history.you : t.history.master,
    time: formatDateTime(r.createdAt),
    text: t.history.status[r.status],
    amountTiyn: r.amountTiyn,
  }));
}

/**
 * Чистая view-модель экрана предложения: из `getOfferForClient` и `getNegotiation` — заголовок, «Сейчас / Дальше»,
 * действия по состоянию торга, смета покупателя, условия, мастер и история цены. Мастер — ровно как его отдал модуль
 * (`publicExecutorView`: «Исполнитель №N», без телефона, Instagram и ИИН/БИН). Суммы — тиыны из модуля.
 */
export function offerView(offer: OfferDetail, n: NegotiationView): OfferViewModel {
  const state = offerState({
    live: n.live,
    open: n.open,
    dealId: n.dealId,
    rounds: n.rounds,
    offerStatus: offer.status,
    requestStatus: offer.request.status,
  });
  const ex = offer.executor;
  return {
    state,
    title: t.title(ex.label),
    back: { href: to(`/requests/${encodeURIComponent(offer.request.id)}`), label: offer.request.title },
    ...nowOf(state, n),
    ...actionsOf(state, n),
    money: moneyOf(state, n),
    conditions: conditionsOf(offer),
    executor: {
      rating: { value: ex.reviewsCount > 0 ? ex.ratingAvg : null, count: ex.reviewsCount },
      deals: ex.completedDeals,
      profileHref: to(`/executors/${ex.publicNumber}`),
    },
    chatHref: to(`/chats/${encodeURIComponent(offer.id)}`),
    history: historyOf(n),
  };
}
