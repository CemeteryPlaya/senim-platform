import { describe, expect, it } from "vitest";
import { legacy, makePaths, to } from "./paths";

// Один набор случаев для префикса "/v2" (сейчас) и "" (после переключения на этапе 6): [вход, при "/v2", при ""].
const TO: [string, string, string][] = [
  ["/", "/v2", "/"],
  ["", "/v2", "/"],
  ["/deals/42", "/v2/deals/42", "/deals/42"],
  ["deals", "/v2/deals", "/deals"],
  ["/?a=1", "/v2?a=1", "/?a=1"],
  ["?a=1", "/v2?a=1", "/?a=1"],
  ["/#x", "/v2#x", "/#x"],
  // Адрес уже под префиксом не получает его второй раз.
  ["/v2/deals", "/v2/deals", "/v2/deals"],
  ["/v2", "/v2", "/v2"],
  ["/v2?a=1", "/v2?a=1", "/v2?a=1"],
  ["/v2#x", "/v2#x", "/v2#x"],
  // Путь, который только начинается с тех же букв, — обычный путь.
  ["/v2x", "/v2/v2x", "/v2x"],
];

const LEGACY: [string, string, string][] = [
  ["/v2/deals/42", "/deals/42", "/v2/deals/42"],
  ["/v2", "/", "/v2"],
  ["/v2/", "/", "/v2/"],
  ["/v2?tab=1", "/?tab=1", "/v2?tab=1"],
  ["/v2#x", "/#x", "/v2#x"],
  ["/v2/deals?tab=1", "/deals?tab=1", "/v2/deals?tab=1"],
  ["/v2x", "/v2x", "/v2x"],
  ["/deals", "/deals", "/deals"],
  ["/", "/", "/"],
];

describe.each([
  ["/v2", 1],
  ["", 2],
] as const)("makePaths(%j)", (base, col) => {
  const paths = makePaths(base);

  it.each(TO)("to(%j)", (input, ...expected) => {
    expect(paths.to(input)).toBe(expected[col - 1]);
  });

  it.each(LEGACY)("legacy(%j)", (input, ...expected) => {
    expect(paths.legacy(input)).toBe(expected[col - 1]);
  });

  it("legacy(to(x)) возвращает путь v1", () => {
    for (const path of ["/", "/deals/42", "/?a=1", "/requests/new"]) expect(paths.legacy(paths.to(path))).toBe(path);
  });
});

describe("to и legacy приложения — префикс /v2", () => {
  it("совпадают с makePaths(\"/v2\")", () => {
    expect(to("/deals")).toBe("/v2/deals");
    expect(legacy("/v2/deals")).toBe("/deals");
  });
});
