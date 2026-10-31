import { describe, expect, it } from "vitest";
import { isRepeatClick } from "./click-guard";

describe("isRepeatClick — повтор в серии кликов не считается новым согласием", () => {
  it.each([
    [0, false], // клавиатура: Enter и пробел дают detail = 0
    [1, false], // одиночный клик или касание — даже сразу после открытия окна
    [2, true], // второй клик двойного нажатия, открывшего окно
    [3, true],
  ])("detail=%i → %s", (detail, repeat) => {
    expect(isRepeatClick(detail)).toBe(repeat);
  });
});
