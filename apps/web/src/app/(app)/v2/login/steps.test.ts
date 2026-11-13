import { describe, expect, it } from "vitest";
import { preselectedRole } from "./steps";

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
