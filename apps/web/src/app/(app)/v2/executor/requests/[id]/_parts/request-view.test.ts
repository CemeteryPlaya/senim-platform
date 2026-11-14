import { describe, expect, it } from "vitest";
import { formatDays, formatMonths } from "@/features/format/format";
import { ru } from "@/i18n/ru";
import { formatMoney } from "@/kit";
import { partyEstimate } from "@/modules/payments";
import type { IncomingRequest, NegotiationView } from "@/modules/requests";
import { masterState, photoView, requestView, type MasterState, type MasterStateInput } from "./request-view";

const t = ru.app.masterOffer;

type Round = NegotiationView["rounds"][number];
type MyOffer = NonNullable<IncomingRequest["myOffer"]>;

const at = new Date("2026-11-10T09:30:00Z");
const now = new Date("2026-11-12T09:30:00Z");

/** Раунд торга глазами мастера: `mine` — цена мастера. */
function round(id: string, party: "CLIENT" | "EXECUTOR", kzt: number, status: Round["status"]): Round {
  return { id, party, mine: party === "EXECUTOR", amountTiyn: BigInt(kzt) * 100n, status, createdAt: at, decidedAt: null };
}

/** Торг глазами мастера — как его строит модуль: смета мастера `partyEstimate("EXECUTOR")` по текущей цене. */
function negotiation(rounds: Round[], opts: { live?: boolean; dealId?: string | null } = {}): NegotiationView {
  const live = opts.live ?? true;
  const open = rounds.find((r) => r.status === "PROPOSED") ?? null;
  const accepted = rounds.find((r) => r.status === "ACCEPTED") ?? null;
  const current = accepted ?? open ?? rounds.at(-1);
  const priceTiyn = current?.amountTiyn ?? 100n;
  const mine = open?.mine ?? false;
  return {
    offerId: "offer-1",
    party: "EXECUTOR",
    live,
    rounds,
    open: open && { id: open.id, party: open.party, mine, amountTiyn: open.amountTiyn },
    can: live ? { propose: !mine, accept: open !== null && !mine, withdraw: mine } : { propose: false, accept: false, withdraw: false },
    priceTiyn,
    estimate: partyEstimate("EXECUTOR", priceTiyn),
    dealId: opts.dealId ?? null,
  };
}

function myOffer(over: Partial<MyOffer> = {}): MyOffer {
  return {
    id: "offer-1",
    status: "SENT",
    priceTiyn: 1_050_000_00n,
    dealId: null,
    durationDays: 30,
    warrantyMonths: 24,
    comment: "Фасады в эмали, фурнитура Blum.",
    measurementTerms: "FREE",
    measurementFee: null,
    measurement: null,
    ...over,
  };
}

function request(over: Partial<IncomingRequest> = {}): IncomingRequest {
  return {
    id: "req-1",
    number: 18,
    title: "Кухня",
    status: "OPEN",
    mode: "TENDER",
    segment: "COMFORT",
    style: "modern",
    details: { widthCm: 340, heightCm: 270, facade: "mdf_enamel", unknown: ["hardware"], description: "Встроить посудомойку" },
    city: "Астана",
    address: null,
    location: null,
    path: "TZ",
    desiredDate: new Date("2026-12-20T00:00:00Z"),
    wishes: "Верхние шкафы до потолка",
    publishedAt: at,
    photos: [{ id: "p1", src: "/files/p1" }],
    canOffer: true,
    retryAllowed: false,
    pre: null,
    defaults: { measurementTerms: "FREE", measurementFee: null },
    // Тип `myOffer` модуль выводит без `null` (`r.offers[0]` без noUncheckedIndexedAccess), а на деле без предложения он null.
    myOffer: null as unknown as IncomingRequest["myOffer"],
    ...over,
  };
}

const stateOf = (over: Partial<MasterStateInput> = {}): MasterState =>
  masterState({ path: "TZ", canOffer: false, retryAllowed: false, status: "OPEN", myOffer: { status: "SENT", dealId: null }, negotiation: null, ...over });

