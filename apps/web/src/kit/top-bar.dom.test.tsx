// @vitest-environment jsdom
import { act } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mount, type Mounted } from "./test-utils";
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

  it("уход со страницы снимает переменную: шапка других страниц — обычное стекло", () => {
    mounted = mount(<TopBarOverPhoto />);
    expect(value()).toBe("0");
    mounted.unmount();
    mounted = null;
    expect(value()).toBe("");
  });
});
