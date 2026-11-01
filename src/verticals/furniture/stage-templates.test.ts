import { describe, expect, it } from "vitest";
import { DEFAULT_STAGE_TEMPLATE, STAGE_TEMPLATES } from "./stage-templates";

describe("шаблоны этапов мебели", () => {
  it("шаблон по умолчанию существует — аванс 50%", () => {
    const t = STAGE_TEMPLATES[DEFAULT_STAGE_TEMPLATE];
    expect(t.key).toBe("advance-50");
    expect(t.stages[0]).toMatchObject({ sharePercent: 50, paymentDue: "ON_START" });
  });

  it("в каждом шаблоне ключ совпадает с именем, а доли дают 100%", () => {
    for (const [key, t] of Object.entries(STAGE_TEMPLATES)) {
      expect(t.key).toBe(key);
      expect(t.stages.reduce((sum, s) => sum + s.sharePercent, 0)).toBe(100);
    }
  });
});
