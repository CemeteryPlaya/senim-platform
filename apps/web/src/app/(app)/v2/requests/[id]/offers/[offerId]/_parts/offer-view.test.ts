import { describe, expect, it } from "vitest";
import { formatDays, formatMonths } from "@/features/format/format";
import { ru } from "@/i18n/ru";
import { formatMoney } from "@/kit";
import { computeDealMoney } from "@/modules/payments/client";
import type { NegotiationView, OfferDetail } from "@/modules/requests";
import { offerState, offerView, type OfferState, type OfferStateInput } from "./offer-view";

const t = ru.app.offer;

type Round = NegotiationView["rounds"][number];

const at = new Date("2026-11-10T09:30:00Z");

function round(id: string, party: "CLIENT" | "EXECUTOR", kzt: number, status: Round["status"]): Round {
  return { id, party, mine: party === "CLIENT", amountTiyn: BigInt(kzt) * 100n, status, createdAt: at, decidedAt: null };
}

/** Смета покупателя — как её строит модуль (partyEstimate → computeDealMoney). */
function estimate(priceTiyn: bigint): NegotiationView["estimate"] {
  const m = computeDealMoney(priceTiyn);
  return { party: "CLIENT", priceTiyn, extraTiyn: m.protectionTiyn, totalTiyn: m.buyerTotalTiyn };
}

/** Торг глазами покупателя: раунды, открытое предложение — последнее PROPOSED, цена — принятая, открытая или последняя. */
function negotiation(rounds: Round[], opts: { live?: boolean; dealId?: string | null } = {}): NegotiationView {
  const live = opts.live ?? true;
  const open = rounds.find((r) => r.status === "PROPOSED") ?? null;
  const accepted = rounds.find((r) => r.status === "ACCEPTED") ?? null;
  const current = accepted ?? open ?? rounds.at(-1);
  const priceTiyn = current?.amountTiyn ?? 100n;
  const mine = open?.mine ?? false;
  return {
    offerId: "offer-1",
    party: "CLIENT",
    live,
    rounds,
    open: open && { id: open.id, party: open.party, mine, amountTiyn: open.amountTiyn },
    can: live ? { propose: !mine, accept: open !== null && !mine, withdraw: mine } : { propose: false, accept: false, withdraw: false },
    priceTiyn,
    estimate: estimate(priceTiyn),
    dealId: opts.dealId ?? null,
  };
}

function offer(over: { status?: OfferDetail["status"]; requestStatus?: OfferDetail["request"]["status"]; comment?: string } = {}): OfferDetail {
  return {
    id: "offer-1",
    status: over.status ?? "SENT",
    priceTiyn: 1_180_000_00n,
    durationDays: 25,
    warrantyMonths: 24,
    measurementTerms: "FREE",
    measurementFee: null,
    comment: over.comment ?? "Своё производство, срок фиксируем в оферте.",
    createdAt: at,
    canChoose: false,
    request: { id: "req-1", number: 18, title: "Кухня", status: over.requestStatus ?? "OPEN", path: "TZ" },
    executor: {
      id: "ex-1",
      publicNumber: 7,
      label: "Исполнитель №7",
      labelGen: "Исполнителя №7",
      labelDat: "Исполнителю №7",
      address: "Астана",
      nameShown: false,
      segment: "COMFORT",
      ratingAvg: 4.8,
      reviewsCount: 12,
      completedDeals: 31,
      yearsExperience: 6,
      measurementTerms: "FREE",
      measurementFee: null,
      specializations: [],
    },
    portfolio: [],
    reviews: [],
  };
}

const input = (n: NegotiationView, o: OfferDetail = offer()): OfferStateInput => ({
  live: n.live,
  open: n.open,
  dealId: n.dealId,
  rounds: n.rounds,
  offerStatus: o.status,
  requestStatus: o.request.status,
});

