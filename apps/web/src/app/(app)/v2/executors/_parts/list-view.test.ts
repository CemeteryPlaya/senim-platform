import { describe, expect, it } from "vitest";
import { ru } from "@/i18n/ru";
import type { ExecutorListItem } from "@/modules/companies";
import { executorsListView, invitable, parseExecutorsSearch } from "./list-view";

const t = ru.app.guest.executors;

const item = (over: Partial<ExecutorListItem> = {}): ExecutorListItem => ({
  publicNumber: 7,
  label: "Исполнитель №7",
  segment: "COMFORT",
  ratingAvg: 4.8,
  reviewsCount: 12,
  stats: { deals: 15, ended: 13, successful: 12, successRate: 92 },
  cover: { src: "/api/files/portfolio/a.jpg?sig=1", alt: "Кухня, фото 1" },
  ...over,
});

describe("адрес списка мастеров", () => {
  it.each([
    [{}, { page: 1, requestId: null }],
    [{ page: "3" }, { page: 3, requestId: null }],
    [{ page: "0" }, { page: 1, requestId: null }],
    [{ page: "abc" }, { page: 1, requestId: null }],
    [{ page: ["2", "5"] }, { page: 2, requestId: null }],
    [{ request: "cmabc123" }, { page: 1, requestId: "cmabc123" }],
    [{ request: "../x" }, { page: 1, requestId: null }],
    [{ request: "a".repeat(65) }, { page: 1, requestId: null }],
  ])("%j", (params, expected) => {
    expect(parseExecutorsSearch(params)).toEqual(expected);
  });
});

describe("заявка, для которой открыт список", () => {
  it("только открытая, на всех мастеров и путём ТЗ", () => {
    expect(invitable({ status: "OPEN", mode: "TENDER", path: "TZ" })).toBe(true);
    expect(invitable({ status: "OPEN", mode: "DIRECT", path: "TZ" })).toBe(false);
    expect(invitable({ status: "OPEN", mode: "TENDER", path: "EXECUTOR_MEASURE" })).toBe(false);
    for (const status of ["DRAFT", "PLATFORM_MEASURING", "OFFER_CHOSEN", "MEASURING", "CONTRACTING", "CLOSED", "CANCELLED"] as const) {
      expect(invitable({ status, mode: "TENDER", path: "TZ" })).toBe(false);
    }
  });
});

describe("вид списка мастеров", () => {
  it("карточка: ссылка на профиль, метка, уровень и оценка, сделки и доля успешных, фото", () => {
    const view = executorsListView({ items: [item()], total: 1 }, { page: 1, requestId: null }, null);
    expect(view.state).toBe("results");
    expect(view.cards).toEqual([
      {
        key: "7",
        href: "/v2/executors/7",
        title: "Исполнитель №7",
        meta: "Комфорт · 4,8 · 12 отзывов",
        byline: "Сделок: 15 · Успешных: 92%",
        photo: { src: "/api/files/portfolio/a.jpg?sig=1", alt: "Кухня, фото 1" },
      },
    ]);
    expect(view.media).toBe("slot");
    expect(view.empty).toBeNull();
  });

  it("без отзывов, без уровня, без оконченных сделок; иллюстрация сида — не фото", () => {
    const view = executorsListView(
      { items: [item({ segment: null, reviewsCount: 0, ratingAvg: 0, stats: { deals: 2, ended: 0, successful: 0, successRate: null }, cover: { src: "/demo/portfolio/x.svg", alt: "x" } })], total: 1 },
      { page: 1, requestId: null },
      null,
    );
    expect(view.cards[0]).toMatchObject({ meta: t.noReviews, byline: "Сделок: 2" });
    expect(view.cards[0]).not.toHaveProperty("photo");
    expect(view.media).toBe("none");
  });

  it("пагинация: страниц по total, адрес страницы сохраняет заявку", () => {
    const view = executorsListView({ items: [item()], total: 25 }, { page: 2, requestId: "r1" }, { requestId: "r1", number: 42 });
    expect(view.pageCount).toBe(3);
    expect(view.page).toBe(2);
    expect(view.hrefFor(1)).toBe("/v2/executors?request=r1");
    expect(view.hrefFor(3)).toBe("/v2/executors?page=3&request=r1");
  });

  it("с заявкой: подзаголовок с номером и «Назад» к заявке; приглашение — флаг для следующего шага", () => {
    const view = executorsListView({ items: [item()], total: 1 }, { page: 1, requestId: "r1" }, { requestId: "r1", number: 42 });
    expect(view.lead).toBe("Для заявки №42");
    expect(view.back).toEqual({ href: "/v2/requests/r1", label: t.backToRequest });
    expect(view.invite).toEqual({ requestId: "r1", number: 42 });
  });

  it("заявка в адресе, но не подошла (чужая, не открыта) — обычный список; ссылки страниц без неё", () => {
    const view = executorsListView({ items: [item()], total: 25 }, { page: 1, requestId: "foreign" }, null);
    expect(view.lead).toBe(t.lead);
    expect(view.back).toBeNull();
    expect(view.invite).toBeNull();
    expect(view.hrefFor(2)).toBe("/v2/executors?page=2");
  });

  it("пусто — одно действие на главную; страница за концом — к первой", () => {
    const empty = executorsListView({ items: [], total: 0 }, { page: 1, requestId: null }, null);
    expect(empty.state).toBe("empty");
    expect(empty.empty).toEqual({ title: t.empty.title, body: t.empty.body, action: { href: "/v2", label: t.empty.action } });

    const beyond = executorsListView({ items: [], total: 13 }, { page: 9, requestId: null }, null);
    expect(beyond.state).toBe("beyond");
    expect(beyond.empty).toEqual({ title: t.beyond.title, body: t.beyond.body(2), action: { href: "/v2/executors", label: t.beyond.action } });
  });
});
