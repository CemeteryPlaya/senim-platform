import { describe, expect, it } from "vitest";
import { ru } from "@/i18n/ru";
import type { RequestStateKind } from "../../../_parts/request-state";
import { detailRows, nowView, offerRow, offersView, parseSort, photoView, sentNotice, sortHref, sortOptions, type NowInput, type OfferInput } from "./card-view";

const t = ru.app.requestCard;
const buyer = ru.app.buyer.home.now;

const base: NowInput = { id: "r1", mode: "TENDER", state: { kind: "waiting", liveOffers: 0 }, dealId: null, chosenOfferId: null };
const st = (kind: RequestStateKind, liveOffers = 0) => ({ state: { kind, liveOffers } });

describe("nowView: таблица состояний заявки (по общей requestState)", () => {
  it.each([
    ["открыта, действующих предложений нет", { ...base }, "waiting", t.now.waiting.title, null],
    ["открыта прямая, предложений нет", { ...base, mode: "DIRECT" as const }, "waiting-direct", t.now.waitingDirect.title, null],
    ["одно действующее предложение", { ...base, ...st("choose", 1) }, "offers", "Пришло 1 предложение", null],
    ["три действующих", { ...base, ...st("choose", 3) }, "offers", "Пришло 3 предложения", null],
    ["пять действующих", { ...base, ...st("choose", 5) }, "offers", "Пришло 5 предложений", null],
    ["замер помещения", { ...base, ...st("site-measuring") }, "site-measuring", t.now.siteMeasuring.title, null],
    ["мастер выбран", { ...base, ...st("chosen"), chosenOfferId: "o1" }, "chosen", buyer.requestChosen.title, "/v2/requests/r1/offers/o1"],
    ["идёт замер", { ...base, ...st("measuring"), chosenOfferId: "o1" }, "chosen", buyer.requestChosen.title, "/v2/requests/r1/offers/o1"],
    ["мастер выбран, предложение не нашли", { ...base, ...st("chosen") }, "chosen", buyer.requestChosen.title, null],
    ["идёт сделка", { ...base, ...st("deal"), dealId: "d1" }, "deal", t.now.deal.title, "/v2/deals/d1"],
    ["сделка по заявке не найдена", { ...base, ...st("deal") }, "deal", t.now.deal.title, null],
    ["сделка завершена", { ...base, ...st("done"), dealId: "d1" }, "done", t.now.done.title, "/v2/deals/d1"],
    ["отменена", { ...base, ...st("cancelled") }, "cancelled", t.now.cancelled.title, null],
    ["черновик", { ...base, ...st("draft") }, "draft", buyer.draft.title, "/v2/requests/new?draft=r1"],
  ])("%s", (_name, input, kind, title, href) => {
    const view = nowView(input);
    expect(view.kind).toBe(kind);
    expect(view.title).toBe(title);
    expect(view.primary?.href ?? null).toBe(href);
  });

  it("ожидание: «Дальше» — мастера пришлют цены и сроки, главного действия нет", () => {
    const view = nowView(base);
    expect(view.next).toBe("Мастера пришлют цены и сроки");
    expect(view.primary).toBeNull();
  });

  it("«Пришло N предложений»: «Сравните и откройте подходящее», главного действия нет (оно в списке)", () => {
    const view = nowView({ ...base, ...st("choose", 2) });
    expect(view.body).toBe("Сравните и откройте подходящее.");
    expect(view.primary).toBeNull();
  });

  it("тексты без запрещённых слов", () => {
    const all = JSON.stringify([t, nowView({ ...base, ...st("choose", 2) })]);
    expect(all).not.toMatch(/платформ|демо|комисси|эскроу|тестов|отклик|договор(?!ит)/i);
  });
});

describe("текст подтверждения отмены", () => {
  it("тендер — «мастера» во множественном числе; прямая — «мастер» в единственном", () => {
    expect(t.actions.cancelBody(0, false)).toBe("Мастера больше не увидят заявку. Отменить это действие нельзя.");
    expect(t.actions.cancelBody(2, false)).toContain("присланные предложения будут отклонены, а мастера получат уведомление");
    expect(t.actions.cancelBody(0, true)).toBe("Мастер больше не увидит заявку. Отменить это действие нельзя.");
    expect(t.actions.cancelBody(1, true)).toContain("Мастер больше не увидит заявку, присланное предложение будет отклонено, а мастер получит уведомление");
  });
});