describe("offerState: каждая строка таблицы состояний", () => {
  const cases: [string, NegotiationView, OfferDetail, OfferState][] = [
    [
      "(1) цена мастера, покупатель цен не называл → masterPrice",
      negotiation([round("p1", "EXECUTOR", 1_180_000, "PROPOSED")]),
      offer(),
      { kind: "masterPrice", proposalId: "p1", amountTiyn: 1_180_000_00n },
    ],
    [
      "(2) своё предложение ждёт мастера → waiting",
      negotiation([round("p1", "EXECUTOR", 1_050_000, "SUPERSEDED"), round("p2", "CLIENT", 980_000, "PROPOSED")]),
      offer(),
      { kind: "waiting", proposalId: "p2", amountTiyn: 980_000_00n },
    ],
    [
      "(3) мастер ответил новой ценой → masterCounter",
      negotiation([round("p1", "EXECUTOR", 1_020_000, "SUPERSEDED"), round("p2", "CLIENT", 940_000, "SUPERSEDED"), round("p3", "EXECUTOR", 990_000, "PROPOSED")]),
      offer(),
      { kind: "masterCounter", proposalId: "p3", amountTiyn: 990_000_00n },
    ],
    [
      "(4) цена принята, сделка создана → deal",
      negotiation([round("p1", "EXECUTOR", 330_000, "ACCEPTED")], { live: false, dealId: "deal-1" }),
      offer({ status: "ACCEPTED", requestStatus: "CONTRACTING" }),
      { kind: "deal", dealId: "deal-1" },
    ],
    [
      "(4) сделка есть и после отмены заявки — всё равно в сделку",
      negotiation([round("p1", "EXECUTOR", 330_000, "ACCEPTED")], { live: false, dealId: "deal-1" }),
      offer({ status: "ACCEPTED", requestStatus: "CANCELLED" }),
      { kind: "deal", dealId: "deal-1" },
    ],
    [
      "(5) заявка отменена → closed requestCancelled",
      negotiation([round("p1", "EXECUTOR", 85_000, "PROPOSED")], { live: false }),
      offer({ requestStatus: "CANCELLED" }),
      { kind: "closed", reason: "requestCancelled" },
    ],
    [
      "(5) выбран другой мастер (отклик DECLINED) → closed otherChosen",
      negotiation([round("p1", "EXECUTOR", 340_000, "PROPOSED")], { live: false }),
      offer({ status: "DECLINED", requestStatus: "CONTRACTING" }),
      { kind: "closed", reason: "otherChosen" },
    ],
    [
      "(5) торг закрыт иначе (сценарий до договора) → closed",
      negotiation([], { live: false }),
      offer({ status: "ACCEPTED", requestStatus: "OFFER_CHOSEN" }),
      { kind: "closed", reason: "closed" },
    ],
    [
      "доп.: мастер отозвал свою цену → noPrice master",
      negotiation([round("p1", "EXECUTOR", 500_000, "WITHDRAWN")]),
      offer(),
      { kind: "noPrice", by: "master" },
    ],
    [
      "доп.: покупатель отозвал своё → noPrice you",
      negotiation([round("p1", "EXECUTOR", 500_000, "SUPERSEDED"), round("p2", "CLIENT", 450_000, "WITHDRAWN")]),
      offer(),
      { kind: "noPrice", by: "you" },
    ],
  ];

  it.each(cases)("%s", (_name, n, o, expected) => {
    expect(offerState(input(n, o))).toEqual(expected);
  });
});

