import { describe, expect, it } from "vitest";
import { legacy, to } from "./paths";

describe("адреса v2", () => {
  it("to: путь v2 — под префиксом", () => {
    expect(to("/")).toBe("/v2");
    expect(to("/deals/42")).toBe("/v2/deals/42");
    expect(to("deals")).toBe("/v2/deals");
  });

  it("to: пустой путь — главная v2", () => {
    expect(to("")).toBe("/v2");
  });

  it("to: корень с параметрами и якорем — без косой черты перед ними", () => {
    expect(to("/?a=1")).toBe("/v2?a=1");
    expect(to("/#x")).toBe("/v2#x");
    expect(to("?a=1")).toBe("/v2?a=1");
  });

  it("to: адрес уже под префиксом не получает его второй раз", () => {
    expect(to("/v2/deals")).toBe("/v2/deals");
    expect(to("/v2")).toBe("/v2");
    expect(to("/v2?a=1")).toBe("/v2?a=1");
    expect(to("/v2#x")).toBe("/v2#x");
  });

  it("to: путь, который только начинается с тех же букв, — обычный путь", () => {
    expect(to("/v2x")).toBe("/v2/v2x");
  });

  it("legacy: тот же экран в v1 — без префикса", () => {
    expect(legacy("/v2/deals/42")).toBe("/deals/42");
    expect(legacy("/v2")).toBe("/");
    expect(legacy("/v2/")).toBe("/");
  });

  it("legacy: корень с параметрами и якорем", () => {
    expect(legacy("/v2?tab=1")).toBe("/?tab=1");
    expect(legacy("/v2#x")).toBe("/#x");
    expect(legacy("/v2/deals?tab=1")).toBe("/deals?tab=1");
  });

  it("legacy: адрес не под префиксом остаётся как есть", () => {
    expect(legacy("/v2x")).toBe("/v2x");
    expect(legacy("/deals")).toBe("/deals");
  });

  it("legacy(to(x)) возвращает путь v1", () => {
    for (const path of ["/", "/deals/42", "/?a=1", "/requests/new"]) expect(legacy(to(path))).toBe(path);
  });
});
