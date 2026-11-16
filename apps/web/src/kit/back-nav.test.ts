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
  const memory = { prev: "/v2/deals", cur: "/v2/deals/5" };

  it("пришли с родителя (в том числе с фильтром в адресе) — назад по истории", () => {
    expect(pathnameOf("/v2/deals/?group=done#x")).toBe("/v2/deals");
    expect(shouldGoBack({ memory: { prev: "/v2/deals?group=done", cur: "/v2/deals/5" }, href: "/v2/deals", click: plain, historyLength: 4 })).toBe(true);
    expect(shouldGoBack({ memory, href: "/v2/deals", click: plain, historyLength: 2 })).toBe(true);
  });

  it("прямой вход (нет предыдущего) или пришли не с родителя — ссылка к родителю", () => {
    expect(shouldGoBack({ memory: { prev: null, cur: "/v2/deals/5" }, href: "/v2/deals", click: plain, historyLength: 3 })).toBe(false);
    expect(shouldGoBack({ memory: { prev: "/v2/notifications", cur: "/v2/deals/5" }, href: "/v2/deals", click: plain, historyLength: 3 })).toBe(false);
    expect(shouldGoBack({ memory, href: "/v2/deals", click: plain, historyLength: 1 })).toBe(false);
  });

  it("средняя кнопка, Ctrl, ⌘, Shift — ссылка работает как обычно", () => {
    for (const click of [{ ...plain, button: 1 }, { ...plain, ctrlKey: true }, { ...plain, metaKey: true }, { ...plain, shiftKey: true }]) {
      expect(shouldGoBack({ memory, href: "/v2/deals", click, historyLength: 5 })).toBe(false);
    }
  });
});