describe("offerView: действия, смета и тексты по состояниям", () => {
  it("(1) «Принять X» с суммой мастера; подтверждение: к оплате — цена, без доплат; второстепенное — своя цена", () => {
    const n = negotiation([round("p1", "EXECUTOR", 1_180_000, "PROPOSED")]);
    const view = offerView(offer(), n);
    const m = computeDealMoney(1_180_000_00n);
    const price = formatMoney(m.priceTiyn);
    expect(view.primary).toEqual({
      kind: "accept",
      proposalId: "p1",
      label: `Принять ${price}`,
      confirmTitle: t.acceptConfirm.title(price),
      confirmDescription: t.acceptConfirm.description({ price }),
    });
    if (view.primary?.kind !== "accept") throw new Error("нет принятия");
    expect(view.primary.confirmDescription).toContain(`Будет создана сделка на ${price}. К оплате — ${price}, без доплат.`);
    expect(view.secondary).toEqual({ kind: "propose" });
    // Сумма к оплате — в блоке денег сразу ниже, в «Сейчас» не повторяется.
    expect(view.now).toEqual({ title: t.now.masterPrice.title(price) });
    expect(view.proposeDescription).toBe(t.propose.masterPrice(price));
    expect(view.money).toEqual({
      title: t.money.title,
      amountTiyn: m.buyerTotalTiyn,
      rows: [
        { label: t.money.price.master, amountTiyn: m.priceTiyn },
        { label: t.money.total, amountTiyn: m.buyerTotalTiyn, total: true, explain: true },
      ],
    });
  });

  it("суммы — из сметы модуля как есть: к оплате — цена без доплат (10 001 тиын), экран не пересчитывает", () => {
    const n = { ...negotiation([round("p1", "EXECUTOR", 1, "PROPOSED")]), estimate: estimate(10_001n) };
    const view = offerView(offer(), n);
    expect(view.money?.rows.map((r) => r.amountTiyn)).toEqual([10_001n, 10_001n]);
    expect(view.money?.amountTiyn).toBe(10_001n);
  });

  it("(3) встречная мастера — свой заголовок, то же главное действие", () => {
    const n = negotiation([round("p1", "EXECUTOR", 1_020_000, "SUPERSEDED"), round("p2", "CLIENT", 940_000, "SUPERSEDED"), round("p3", "EXECUTOR", 990_000, "PROPOSED")]);
    const view = offerView(offer(), n);
    expect(view.now.title).toBe(t.now.masterCounter.title(formatMoney(990_000_00n)));
    expect(view.primary).toMatchObject({ kind: "accept", proposalId: "p3", label: `Принять ${formatMoney(990_000_00n)}` });
    expect(view.secondary).toEqual({ kind: "propose" });
  });

  it("(2) ждём мастера: главного действия нет, «Отозвать мою цену»; смета по своей цене, условие — в заголовке", () => {
    const n = negotiation([round("p1", "EXECUTOR", 1_050_000, "SUPERSEDED"), round("p2", "CLIENT", 980_000, "PROPOSED")]);
    const view = offerView(offer(), n);
    expect(view.primary).toBeNull();
    expect(view.secondary).toEqual({ kind: "withdraw", proposalId: "p2" });
    expect(view.now.title).toBe(t.now.waiting.title);
    expect(view.money?.rows[0]).toEqual({ label: t.money.price.yours, amountTiyn: 980_000_00n });
    expect(view.money?.title).toBe(t.money.titleWaiting);
    expect(view.proposeDescription).toBe(t.propose.description);
  });

  it("отзыв своей встречной цены называется как у мастера — «Отозвать мою цену»", () => {
    expect(t.actions.withdraw).toBe("Отозвать мою цену");
    expect(t.actions.withdraw).toBe(ru.app.masterOffer.actions.withdrawPrice);
  });

  it("цены, ждущей ответа, нет: главное — «Предложить свою цену», сметы нет", () => {
    const view = offerView(offer(), negotiation([round("p1", "EXECUTOR", 500_000, "WITHDRAWN")]));
    expect(view.primary).toEqual({ kind: "propose" });
    expect(view.secondary).toBeNull();
    expect(view.money).toBeNull();
    expect(view.now.title).toBe(t.now.masterWithdrew.title);
  });

  it("(4) сделка: «Открыть сделку» на /v2/deals/<id>, цена сделки строкой, блока денег нет (деньги — на экране сделки)", () => {
    const n = negotiation([round("p1", "EXECUTOR", 330_000, "ACCEPTED")], { live: false, dealId: "deal-1" });
    const view = offerView(offer({ status: "ACCEPTED", requestStatus: "CONTRACTING" }), n);
    expect(view.primary).toEqual({ kind: "deal", href: "/v2/deals/deal-1", label: t.actions.openDeal });
    expect(view.secondary).toBeNull();
    expect(view.money).toBeNull();
    expect(view.now).toEqual({ title: t.now.deal.title, body: t.now.deal.body(formatMoney(330_000_00n)) });
    expect(view.next).toBeUndefined();
  });

  it.each([
    ["requestCancelled", offer({ requestStatus: "CANCELLED" }), t.actions.toRequest],
    ["otherChosen", offer({ status: "DECLINED", requestStatus: "CONTRACTING" }), t.actions.toOthers],
    ["closed", offer({ requestStatus: "OPEN" }), t.actions.toOthers],
  ] as const)("(5) %s: почему закрыто, последняя цена, ссылка к заявке; без главного действия и сметы", (reason, o, link) => {
    const view = offerView(o, negotiation([round("p1", "EXECUTOR", 340_000, "PROPOSED")], { live: false }));
    expect(view.state).toEqual({ kind: "closed", reason });
    expect(view.primary).toBeNull();
    expect(view.secondary).toEqual({ kind: "link", href: "/v2/requests/req-1", label: link });
    expect(view.money).toBeNull();
    expect(view.now).toEqual({ title: t.now[reason].title, body: `${t.now[reason].body} ${t.now.lastPrice(formatMoney(340_000_00n))}` });
    expect(view.now.body).not.toContain("ничего не требуется");
    expect(view.next).toBeUndefined();
  });

  it("заголовок «Предложение мастера», подпись модуля — строкой под ним; «Назад» — название заявки; профиль, переписка — адреса v2", () => {
    const view = offerView(offer(), negotiation([round("p1", "EXECUTOR", 1_180_000, "PROPOSED")]));
    expect(view.title).toBe("Предложение мастера");
    expect(view.executorLabel).toBe("Исполнитель №7");
    expect(view.back).toEqual({ href: "/v2/requests/req-1", label: "Кухня" });
    expect(view.executor).toEqual({ rating: { value: 4.8, count: 12 }, deals: 31, profileHref: "/v2/executors/7" });
    expect(view.chatHref).toBe("/v2/chats/offer-1");
  });

  it("условия: срок, гарантия, комментарий мастера (пустой — без строки)", () => {
    const n = negotiation([round("p1", "EXECUTOR", 1_180_000, "PROPOSED")]);
    expect(offerView(offer(), n).conditions).toEqual([
      { label: t.conditions.duration, value: formatDays(25) },
      { label: t.conditions.warranty, value: formatMonths(24) },
      { label: t.conditions.comment, value: "Своё производство, срок фиксируем в оферте.", stacked: true },
    ]);
    expect(offerView(offer({ comment: "  " }), n).conditions.map((r) => r.label)).toEqual([t.conditions.duration, t.conditions.warranty]);
  });

  it("история: кто и какую цену предложил, отозванные и заменённые помечены", () => {
    const n = negotiation([round("p1", "EXECUTOR", 500_000, "SUPERSEDED"), round("p2", "CLIENT", 450_000, "WITHDRAWN"), round("p3", "EXECUTOR", 480_000, "PROPOSED")]);
    expect(offerView(offer(), n).history.map(({ title, text, amountTiyn }) => [title, text, amountTiyn])).toEqual([
      [t.history.master, t.history.status.SUPERSEDED, 500_000_00n],
      [t.history.you, t.history.status.WITHDRAWN, 450_000_00n],
      [t.history.master, t.history.status.PROPOSED, 480_000_00n],
    ]);
    expect(offerView(offer(), n).history[0].time).toMatch(/2026/);
  });

  it("история у закрытого торга: цена, ждавшая ответа, — «Не принята», а не «Ждёт ответа»", () => {
    const n = negotiation([round("p1", "EXECUTOR", 340_000, "PROPOSED")], { live: false });
    const view = offerView(offer({ status: "DECLINED", requestStatus: "CONTRACTING" }), n);
    expect(view.history.map((h) => h.text)).toEqual([t.history.notAccepted]);
  });

  it("мастер без отзывов — рейтинг null (покажет «Пока без отзывов»)", () => {
    const o = offer();
    const view = offerView({ ...o, executor: { ...o.executor, reviewsCount: 0, ratingAvg: 0 } }, negotiation([round("p1", "EXECUTOR", 1, "PROPOSED")]));
    expect(view.executor.rating).toEqual({ value: null, count: 0 });
  });
});

describe("ru.app.offer: слова интерфейса покупателя", () => {
  const texts = (value: unknown): string[] => {
    if (typeof value === "string") return [value];
    if (typeof value === "function") return [String(value("1 ₸")), String(value({ price: "1 ₸", protection: "1 ₸", total: "1 ₸" }))];
    if (value && typeof value === "object") return Object.values(value).flatMap(texts);
    return [];
  };

  it("нет «платформа», «демо», «комиссия», «эскроу», «тестовый», «отклик»; доплат нет — «Защита сделки» не упоминается", () => {
    const all = texts(t).join("\n");
    expect(all).not.toMatch(/платформ|демо|комисси|эскроу|тестов|отклик/i);
    expect(all).not.toMatch(/Защита сделки|2\s?%/);
    expect(all).toContain("без доплат");
    expect(all).toContain("в банке под защитой");
    expect(all).not.toMatch(/через сч[её]т/i);
  });
});