describe("masterState: состояние заявки и торга глазами мастера", () => {
  it("заявка порядка «до оферты» — в v1, даже если можно отправить предложение", () => {
    expect(stateOf({ path: "EXECUTOR_MEASURE", canOffer: true, myOffer: null })).toEqual({ kind: "legacy" });
  });

  it("своего предложения нет — форма; новая попытка от оператора — форма «ещё раз»; отправить нельзя — «не принимает»", () => {
    expect(stateOf({ canOffer: true, myOffer: null })).toEqual({ kind: "form", retry: false });
    expect(stateOf({ canOffer: true, retryAllowed: true, myOffer: { status: "DECLINED", dealId: null } })).toEqual({ kind: "form", retry: true });
    expect(stateOf({ canOffer: false, myOffer: null })).toEqual({ kind: "unavailable" });
  });

  it("цена принята — сделка (из торга или из своего предложения)", () => {
    const n = negotiation([round("a", "EXECUTOR", 1_050_000, "ACCEPTED")], { live: false, dealId: "deal-1" });
    expect(stateOf({ negotiation: n, myOffer: { status: "ACCEPTED", dealId: null } })).toEqual({ kind: "deal", dealId: "deal-1" });
    expect(stateOf({ myOffer: { status: "ACCEPTED", dealId: "deal-2" } })).toEqual({ kind: "deal", dealId: "deal-2" });
  });

  it("закрыто: отозвал сам, заявка отменена, выбран другой мастер, иначе — «больше не действует»", () => {
    const closed = negotiation([round("a", "EXECUTOR", 1_050_000, "PROPOSED")], { live: false });
    expect(stateOf({ negotiation: closed, myOffer: { status: "WITHDRAWN", dealId: null } })).toEqual({ kind: "closed", reason: "withdrawn" });
    expect(stateOf({ negotiation: closed, status: "CANCELLED" })).toEqual({ kind: "closed", reason: "requestCancelled" });
    expect(stateOf({ negotiation: closed, status: "CONTRACTING", myOffer: { status: "DECLINED", dealId: null } })).toEqual({ kind: "closed", reason: "otherChosen" });
    expect(stateOf({ negotiation: closed, status: "CONTRACTING" })).toEqual({ kind: "closed", reason: "closed" });
  });

  it("торг идёт: цена покупателя, своя цена ждёт, открытой цены нет — кто отозвал", () => {
    const buyer = negotiation([round("a", "EXECUTOR", 1_050_000, "SUPERSEDED"), round("b", "CLIENT", 980_000, "PROPOSED")]);
    expect(stateOf({ negotiation: buyer })).toEqual({ kind: "buyerPrice", proposalId: "b", amountTiyn: 980_000_00n });
    const waiting = negotiation([round("a", "EXECUTOR", 1_050_000, "PROPOSED")]);
    expect(stateOf({ negotiation: waiting })).toEqual({ kind: "waiting", proposalId: "a", amountTiyn: 1_050_000_00n });
    expect(stateOf({ negotiation: negotiation([round("a", "EXECUTOR", 1_050_000, "WITHDRAWN")]) })).toEqual({ kind: "noPrice", by: "you" });
    const buyerWithdrew = negotiation([round("a", "EXECUTOR", 1_050_000, "SUPERSEDED"), round("b", "CLIENT", 980_000, "WITHDRAWN")]);
    expect(stateOf({ negotiation: buyerWithdrew })).toEqual({ kind: "noPrice", by: "buyer" });
  });
});

