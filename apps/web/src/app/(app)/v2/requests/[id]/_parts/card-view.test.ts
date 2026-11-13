import { describe, expect, it } from "vitest";
import type { RequestStatus } from "@/generated/prisma/enums";
import { ru } from "@/i18n/ru";
import { detailRows, isLive, nowView, offerRow, offersView, parseSort, photoView, sentNotice, sortHref, sortOptions, type NowInput, type OfferInput } from "./card-view";

const t = ru.app.requestCard;
const buyer = ru.app.buyer.home.now;

const base: NowInput = { id: "r1", status: "OPEN", mode: "TENDER", offersCount: 0, dealId: null, chosenOfferId: null };

describe("nowView: таблица состояний заявки", () => {
  it.each([
    ["открыта, предложений нет", { ...base }, "waiting", t.now.waiting.title, null],
    ["открыта прямая, предложений нет", { ...base, mode: "DIRECT" as const }, "waiting-direct", t.now.waitingDirect.title, null],
    ["открыта, одно предложение", { ...base, offersCount: 1 }, "offers", "Пришло 1 предложение", null],
    ["открыта, три предложения", { ...base, offersCount: 3 }, "offers", "Пришло 3 предложения", null],
    ["открыта, пять предложений", { ...base, offersCount: 5 }, "offers", "Пришло 5 предложений", null],
    ["замер помещения", { ...base, status: "PLATFORM_MEASURING" as const }, "site-measuring", t.now.siteMeasuring.title, null],
    ["мастер выбран", { ...base, status: "OFFER_CHOSEN" as const, chosenOfferId: "o1" }, "chosen", buyer.requestChosen.title, "/v2/requests/r1/offers/o1"],
    ["идёт замер", { ...base, status: "MEASURING" as const, chosenOfferId: "o1" }, "chosen", buyer.requestChosen.title, "/v2/requests/r1/offers/o1"],
    ["мастер выбран, предложение не нашли", { ...base, status: "OFFER_CHOSEN" as const }, "chosen", buyer.requestChosen.title, null],
    ["оферта готова, сделка есть", { ...base, status: "CONTRACTING" as const, dealId: "d1" }, "deal", t.now.deal.title, "/v2/deals/d1"],
    ["договор подписан, сделка есть", { ...base, status: "CLOSED" as const, dealId: "d1" }, "deal", t.now.deal.title, "/v2/deals/d1"],
    ["сделка по заявке не найдена", { ...base, status: "CLOSED" as const }, "deal", t.now.deal.title, null],
    ["отменена", { ...base, status: "CANCELLED" as const, offersCount: 2 }, "cancelled", t.now.cancelled.title, null],
    ["черновик", { ...base, status: "DRAFT" as const }, "draft", buyer.draft.title, "/v2/requests/new?draft=r1"],
  ])("%s", (_name, input, kind, title, href) => {
    const view = nowView(input);
    expect(view.kind).toBe(kind);
    expect(view.title).toBe(title);
    expect(view.primary?.href ?? null).toBe(href);
  });

  it("покрыты все статусы заявки", () => {
    const all: RequestStatus[] = ["DRAFT", "PLATFORM_MEASURING", "OPEN", "OFFER_CHOSEN", "MEASURING", "CONTRACTING", "CLOSED", "CANCELLED"];
    for (const status of all) expect(nowView({ ...base, status }).title.length).toBeGreaterThan(0);
  });

  it("ожидание: «Дальше» — мастера пришлют цены и сроки, главного действия нет", () => {
    const view = nowView(base);
    expect(view.next).toBe("Мастера пришлют цены и сроки");
    expect(view.primary).toBeNull();
  });

  it("«Пришло N предложений»: «Сравните и откройте подходящее», главного действия нет (оно в списке)", () => {
    const view = nowView({ ...base, offersCount: 2 });
    expect(view.body).toBe("Сравните и откройте подходящее.");
    expect(view.primary).toBeNull();
  });

  it("тексты без запрещённых слов", () => {
    const all = JSON.stringify([t, nowView({ ...base, offersCount: 2 })]);
    expect(all).not.toMatch(/платформ|демо|комисси|эскроу|тестов|отклик/i);
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

  it("у открытой отклонённые не считаются и не показываются; только отклонённые — как «предложений нет»", () => {
    const declined = offer({ id: "d", status: "DECLINED" });
    const v = offersView(open, [declined, offer({ id: "s" })], "price");
    expect(v.rows.map((r) => r.id)).toEqual(["s"]);
    expect(v.sortable).toBe(false);
    const none = offersView(open, [declined], "price");
    expect(none.rows).toEqual([]);
    expect(none.empty?.title).toBe("Предложения придут сюда");
  });

  it("у заявки со сделкой вся история: выбранное и отклонённые с плашками", () => {
    const v = offersView({ ...open, status: "CLOSED" }, [offer({ id: "a", status: "ACCEPTED" }), offer({ id: "d", status: "DECLINED" })], "price");
    expect(v.rows.map((r) => r.chip?.text)).toEqual(["Выбрано", "Отклонено"]);
  });

  it("isLive: только отправленные", () => {
    expect(["SENT", "ACCEPTED", "DECLINED", "WITHDRAWN"].map((status) => isLive({ status } as never))).toEqual([true, false, false, false]);
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
