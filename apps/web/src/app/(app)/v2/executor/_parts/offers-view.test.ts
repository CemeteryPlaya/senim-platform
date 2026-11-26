import { describe, expect, it } from "vitest";
import { ru } from "@/i18n/ru";
import { offerCard, offersView, type OfferRow } from "./offers-view";

const t = ru.app.masterRequests.offers;
const NOW = new Date("2026-11-14T10:00:00Z");
const offer = (over: Partial<OfferRow> = {}): OfferRow => ({
  id: "o1",
  requestId: "r1",
  number: 1,
  title: "Кухня",
  city: "Астана",
  segment: "COMFORT",
  status: "SENT",
  priceTiyn: 50_000_000n,
  createdAt: new Date("2026-11-13T10:00:00Z"),
  dealId: null,
  ...over,
});
const list = [offer(), offer({ id: "o2", status: "ACCEPTED", dealId: "d1" }), offer({ id: "o3", status: "DECLINED" }), offer({ id: "o4", status: "WITHDRAWN" })];

describe("«Мои предложения»", () => {
  it("группы: ждут ответа, выбраны, закрыты; раздел в адресе, неизвестный — «Все»", () => {
    const ids = (show?: string) => offersView(list, show, NOW).cards.map((c) => c.id);
    expect(ids()).toEqual(["o1", "o2", "o3", "o4"]);
    expect(ids("waiting")).toEqual(["o1"]);
    expect(ids("chosen")).toEqual(["o2"]);
    expect(ids("closed")).toEqual(["o3", "o4"]);
    expect(ids("что-то")).toHaveLength(4);
  });

  it("чипы с числами и адресами", () => {
    expect(offersView(list, "closed", NOW).chips.map((c) => [c.label, c.href, c.active])).toEqual([
      [t.chip(t.chips.all, 4), "/v2/executor/offers", false],
      [t.chip(t.chips.waiting, 1), "/v2/executor/offers?show=waiting", false],
      [t.chip(t.chips.chosen, 1), "/v2/executor/offers?show=chosen", false],
      [t.chip(t.chips.closed, 2), "/v2/executor/offers?show=closed", true],
    ]);
  });

  it("пустая группа чипом не рисуется; выбранная по адресу — остаётся", () => {
    const labels = (show?: string) => offersView([offer(), offer({ id: "o2", status: "ACCEPTED" })], show, NOW).chips.map((c) => c.label);
    expect(labels()).toEqual([t.chip(t.chips.all, 2), t.chip(t.chips.waiting, 1), t.chip(t.chips.chosen, 1)]);
    expect(labels("closed")).toContain(t.chip(t.chips.closed, 0));
  });

  it("строка: «Кухня · №1», сведения — город и сегмент, когда отправлено (без срока)", () => {
    const card = offerCard(offer(), NOW);
    expect(card.title).toBe("Кухня · №1");
    expect(card.meta).toEqual(["Астана · Комфорт", "вчера"]);
  });

  it("покупатель назвал свою цену — «Ждёт вашего ответа» (ход мастера); своя цена ждёт покупателя — без плашки", () => {
    expect(offerCard(offer({ buyerPriceOpen: true }), NOW).status).toEqual({ text: t.status.buyerPrice, tone: "warn" });
    expect(offerCard(offer({ buyerPriceOpen: false }), NOW).status).toBeNull();
  });

  it("пусто и пустой раздел", () => {
    expect(offersView([], undefined, NOW).empty).toBe("none");
    expect(offersView([offer()], "chosen", NOW).empty).toBe("filter");
  });

  it("карточка: цена и статус; выбранное со сделкой ведёт в сделку, остальное — в заявку", () => {
    expect(offerCard(offer(), NOW)).toMatchObject({ href: "/v2/executor/requests/r1", priceTiyn: 50_000_000n, status: null });
    expect(offerCard(offer({ status: "ACCEPTED", dealId: "d1" }), NOW)).toMatchObject({ href: "/v2/deals/d1", status: { text: t.status.deal, tone: "accent" } });
    expect(offerCard(offer({ status: "ACCEPTED" }), NOW).status?.text).toBe(t.status.chosen);
  });
});