describe("requestView: экран заявки мастера", () => {
  it("форма: главное — «Отправить предложение», нет сметы из модуля, нет меню, переписки и истории", () => {
    const v = requestView(request(), null, now);
    expect(v.state).toEqual({ kind: "form", retry: false });
    expect(v.now.title).toBe(t.now.form.title);
    expect(v.primary).toEqual({ kind: "send" });
    expect(v.secondary).toBeNull();
    expect([v.money, v.withdrawOffer, v.chatHref, v.offerId]).toEqual([null, null, null, null]);
    expect([v.history, v.conditions]).toEqual([[], []]);
    expect(v.back).toEqual({ href: "/v2/executor/requests", label: t.back });
    expect(v.lead).toEqual({ number: t.numberLine(18), direct: null });
  });

  it("цена покупателя: «Принять X» с подтверждением и суммой «Вы получите» из partyEstimate(\"EXECUTOR\"); своя цена — второстепенное", () => {
    const n = negotiation([round("a", "EXECUTOR", 1_050_000, "SUPERSEDED"), round("b", "CLIENT", 980_000, "PROPOSED")]);
    const v = requestView(request({ canOffer: false, myOffer: myOffer() }), n, now);
    const e = partyEstimate("EXECUTOR", 980_000_00n);
    const price = formatMoney(980_000_00n);
    expect(v.now).toEqual({ title: t.now.buyerPrice.title(price), body: t.now.buyerPrice.body });
    expect(v.primary).toEqual({
      kind: "accept",
      proposalId: "b",
      label: t.actions.accept(price),
      confirmTitle: t.acceptConfirm.title(price),
      confirmDescription: t.acceptConfirm.description({ price, guarantee: formatMoney(e.extraTiyn), youGet: formatMoney(e.totalTiyn) }),
    });
    expect(v.primary?.kind === "accept" && v.primary.confirmDescription).toContain(formatMoney(940_800_00n));
    expect(v.secondary).toEqual({ kind: "propose" });
    expect(v.proposeDescription).toBe(t.propose.buyerPrice(price));
    expect(v.money).toEqual({
      title: t.money.title,
      amountTiyn: e.totalTiyn,
      rows: [
        { label: t.money.price.buyer, amountTiyn: 980_000_00n },
        { label: t.money.guarantee, amountTiyn: e.extraTiyn, explain: true },
        { label: t.money.youGet, amountTiyn: e.totalTiyn, total: true },
      ],
    });
    expect(v.withdrawOffer).toEqual({ offerId: "offer-1" });
    expect(v.chatHref).toBe("/v2/chats/offer-1");
    expect(v.history.map((h) => [h.title, h.text])).toEqual([
      [t.history.you, t.history.status.SUPERSEDED],
      [t.history.buyer, t.history.status.PROPOSED],
    ]);
    expect(v.conditions).toEqual([
      { label: t.conditions.duration, value: formatDays(30) },
      { label: t.conditions.warranty, value: formatMonths(24) },
      { label: t.conditions.comment, value: "Фасады в эмали, фурнитура Blum.", stacked: true },
    ]);
  });

  it("своя цена ждёт: главного нет, «Отозвать цену»; смета «если покупатель примет»", () => {
    const n = negotiation([round("a", "EXECUTOR", 1_050_000, "PROPOSED")]);
    const v = requestView(request({ canOffer: false, myOffer: myOffer() }), n, now);
    expect(v.primary).toBeNull();
    expect(v.secondary).toEqual({ kind: "withdrawPrice", proposalId: "a" });
    expect(v.now.body).toBe(t.now.waiting.body(formatMoney(1_050_000_00n)));
    expect(v.money?.title).toBe(t.money.titleWaiting);
    expect(v.money?.rows[0]).toEqual({ label: t.money.price.yours, amountTiyn: 1_050_000_00n });
    expect(v.proposeDescription).toBe(t.propose.description);
  });

  it("открытой цены нет — главное «Предложить свою цену», денег нет", () => {
    const v = requestView(request({ canOffer: false, myOffer: myOffer() }), negotiation([round("a", "EXECUTOR", 1_050_000, "WITHDRAWN")]), now);
    expect(v.now.title).toBe(t.now.youWithdrew.title);
    expect(v.primary).toEqual({ kind: "propose" });
    expect(v.money).toBeNull();
  });

  it("сделка: «Открыть сделку» ведёт в /v2/deals/<id>; меню отзыва нет; адрес виден, раз модуль его отдал", () => {
    const n = negotiation([round("a", "CLIENT", 980_000, "ACCEPTED")], { live: false, dealId: "deal-1" });
    const v = requestView(
      request({ status: "CONTRACTING", canOffer: false, address: "ул. Тестовая, 1", location: { lat: 51.1282, lng: 71.4304 }, myOffer: myOffer({ status: "ACCEPTED" }) }),
      n,
      now,
    );
    expect(v.primary).toEqual({ kind: "deal", href: "/v2/deals/deal-1", label: t.actions.openDeal });
    expect(v.now).toEqual({ title: t.now.deal.title, body: t.now.deal.body(formatMoney(980_000_00n)) });
    expect(v.withdrawOffer).toBeNull();
    expect(v.money).toBeNull();
    expect(v.details).toContainEqual({ label: t.request.address, value: "ул. Тестовая, 1", stacked: true });
    expect(v.details).toContainEqual({ label: t.request.location, value: "51.12820, 71.43040", stacked: false });
  });

  it("закрыто: причина и последняя цена, ссылка к другим заявкам, без главного действия и меню", () => {
    const n = negotiation([round("a", "EXECUTOR", 1_050_000, "PROPOSED")], { live: false });
    const v = requestView(request({ status: "CONTRACTING", canOffer: false, myOffer: myOffer({ status: "DECLINED" }) }), n, now);
    expect(v.now).toEqual({ title: t.now.otherChosen.title, body: `${t.now.otherChosen.body} ${t.now.lastPrice(formatMoney(1_050_000_00n))}` });
    expect(v.primary).toBeNull();
    expect(v.secondary).toEqual({ kind: "link", href: "/v2/executor/requests", label: t.actions.toRequests });
    expect(v.withdrawOffer).toBeNull();
    expect(v.history[0]?.text).toBe(t.history.notAccepted);
  });

  it("заявка «до оферты» — ссылка на экран v1, торга и денег нет", () => {
    const v = requestView(request({ path: "EXECUTOR_MEASURE" }), null, now);
    expect(v.secondary).toEqual({ kind: "link", href: "/executor/requests/req-1", label: t.now.legacy.action });
    expect([v.primary, v.money, v.chatHref]).toEqual([null, null, null]);
  });

  it("сводка: до выбора адреса нет — пояснение; «не знаю» — «Покупатель не знает»; снимок без адреса пропущен; прямая заявка помечена", () => {
    const v = requestView(request({ mode: "DIRECT" }), null, now);
    expect(v.lead.direct).toBe(t.direct);
    const rows = Object.fromEntries(v.details.map((r) => [r.label, r.value]));
    expect(rows[t.request.address]).toBe(t.request.addressHidden);
    expect(rows[t.request.hardware]).toBe(t.request.unknown);
    expect(rows[t.request.size]).toBe(t.request.sizeValue(340, 270));
    expect(rows[t.request.city]).toBe("Астана");
    expect(rows[t.request.wishes]).toBe("Верхние шкафы до потолка");
    expect(t.request.location in rows).toBe(false);
    expect(v.photos).toEqual([{ id: "p1", src: "/files/p1", alt: t.request.photoAlt(1, 1) }]);
    expect(photoView([{ id: "a", src: null }, { id: "b", src: "/b" }])).toEqual([{ id: "b", src: "/b", alt: t.request.photoAlt(1, 1) }]);
  });
});