describe("sentNotice", () => {
  it.each([
    [true, "OPEN", "TENDER", 0, "Заявка отправлена мастерам"],
    [true, "OPEN", "DIRECT", 0, "Заявка отправлена мастеру"],
    [true, "PLATFORM_MEASURING", "TENDER", 0, "Заявка отправлена мастерам"],
    [true, "OPEN", "TENDER", 1, null],
    [true, "CANCELLED", "TENDER", 0, null],
    [true, "CLOSED", "TENDER", 0, null],
    [false, "OPEN", "TENDER", 0, null],
  ] as const)("sent=%s, %s, %s, предложений %i -> %s", (sent, status, mode, offers, title) => {
    expect(sentNotice(sent, status, mode, offers)?.title ?? null).toBe(title);
  });
});

describe("сортировка в адресе", () => {
  it.each([
    ["price", "price"],
    ["duration", "duration"],
    ["rating", "rating"],
    ["cheap", "price"],
    ["", "price"],
    [undefined, "price"],
  ] as const)("parseSort(%s) -> %s", (value, sort) => {
    expect(parseSort(value)).toBe(sort);
  });

  it("sortHref кладёт сортировку в адрес карточки", () => {
    expect(sortHref("r1", "duration")).toBe("/v2/requests/r1?sort=duration");
  });

  it("сегменты: цена, срок, рейтинг", () => {
    expect(sortOptions().map((o) => o.value)).toEqual(["price", "duration", "rating"]);
    expect(sortOptions().map((o) => o.label)).toEqual(["Дешевле", "Быстрее", "По рейтингу"]);
  });
});

const offer = (over: Partial<OfferInput> = {}, ex: Partial<OfferInput["executor"]> = {}): OfferInput => ({
  id: "o1",
  status: "SENT",
  live: true,
  withDeal: false,
  createdAt: new Date("2026-11-01T10:00:00Z"),
  priceTiyn: 105_000_000n,
  durationDays: 30,
  warrantyMonths: 24,
  executor: { label: "Исполнитель №3", ratingAvg: 4.8, reviewsCount: 12, completedDeals: 7, ...ex },
  ...over,
});

describe("offerRow", () => {
  it("исполнитель только «Исполнитель №N»; цена в тиынах как есть; ссылка на предложение v2", () => {
    const row = offerRow("r1", offer());
    expect(row.label).toBe("Исполнитель №3");
    expect(row.priceTiyn).toBe(105_000_000n);
    expect(row.href).toBe("/v2/requests/r1/offers/o1");
    expect(row.terms.map((x) => x.replaceAll(" ", " "))).toEqual(["Срок: 30 дней", "Гарантия: 24 месяца", "7 сделок в сервисе"]);
    expect(row.rating).toEqual({ value: 4.8, count: 12 });
    expect(row.chip).toBeNull();
    expect(row.priceLabel).toBeNull();
  });

  it("предложение со сделкой — цена сделки с подписью «Цена сделки»", () => {
    const row = offerRow("r1", offer({ status: "ACCEPTED", live: false, withDeal: true, priceTiyn: 102_000_000n }));
    expect(row.priceTiyn).toBe(102_000_000n);
    expect(row.priceLabel).toBe(t.offers.dealPrice);
  });

  it("без отзывов рейтинга нет; без сделок их нет в условиях", () => {
    const row = offerRow("r1", offer({}, { reviewsCount: 0, ratingAvg: 0, completedDeals: 0 }));
    expect(row.rating).toEqual({ value: null, count: 0 });
    expect(row.terms.map((x) => x.replaceAll(" ", " "))).toEqual(["Срок: 30 дней", "Гарантия: 24 месяца"]);
  });

  it("плашки: выбрано, отклонено", () => {
    expect(offerRow("r1", offer({ status: "ACCEPTED" })).chip?.text).toBe("Выбрано");
    expect(offerRow("r1", offer({ status: "DECLINED" })).chip?.text).toBe("Отклонено");
  });
});

