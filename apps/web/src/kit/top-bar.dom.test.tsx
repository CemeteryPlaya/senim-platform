// @vitest-environment jsdom
import { act } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mount, type Mounted } from "./test-utils";
import { TOP_BAR_GLASS_ATTR, TOP_BAR_LIVE_ATTR, topBarEarlyScript, topBarTarget } from "./top-bar-logic";
import { TOP_BAR_VAR, TopBarOverPhoto } from "./TopBarOverPhoto";

let mounted: Mounted | null = null;
let bar: HTMLElement;
let reduce = false;
let frames: FrameRequestCallback[] = [];
let now = 0;

const scrollTo = (y: number) => {
  Object.defineProperty(window, "scrollY", { configurable: true, value: y });
  act(() => {
    window.dispatchEvent(new Event("scroll"));
  });
};
/** Прогнать кадры анимации до `ms` от текущего времени. */
const advance = (ms: number) => {
  const end = now + ms;
  while (frames.length > 0 && now < end) {
    now = Math.min(end, now + 16);
    const due = frames;
    frames = [];
    act(() => due.forEach((cb) => cb(now)));
  }
};
const value = () => bar.style.getPropertyValue(TOP_BAR_VAR);

beforeEach(() => {
  reduce = false;
  frames = [];
  now = 0;
  bar = document.createElement("header");
  bar.setAttribute("data-top-bar", "");
  document.body.append(bar);
  Object.defineProperty(window, "scrollY", { configurable: true, value: 0 });
  vi.spyOn(performance, "now").mockImplementation(() => now);
  vi.stubGlobal("requestAnimationFrame", (cb: FrameRequestCallback) => frames.push(cb));
  vi.stubGlobal("cancelAnimationFrame", () => {
    frames = [];
  });
  vi.stubGlobal("matchMedia", (query: string) => ({
    matches: query.includes("reduced-motion") && reduce,
    addEventListener: () => undefined,
    removeEventListener: () => undefined,
  }));
});

afterEach(() => {
  mounted?.unmount();
  mounted = null;
  bar.remove();
  document.documentElement.removeAttribute(TOP_BAR_GLASS_ATTR);
  document.documentElement.removeAttribute(TOP_BAR_LIVE_ATTR);
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("TopBarOverPhoto: вид шапки над фото", () => {
  it("вверху страницы — 0 (над фото); с 1rem прокрутки — плавно до 1 за 150 мс; обратно — плавно до 0", () => {
    mounted = mount(<TopBarOverPhoto />);
    expect(value()).toBe("0");

    scrollTo(10);
    expect(frames).toHaveLength(0); // меньше 1rem — вид не меняется

    scrollTo(16);
    advance(64);
    const middle = Number(value());
    expect(middle).toBeGreaterThan(0);
    expect(middle).toBeLessThan(1);
    advance(200);
    expect(value()).toBe("1");
    expect(frames).toHaveLength(0); // переход окончен — кадров больше нет

    scrollTo(0);
    advance(64);
    expect(Number(value())).toBeLessThan(1);
    advance(200);
    expect(value()).toBe("0");
  });

  it("страница открыта прокрученной — сразу стекло, без перехода", () => {
    Object.defineProperty(window, "scrollY", { configurable: true, value: 400 });
    mounted = mount(<TopBarOverPhoto />);
    expect(value()).toBe("1");
  });

  it("меньше движения — вид меняется сразу, в первом же кадре", () => {
    reduce = true;
    mounted = mount(<TopBarOverPhoto />);
    scrollTo(40);
    advance(16);
    expect(value()).toBe("1");
  });

  it("у порога не мигает: стекло с 1rem, обратно — только ниже 0,5rem", () => {
    mounted = mount(<TopBarOverPhoto />);
    scrollTo(16);
    advance(300);
    expect(value()).toBe("1");
    scrollTo(10); // между порогами — вид прежний
    expect(frames).toHaveLength(0);
    expect(value()).toBe("1");
    scrollTo(7);
    advance(300);
    expect(value()).toBe("0");
  });

  it("уход со страницы снимает переменную и атрибуты: шапка других страниц — обычное стекло", () => {
    document.documentElement.setAttribute(TOP_BAR_GLASS_ATTR, "");
    Object.defineProperty(window, "scrollY", { configurable: true, value: 400 });
    mounted = mount(<TopBarOverPhoto />);
    expect(value()).toBe("1");
    expect(document.documentElement.hasAttribute(TOP_BAR_LIVE_ATTR)).toBe(true);
    mounted.unmount();
    mounted = null;
    expect(value()).toBe("");
    expect(document.documentElement.hasAttribute(TOP_BAR_GLASS_ATTR)).toBe(false);
    expect(document.documentElement.hasAttribute(TOP_BAR_LIVE_ATTR)).toBe(false);
  });

  it("в браузере встроенный скрипт не выполняется повторно: тип text/plain", () => {
    mounted = mount(<TopBarOverPhoto />);
    const script = mounted.container.querySelector("script");
    expect(script?.getAttribute("type")).toBe("text/plain");
    expect(script?.textContent).toBe(topBarEarlyScript());
  });
});

describe("topBarTarget: пороги с гистерезисом", () => {
  it("из прозрачной — стекло с 1rem; из стекла — обратно только ниже 0,5rem", () => {
    expect(topBarTarget(15, 16, 0)).toBe(0);
    expect(topBarTarget(16, 16, 0)).toBe(1);
    expect(topBarTarget(8, 16, 1)).toBe(1);
    expect(topBarTarget(7.9, 16, 1)).toBe(0);
    expect(topBarTarget(30, 20, 0)).toBe(1); // крупный шрифт: пороги в rem
    expect(topBarTarget(19, 20, 0)).toBe(0);
  });
});

describe("встроенный скрипт до запуска React", () => {
  const run = () => new Function(topBarEarlyScript())();
  const glass = () => document.documentElement.hasAttribute(TOP_BAR_GLASS_ATTR);

  it("страница открыта сверху — атрибута нет; браузер восстановил прокрутку — стекло; те же пороги с гистерезисом", () => {
    run();
    expect(glass()).toBe(false);
    scrollTo(500); // восстановленная прокрутка при перезагрузке или «Назад»
    expect(glass()).toBe(true);
    scrollTo(10);
    expect(glass()).toBe(true);
    scrollTo(4);
    expect(glass()).toBe(false);
  });

  it("открыта уже прокрученной — стекло сразу, при разборе HTML", () => {
    Object.defineProperty(window, "scrollY", { configurable: true, value: 300 });
    run();
    expect(glass()).toBe(true);
  });

  it("когда вид ведёт TopBarOverPhoto, скрипт больше не трогает атрибут", () => {
    run();
    document.documentElement.setAttribute(TOP_BAR_LIVE_ATTR, "");
    scrollTo(500);
    expect(glass()).toBe(false);
    scrollTo(600);
    expect(glass()).toBe(false);
  });
});
