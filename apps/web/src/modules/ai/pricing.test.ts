import { describe, expect, it } from "vitest";
import { costUsdMicros, priceOf } from "./pricing";

describe("costUsdMicros — стоимость операции в миллионных долях доллара", () => {
  it("мок бесплатен при любом объёме", () => {
    expect(costUsdMicros({ model: "mock/text", inputTokens: 10_000, outputTokens: 5_000 })).toBe(0);
    expect(costUsdMicros({ model: "mock/image", images: 3 })).toBe(0);
  });

  it("токены считаются по цене за миллион, изображения — поштучно", () => {
    const p = priceOf("some/unknown-model");
    const cost = costUsdMicros({ model: "some/unknown-model", inputTokens: 2_000, outputTokens: 500, images: 2 });
    expect(cost).toBe(Math.ceil((2_000 * p.inputPerMTok + 500 * p.outputPerMTok) / 1_000_000 + 2 * p.perImage));
    expect(cost).toBeGreaterThan(0);
  });

  it("неизвестная модель оценивается сверху, а не бесплатно", () => {
    expect(priceOf("vendor/new-model").inputPerMTok).toBeGreaterThan(0);
    expect(priceOf("vendor/new-model").perImage).toBeGreaterThan(0);
  });

  it("округляет вверх: доли микродоллара не теряются", () => {
    expect(costUsdMicros({ model: "vendor/x", inputTokens: 1 })).toBeGreaterThanOrEqual(1);
  });

  it("пустой учёт стоит ноль", () => {
    expect(costUsdMicros({ model: "vendor/x" })).toBe(0);
  });
});
