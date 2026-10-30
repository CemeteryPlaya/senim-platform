import { describe, expect, it } from "vitest";
import { suggestSegment } from "./segment";

describe("suggestSegment", () => {
  it("ЛДСП без дорогих деталей — эконом", () => {
    const s = suggestSegment({ facade: "ldsp", countertop: "ldsp", hardware: "standard" });
    expect(s.segment).toBe("ECONOMY");
    expect(s.reasons.length).toBeGreaterThan(0);
  });

  it("эмаль на фасадах поднимает до комфорта и объясняет почему", () => {
    const s = suggestSegment({ facade: "mdf_enamel", countertop: "ldsp", hardware: "standard" });
    expect(s.segment).toBe("COMFORT");
    expect(s.reasons.join(" ")).toMatch(/эмаль/i);
  });

  it("массив или шпон — премиум", () => {
    expect(suggestSegment({ facade: "solid_wood" }).segment).toBe("PREMIUM");
    expect(suggestSegment({ facade: "veneer" }).segment).toBe("PREMIUM");
  });

  it("самый дорогой признак определяет сегмент", () => {
    const s = suggestSegment({ facade: "ldsp", countertop: "quartz", hardware: "standard" });
    expect(s.segment).toBe("PREMIUM");
  });

  it("большая длина кухни на эконом-материалах поднимает до комфорта", () => {
    expect(suggestSegment({ facade: "ldsp", widthCm: 520 }).segment).toBe("COMFORT");
  });

  it("если заказчик ничего не знает — подсказки нет", () => {
    const s = suggestSegment({});
    expect(s.segment).toBeNull();
    expect(s.reasons).toEqual([]);
  });
});
