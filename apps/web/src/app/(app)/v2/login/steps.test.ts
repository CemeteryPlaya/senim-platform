import { describe, expect, it } from "vitest";
import { preselectedRole, secondsLeft } from "./steps";

describe("secondsLeft", () => {
  it.each([
    [60_000, 60],
    [59_001, 60],
    [59_000, 59],
    [1, 1],
    [0, 0],
    [-5_000, 0],
  ])("до срока %i мс — %i с", (ms, seconds) => {
    expect(secondsLeft(1_000_000 + ms, 1_000_000)).toBe(seconds);
  });
});

describe("preselectedRole: какая карточка выбрана при открытии", () => {
  it.each<[unknown, "CLIENT" | "EXECUTOR" | null, "client" | "executor"]>([
    [undefined, null, "client"],
    ["", null, "client"],
    ["operator", null, "client"],
    [undefined, "EXECUTOR", "executor"],
    [undefined, "CLIENT", "client"],
    ["executor", null, "executor"],
    ["executor", "CLIENT", "executor"],
    ["client", "EXECUTOR", "client"],
  ])("адрес %j, cookie %j → %s", (param, remembered, expected) => {
    expect(preselectedRole(param, remembered)).toBe(expected);
  });
});
