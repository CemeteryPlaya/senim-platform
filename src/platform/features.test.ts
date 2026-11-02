import { describe, expect, it } from "vitest";
import { parseEnv } from "./env";
import { FEATURE_ENV, FEATURE_KEYS, featuresFrom } from "./features";

const base = { DATABASE_URL: "postgresql://x" };

describe("флаги Фазы 1", () => {
  it("по умолчанию всё вне Фазы 1 выключено", () => {
    const flags = featuresFrom(parseEnv(base));
    expect(Object.values(flags).every((on) => on === false)).toBe(true);
    expect(Object.keys(flags).sort()).toEqual([...FEATURE_KEYS].sort());
  });

  it.each(FEATURE_KEYS)("флаг %s включается своей переменной окружения", (key) => {
    const flags = featuresFrom(parseEnv({ ...base, [FEATURE_ENV[key]]: "true" }));
    expect(flags[key]).toBe(true);
    expect(FEATURE_KEYS.filter((other) => other !== key).every((other) => !flags[other])).toBe(true);
  });
});
