import { describe, expect, it } from "vitest";
import { seedPlan } from "./plan";

describe("seedPlan: что делает npm run db:seed", () => {
  it.each([
    // prod: данные стенда в рабочую базу не пишутся, даже в пустую.
    [{ appEnv: "prod", empty: true, ifEmpty: true }, "skip-prod"],
    [{ appEnv: "prod", empty: false, ifEmpty: true }, "skip-prod"],
    [{ appEnv: "prod", empty: true, ifEmpty: false }, "refuse-prod"],
    [{ appEnv: "prod", empty: false, ifEmpty: false }, "refuse-prod"],
    // Пустая база вне prod — заполнить.
    [{ appEnv: "dev", empty: true, ifEmpty: false }, "seed"],
    [{ appEnv: "staging", empty: true, ifEmpty: true }, "seed"],
    [{ appEnv: undefined, empty: true, ifEmpty: false }, "seed"],
    // Непустая с --if-empty — не трогать.
    [{ appEnv: "dev", empty: false, ifEmpty: true }, "skip-not-empty"],
    [{ appEnv: undefined, empty: false, ifEmpty: true }, "skip-not-empty"],
    // Непустая без флага — пересоздать только при явном dev или staging.
    [{ appEnv: "dev", empty: false, ifEmpty: false }, "reseed"],
    [{ appEnv: "staging", empty: false, ifEmpty: false }, "reseed"],
    [{ appEnv: undefined, empty: false, ifEmpty: false }, "refuse-no-app-env"],
    [{ appEnv: "", empty: false, ifEmpty: false }, "refuse-no-app-env"],
    [{ appEnv: "production", empty: false, ifEmpty: false }, "refuse-no-app-env"],
  ] as const)("%o → %s", (input, plan) => {
    expect(seedPlan(input)).toBe(plan);
  });
});
