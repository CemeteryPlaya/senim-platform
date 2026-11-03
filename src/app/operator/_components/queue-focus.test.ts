import { describe, expect, it } from "vitest";
import { nextQueueFocus } from "./queue-focus";

describe("очередь оператора: куда перевести фокус после решения", () => {
  it("карточка ушла — фокус на ту, что встала на её место", () => {
    expect(nextQueueFocus(0, 2)).toBe(0);
    expect(nextQueueFocus(1, 3)).toBe(1);
  });

  it("решена последняя карточка — фокус на новую последнюю", () => {
    expect(nextQueueFocus(2, 2)).toBe(1);
  });

  it("очередь опустела — некуда (фокус на заголовок пустого состояния)", () => {
    expect(nextQueueFocus(0, 0)).toBeNull();
  });

  it("место карточки неизвестно — на первую", () => {
    expect(nextQueueFocus(-1, 3)).toBe(0);
  });
});
