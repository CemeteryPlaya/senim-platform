import { describe, expect, it } from "vitest";
import { legacy, to } from "./paths";

describe("адреса v2", () => {
  it("to: путь v2 — под префиксом", () => {
    expect(to("/")).toBe("/v2");
    expect(to("/deals/42")).toBe("/v2/deals/42");
    expect(to("deals")).toBe("/v2/deals");
  });

  it("legacy: тот же экран в v1 — без префикса", () => {
    expect(legacy("/v2/deals/42")).toBe("/deals/42");
    expect(legacy("/v2")).toBe("/");
  });
});
