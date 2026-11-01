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

describe("suggestSegment: объяснения и порог длины", () => {
  it("каждый признак — своя строка объяснения, название строчными", () => {
    expect(suggestSegment({ facade: "ldsp", countertop: "quartz", hardware: "soft_close" }).reasons).toEqual([
      "Фасады: лдсп — недорогой и практичный материал",
      "Столешница: кварцевый агломерат — очень прочный, дорогой материал",
      "Фурнитура: с доводчиками — двери и ящики закрываются плавно",
    ]);
  });

  it("одна фурнитура тоже даёт подсказку", () => {
    expect(suggestSegment({ hardware: "premium" })).toEqual({
      segment: "PREMIUM",
      reasons: ["Фурнитура: премиальная (blum, hettich) — дорогая фурнитура с гарантией производителя"],
    });
  });

  it("длина от 450 см поднимает эконом до комфорта и объясняет почему; короче — нет", () => {
    expect(suggestSegment({ facade: "ldsp", widthCm: 450 })).toEqual({
      segment: "COMFORT",
      reasons: ["Фасады: лдсп — недорогой и практичный материал", "Длина 450 см — большой объём работы, обычно это уровень «Комфорт»"],
    });
    expect(suggestSegment({ facade: "ldsp", widthCm: 449 }).segment).toBe("ECONOMY");
    expect(suggestSegment({ facade: "ldsp", widthCm: null }).segment).toBe("ECONOMY");
  });

  it("длина не трогает комфорт и премиум и без материалов подсказки не даёт", () => {
    expect(suggestSegment({ facade: "acrylic", widthCm: 600 }).reasons).toHaveLength(1);
    expect(suggestSegment({ facade: "veneer", widthCm: 600 }).segment).toBe("PREMIUM");
    expect(suggestSegment({ widthCm: 600 })).toEqual({ segment: null, reasons: [] });
  });
});
