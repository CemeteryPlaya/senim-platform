import { describe, expect, it } from "vitest";
import { ru } from "@/i18n/ru";
import type { IncomingListItem } from "@/modules/requests";
import { incomingCard, incomingListView, TYPE_CHIPS_FROM } from "./incoming-view";

const t = ru.app.masterRequests.incoming;
const NOW = new Date("2026-11-14T10:00:00Z");

const row = (over: Partial<IncomingListItem> = {}): IncomingListItem => ({
  id: "r1",
  number: 1,
  title: "Кухня",
  mode: "TENDER",
  segment: "COMFORT",
  style: null,
  city: "Астана",
  desiredDate: null,
  publishedAt: new Date("2026-11-13T10:00:00Z"),
  offersCount: 0,
  myOfferStatus: null as never, // тип модуля не знает про null, а значение бывает
  cover: null,
  invited: false,
  buyerPriceOpen: false,
  ...over,
});

const list = [row({ id: "a" }), row({ id: "b", title: "Шкаф", mode: "DIRECT" }), row({ id: "c", title: "Шкаф", myOfferStatus: "SENT" })];
/** Длинный список: чипы по типу мебели рисуются только с `TYPE_CHIPS_FROM` заявок. */
const long = [...list, ...["d", "e", "f"].map((id) => row({ id, title: "Шкаф" }))];
const ids = (search: { f?: string; type?: string }) => incomingListView(list, search, NOW).cards.map((c) => c.id);

describe("входящие мастера: «Вас пригласили»", () => {
  it("приглашённому — акцентная плашка; остальным — нет", () => {
    expect(incomingCard(row({ invited: true }), NOW).badges).toContainEqual({ text: t.card.invited, tone: "accent" });
    expect(incomingCard(row(), NOW).badges.map((b) => b.text)).not.toContain(t.card.invited);
  });
});

describe("входящие мастера: фильтры в адресе", () => {
  it("«Все», «Новые» (без моего предложения), «Прямые», тип мебели; неизвестное — «Все»", () => {
    expect(ids({})).toEqual(["a", "b", "c"]);
    expect(ids({ f: "new" })).toEqual(["a", "b"]);
    expect(ids({ f: "direct" })).toEqual(["b"]);
    expect(incomingListView(long, { type: "Шкаф" }, NOW).cards.map((c) => c.id)).toEqual(["b", "c", "d", "e", "f"]);
    expect(ids({ f: "что-то", type: "Нет такого" })).toEqual(["a", "b", "c"]);
  });

  it("чипы с числами и адресами; активен выбранный; типы мебели — от шести заявок", () => {
    expect(long).toHaveLength(TYPE_CHIPS_FROM);
    const view = incomingListView(long, { f: "direct" }, NOW);
    const chips = view.chips.map((c) => [c.label, decodeURIComponent(c.href), c.active]);
    expect(chips).toEqual([
      [t.chip(t.chips.all, 6), "/v2/executor/requests", false],
      [t.chip(t.chips.fresh, 5), "/v2/executor/requests?f=new", false],
      [t.chip(t.chips.direct, 1), "/v2/executor/requests?f=direct", true],
      [t.chip("Кухня", 1), "/v2/executor/requests?type=Кухня", false],
      [t.chip("Шкаф", 5), "/v2/executor/requests?type=Шкаф", false],
    ]);
  });

  it("заявок меньше шести — чипов по типу нет, а ?type= читается как «Все»", () => {
    const view = incomingListView(list, { type: "Шкаф" }, NOW);
    expect(view.chips.map((c) => c.label)).toEqual([t.chip(t.chips.all, 3), t.chip(t.chips.fresh, 2), t.chip(t.chips.direct, 1)]);
    expect(view.key).toBe("all");
    expect(view.cards.map((c) => c.id)).toEqual(["a", "b", "c"]);
  });

  it("выбранного чипа нет (прямых заявок нет, тип один) — «Все», а не пустой список без активного чипа", () => {
    const plain = [row({ id: "a" }), row({ id: "b" })];
    for (const search of [{ f: "direct" }, { type: "Кухня" }]) {
      const view = incomingListView(plain, search, NOW);
      expect(view.cards.map((c) => c.id)).toEqual(["a", "b"]);
      expect(view.key).toBe("all");
      expect(view.chips.filter((c) => c.active).map((c) => c.href)).toEqual(["/v2/executor/requests"]);
    }
  });

  it("пусто: нет заявок совсем, пустой раздел", () => {
    expect(incomingListView([], {}, NOW)).toMatchObject({ empty: "none", chips: [] });
    expect(incomingListView([row({ myOfferStatus: "SENT" })], { f: "new" }, NOW).empty).toBe("filter");
  });
});

describe("карточка входящей заявки", () => {
  it("что нужно, город и сегмент, метки «Новая» и «Прямая заявка вам», срок; покупатель не назван", () => {
    const card = incomingCard(row({ mode: "DIRECT", desiredDate: new Date("2026-12-20T00:00:00Z"), offersCount: 2 }), NOW);
    expect(card.href).toBe("/v2/executor/requests/r1");
    // Сначала что за мебель, номер — после.
    expect(card.title).toBe("Кухня · №1");
    // Когда опубликована — без слова «Опубликована»: «вчера · Предложений: 2».
    expect(card.lines[1]).toEqual(["вчера", t.card.offers(2)]);
    expect(card.badges.map((b) => b.text)).toEqual([t.card.fresh, t.card.direct]);
    expect(card.meta[0]).toContain("Астана");
    expect(card.meta).toContain(t.card.offers(2));
    expect(card.meta.some((m) => m.startsWith("Нужно к"))).toBe(true);
    // Двумя строками: где и к какому сроку (короткая дата) — когда и сколько предложений.
    expect(card.lines[0][0]).toMatch(/^Астана/);
    // Дата срока — с неразрывным пробелом: «Нужно к 5 дек» не рвётся посередине.
    expect(card.lines[0].at(-1)?.startsWith("Нужно к")).toBe(true);
    expect(card.lines[0].at(-1)).toContain(String.fromCharCode(160));
    expect(card.lines[1]).toContain(t.card.offers(2));
  });

  it("с моим предложением метки «Новая» нет", () => {
    expect(incomingCard(row({ myOfferStatus: "ACCEPTED" }), NOW).badges.map((b) => b.text)).toEqual([t.card.myOfferShort.ACCEPTED]);
  });

  it("покупатель назвал свою цену — «Ждёт вашего ответа» (ход мастера, warn) вместо «Цена отправлена»", () => {
    expect(incomingCard(row({ myOfferStatus: "SENT", buyerPriceOpen: true }), NOW).badges).toEqual([{ text: t.card.buyerPrice, tone: "warn" }]);
    expect(incomingCard(row({ myOfferStatus: "SENT" }), NOW).badges).toEqual([{ text: t.card.myOfferShort.SENT, tone: "neutral" }]);
  });

  it("блок «Новые заявки» главной — без метки «Новая» (раздел так и называется)", () => {
    expect(incomingCard(row({ mode: "DIRECT" }), NOW, { markFresh: false }).badges.map((b) => b.text)).toEqual([t.card.direct]);
  });
});
