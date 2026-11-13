import { describe, expect, it } from "vitest";
import { ru } from "@/i18n/ru";
import { requestListView, type MyRequestRow } from "./list-view";

const t = ru.app.requests.list;
const DAY = new Date("2026-11-12T10:00:00Z");

const row = (over: Partial<MyRequestRow> = {}): MyRequestRow => ({
  id: "r1",
  title: "Кухня",
  status: "OPEN",
  mode: "TENDER",
  wizardStep: 5,
  createdAt: DAY,
  publishedAt: DAY,
  offersCount: 0,
  ...over,
});

describe("«Мои заявки»", () => {
  it("пусто — обучающий экран, без чипов", () => {
    expect(requestListView([], undefined)).toEqual({ group: "all", chips: [], cards: [], empty: "none" });
  });

  it("чипы: «Все» и непустые разделы с числом; выбранный раздел — из адреса", () => {
    const list = [row({ id: "a" }), row({ id: "b", status: "DRAFT", wizardStep: 2 }), row({ id: "c", status: "OPEN" })];
    const view = requestListView(list, "draft");
    expect(view.chips).toEqual([
      { href: "/v2/requests", label: t.chip(t.all, 3), active: false },
      { href: "/v2/requests?status=draft", label: t.chip(t.groups.draft, 1), active: true },
      { href: "/v2/requests?status=waiting", label: t.chip(t.groups.waiting, 2), active: false },
    ]);
    expect(view.cards.map((c) => c.id)).toEqual(["b"]);
    expect(requestListView(list, "nonsense").group).toBe("all");
  });

  it("выбранный раздел опустел — чип остаётся, пустое состояние раздела", () => {
    const view = requestListView([row()], "cancelled");
    expect(view.empty).toBe("filter");
    expect(view.chips.find((c) => c.active)?.label).toBe(t.chip(t.groups.cancelled, 0));
  });

  it("черновик ведёт в мастер на свой шаг; без типа — «Черновик»; отправленная — на карточку", () => {
    const [draft, untitled, sent] = requestListView(
      [
        row({ id: "d", status: "DRAFT", wizardStep: 2 }),
        row({ id: "u", status: "DRAFT", wizardStep: 0, title: ru.requests.untitled }),
        row({ id: "s", mode: "DIRECT", offersCount: 3 }),
      ],
      undefined,
    ).cards;
    expect(draft).toMatchObject({ href: "/v2/requests/new?draft=d", title: "Кухня", status: t.status.DRAFT, tone: "neutral", meta: t.draftProgress(2, 5) });
    expect(untitled.title).toBe(t.draftTitle);
    expect(sent).toMatchObject({ href: "/v2/requests/s", status: t.status.OPEN, tone: "accent" });
    expect(sent.meta).toBe(`${t.offers(3)} · ${t.direct} · ${t.sentOn("12 ноября 2026")}`);
  });

  it("склонение числа предложений", () => {
    expect([0, 1, 2, 5, 21].map(t.offers)).toEqual(["Нет предложений", "1 предложение", "2 предложения", "5 предложений", "21 предложение"]);
  });
});
