import { afterEach, describe, expect, it } from "vitest";
import { resetEnvCache } from "@/platform/env";
import { FEATURE_KEYS } from "@/platform/features";
import { makeOperator } from "../../../test/factories";
import { platformSettings } from "./settings";

const touched = ["AI_ENABLED", "PAYMENT_PROVIDER"] as const;
const saved = Object.fromEntries(touched.map((k) => [k, process.env[k]]));

afterEach(() => {
  for (const k of touched) {
    if (saved[k] === undefined) delete process.env[k];
    else process.env[k] = saved[k];
  }
  resetEnvCache();
});

describe("флаги и окружение (только чтение)", () => {
  it("все флаги с переменной окружения и состоянием; флаг ai — в обоих положениях", async () => {
    const operator = await makeOperator();
    process.env.AI_ENABLED = "false";
    resetEnvCache();
    const off = platformSettings(operator);
    expect(off.flags.map((f) => f.key)).toEqual([...FEATURE_KEYS]);
    expect(off.flags.find((f) => f.key === "ai")).toEqual({ key: "ai", envVar: "AI_ENABLED", enabled: false });

    process.env.AI_ENABLED = "true";
    resetEnvCache();
    expect(platformSettings(operator).flags.find((f) => f.key === "ai")?.enabled).toBe(true);
  });

  it("провайдер новых сделок: из PAYMENT_PROVIDER или по APP_ENV", async () => {
    const operator = await makeOperator();
    process.env.PAYMENT_PROVIDER = "manual";
    resetEnvCache();
    expect(platformSettings(operator)).toMatchObject({ newDealProvider: "manual", providerFromDefault: false });

    delete process.env.PAYMENT_PROVIDER;
    resetEnvCache();
    const byEnv = platformSettings(operator);
    expect(byEnv.providerFromDefault).toBe(true);
    expect(byEnv.newDealProvider).toBe({ dev: "mock", staging: "freedompay", prod: "manual" }[byEnv.appEnv]);
  });
});
