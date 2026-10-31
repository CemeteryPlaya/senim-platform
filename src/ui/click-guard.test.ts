import { describe, expect, it } from "vitest";
import { isOpeningClick, isRepeatClick, OPENING_GRACE_MS } from "./click-guard";

describe("isOpeningClick — клик сразу после открытия окна гасится", () => {
  it("второй клик двойного нажатия (через 120 мс) — продолжение открытия", () => {
    expect(isOpeningClick(1000, 1120)).toBe(true);
  });

  it("на границе окна ожидания — уже осознанный клик", () => {
    expect(isOpeningClick(1000, 1000 + OPENING_GRACE_MS)).toBe(false);
  });

  it("через секунду — обычный клик", () => {
    expect(isOpeningClick(1000, 2000)).toBe(false);
  });

  it("окно ещё не открывали — клики не гасим", () => {
    expect(isOpeningClick(null, 50)).toBe(false);
  });
});

describe("isRepeatClick — повтор в серии кликов не считается новым согласием", () => {
  it.each([
    [0, false], // клавиатура: Enter и пробел дают detail = 0
    [1, false],
    [2, true],
    [3, true],
  ])("detail=%i → %s", (detail, repeat) => {
    expect(isRepeatClick(detail)).toBe(repeat);
  });
});
