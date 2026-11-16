import { describe, expect, it } from "vitest";
import { NAV_KEY, pathnameOf, readMemory, shouldGoBack, visit, writeMemory, type BackClick } from "./back-nav";

const plain: BackClick = { button: 0, metaKey: false, ctrlKey: false, shiftKey: false, altKey: false, defaultPrevented: false };

describe("память экранов", () => {
  it("смена пути переносит текущий в предыдущий, тот же путь память не двигает", () => {
    let m = visit({ prev: null, cur: null }, "/v2/deals");
    m = visit(m, "/v2/deals/5");
    expect(m).toEqual({ prev: "/v2/deals", cur: "/v2/deals/5" });
    expect(visit(m, "/v2/deals/5")).toBe(m);
  });

  it("хранилище: запись и чтение; битая запись и закрытое хранилище — пустая память", () => {
    const store = new Map<string, string>();
    const storage = { getItem: (k: string) => store.get(k) ?? null, setItem: (k: string, v: string) => void store.set(k, v) };
    writeMemory(storage, { prev: "/a", cur: "/b" });
    expect(readMemory(storage)).toEqual({ prev: "/a", cur: "/b" });
    store.set(NAV_KEY, "{не json");
    expect(readMemory(storage)).toEqual({ prev: null, cur: null });
    expect(readMemory(null)).toEqual({ prev: null, cur: null });
    const closed = {
      setItem: () => {
        throw new Error("закрыто");
      },
    };
    expect(() => writeMemory(closed, { prev: null, cur: null })).not.toThrow();
  });
});

describe("«Назад» по истории или к родителю", () => {
  const go = (memory: { prev: string | null; cur: string | null }, href: string, current: string, over: Partial<BackClick> = {}, historyLength = 4) =>
    shouldGoBack({ memory, href, current, click: { ...plain, ...over }, historyLength });

  it("пришли со списка (в том числе с фильтром в адресе) — назад по истории", () => {
    expect(pathnameOf("/v2/deals/?group=done#x")).toBe("/v2/deals");
    expect(go({ prev: "/v2/deals?group=done", cur: "/v2/deals/5" }, "/v2/deals", "/v2/deals/5")).toBe(true);
    expect(go({ prev: "/v2/deals", cur: "/v2/deals/5" }, "/v2/deals", "/v2/deals/5", {}, 2)).toBe(true);
  });

  it("сделка → ?history=all → «‹ Сделки»: предыдущий адрес — сама сделка, значит ссылка к родителю, а не шаг назад на карточку", () => {
    let m = visit({ prev: null, cur: null }, "/v2/deals?group=done");
    m = visit(m, "/v2/deals/5");
    expect(go(m, "/v2/deals", "/v2/deals/5")).toBe(true);
    m = visit(m, "/v2/deals/5?history=all");
    expect(m).toEqual({ prev: "/v2/deals/5", cur: "/v2/deals/5?history=all" });
    expect(go(m, "/v2/deals", "/v2/deals/5?history=all")).toBe(false);
  });

  it("мастер заявки и регистрация (?draft, ?step): смена шага не даёт шаг назад по истории", () => {
    let m = visit({ prev: null, cur: null }, "/v2/requests");
    m = visit(m, "/v2/requests/new?draft=a1&step=1");
    expect(go(m, "/v2/requests", "/v2/requests/new?draft=a1&step=1")).toBe(true);
    m = visit(m, "/v2/requests/new?draft=a1&step=2");
    // «Назад» на шаг: ссылка с параметрами — всегда обычная ссылка (replace и push шагов неважны).
    expect(go(m, "/v2/requests/new?draft=a1&step=1", "/v2/requests/new?draft=a1&step=2")).toBe(false);
    // «Назад» к родителю из середины анкеты: предыдущий адрес — шаг анкеты, а не список.
    expect(go(m, "/v2/requests", "/v2/requests/new?draft=a1&step=2")).toBe(false);
    let reg = visit({ prev: null, cur: null }, "/v2/profile");
    reg = visit(reg, "/v2/register/executor?step=2");
    reg = visit(reg, "/v2/register/executor?step=3");
    expect(go(reg, "/v2/profile", "/v2/register/executor?step=3")).toBe(false);
  });

  it("память устарела (запись не совпадает с адресом в окне) — ссылка", () => {
    expect(go({ prev: "/v2/deals", cur: "/v2/deals/5" }, "/v2/deals", "/v2/deals/7")).toBe(false);
  });

  it("прямой вход (нет предыдущего) или пришли не с родителя — ссылка к родителю", () => {
    expect(go({ prev: null, cur: "/v2/deals/5" }, "/v2/deals", "/v2/deals/5")).toBe(false);
    expect(go({ prev: "/v2/notifications", cur: "/v2/deals/5" }, "/v2/deals", "/v2/deals/5")).toBe(false);
    expect(go({ prev: "/v2/deals", cur: "/v2/deals/5" }, "/v2/deals", "/v2/deals/5", {}, 1)).toBe(false);
  });

  it("средняя кнопка, Ctrl, ⌘, Shift — ссылка работает как обычно", () => {
    for (const over of [{ button: 1 }, { ctrlKey: true }, { metaKey: true }, { shiftKey: true }]) {
      expect(go({ prev: "/v2/deals", cur: "/v2/deals/5" }, "/v2/deals", "/v2/deals/5", over)).toBe(false);
    }
  });
});