describe("offersView", () => {
  const open = { id: "r1", status: "OPEN" as const, mode: "TENDER" as const };

  it("пусто у открытой: обучающая карточка, сортировки нет", () => {
    const v = offersView(open, [], "price");
    expect(v.empty?.title).toBe("Предложения придут сюда");
    expect(v.shown).toBe(true);
    expect(v.sortable).toBe(false);
  });

  it("у открытой недействующие не считаются и не показываются; только они — как «предложений нет»", () => {
    const declined = offer({ id: "d", status: "DECLINED", live: false });
    const v = offersView(open, [declined, offer({ id: "s" })], "price");
    expect(v.rows.map((r) => r.id)).toEqual(["s"]);
    expect(v.sortable).toBe(false);
    const none = offersView(open, [declined], "price");
    expect(none.rows).toEqual([]);
    expect(none.empty?.title).toBe("Предложения придут сюда");
  });

  it("у заявки со сделкой вся история: выбранное и отклонённые с плашками", () => {
    const v = offersView({ ...open, status: "CLOSED" }, [offer({ id: "a", status: "ACCEPTED", live: false }), offer({ id: "d", status: "DECLINED", live: false })], "price");
    expect(v.rows.map((r) => r.chip?.text)).toEqual(["Выбрано", "Отклонено"]);
  });

  it("отправленное, но торг закрыт (сценарий до договора) — тоже не действует", () => {
    expect(offersView(open, [offer({ id: "s", live: false })], "price").rows).toEqual([]);
  });

  it("«Дешевле» — по показанной (действующей) цене, а не по первой; при равной — быстрее", () => {
    const v = offersView(
      open,
      [offer({ id: "a", priceTiyn: 300n }), offer({ id: "b", priceTiyn: 100n, durationDays: 40 }), offer({ id: "c", priceTiyn: 100n, durationDays: 20 })],
      "price",
    );
    expect(v.rows.map((r) => r.id)).toEqual(["c", "b", "a"]);
  });

  it("пусто у прямой: свой текст", () => {
    expect(offersView({ ...open, mode: "DIRECT" }, [], "price").empty?.title).toBe(t.offers.emptyDirect.title);
  });

  it("пусто у отменённой и со сделкой: раздела нет", () => {
    expect(offersView({ ...open, status: "CANCELLED" }, [], "price").shown).toBe(false);
    expect(offersView({ ...open, status: "CLOSED" }, [], "price").shown).toBe(false);
  });

  it("одно предложение — сортировки нет, два — есть; порядок строк как отдал модуль", () => {
    expect(offersView(open, [offer()], "price").sortable).toBe(false);
    const v = offersView(open, [offer({ id: "b" }), offer({ id: "a" })], "duration");
    expect(v.sortable).toBe(true);
    expect(v.sort).toBe("duration");
    expect(v.rows.map((r) => r.id)).toEqual(["b", "a"]);
  });
});

describe("detailRows", () => {
  const input = {
    title: "Кухня",
    style: "loft",
    segment: "COMFORT" as const,
    details: { widthCm: 240, extras: ["lighting" as const], unknown: ["countertop" as const], description: "Угловая", facade: "ldsp" as const },
    city: "Астана",
    address: "ул. Тестовая, 1",
    wishes: null,
    directLabel: null,
  };

  it("сводка: тип, уровень, стиль, размеры, материалы, «не знаю», адрес стопкой", () => {
    const rows = detailRows(input);
    const by = (label: string) => rows.find((r) => r.label === label);
    expect(by("Что делаем")?.value).toBe("Кухня");
    expect(by("Уровень")?.value).toBe("Комфорт");
    expect(by("Стиль")?.value).toBe("Лофт");
    expect(by("Размеры")?.value).toBe("ширина 240 см");
    expect(by("Размеры")?.stacked).toBe(true);
    expect(by("Фасады")?.value).toBe("ЛДСП");
    expect(by("Столешница")?.value).toBe(t.details.unknown);
    expect(by("Дополнительно")?.value).toBe("Подсветка");
    expect(by("Адрес")?.stacked).toBe(true);
    expect(by("Пожелания")).toBeUndefined();
    expect(by(t.details.directFor)).toBeUndefined();
  });

  it("прямая заявка: «Заявка для: Исполнитель №N»", () => {
    const rows = detailRows({ ...input, directLabel: "Исполнитель №7" });
    expect(rows[0]).toEqual({ label: "Заявка для", value: "Исполнитель №7", stacked: false });
  });
});

describe("photoView", () => {
  it("описание с номером; снимок без адреса пропускается", () => {
    expect(photoView([{ id: "a", src: "/f/a" }, { id: "b", src: null }, { id: "c", src: "/f/c" }])).toEqual([
      { id: "a", src: "/f/a", alt: "Фото помещения 1 из 2" },
      { id: "c", src: "/f/c", alt: "Фото помещения 2 из 2" },
    ]);
  });
});
