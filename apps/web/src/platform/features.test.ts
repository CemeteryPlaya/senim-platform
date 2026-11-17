import { describe, expect, it } from "vitest";
import { parseEnv } from "./env";
import { FEATURE_ENV, FEATURE_KEYS, featuresFrom, type FeatureKey } from "./features";

const base = { DATABASE_URL: "postgresql://x" };

/** Отзывы и портфолио сделок в текущей фазе (решение владельца 17.11.2026): включены по умолчанию, выключаются `false`. */
const DEFAULT_ON: readonly FeatureKey[] = ["reviews", "dealPortfolio"];
const DEFAULT_OFF = FEATURE_KEYS.filter((key) => !DEFAULT_ON.includes(key));

describe("флаги Фазы 1", () => {
  it("по умолчанию вне Фазы 1 всё выключено, кроме отзывов и портфолио сделок", () => {
    const flags = featuresFrom(parseEnv(base));
    expect(Object.keys(flags).sort()).toEqual([...FEATURE_KEYS].sort());
    expect(DEFAULT_ON.every((key) => flags[key])).toBe(true);
    expect(DEFAULT_OFF.every((key) => !flags[key])).toBe(true);
  });

  it.each(DEFAULT_OFF)("флаг %s включается своей переменной окружения", (key) => {
    const flags = featuresFrom(parseEnv({ ...base, [FEATURE_ENV[key]]: "true" }));
    expect(flags[key]).toBe(true);
    expect(FEATURE_KEYS.filter((other) => other !== key && !DEFAULT_ON.includes(other)).every((other) => !flags[other])).toBe(true);
  });

  it.each(DEFAULT_ON)("флаг %s включён по умолчанию и выключается своей переменной окружения", (key) => {
    expect(featuresFrom(parseEnv({ ...base, [FEATURE_ENV[key]]: "true" }))[key]).toBe(true);
    const flags = featuresFrom(parseEnv({ ...base, [FEATURE_ENV[key]]: "false" }));
    expect(flags[key]).toBe(false);
    expect(FEATURE_KEYS.filter((other) => other !== key).every((other) => flags[other] === DEFAULT_ON.includes(other))).toBe(true);
  });
});
