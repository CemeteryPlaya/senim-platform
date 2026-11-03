import { afterEach, describe, expect, it } from "vitest";
import { resetEnvCache } from "@/platform/env";
import { documents, requests } from "./ports";

/** Регистрация портов живёт в globalThis (переживает HMR); здесь её нет — как в процессе, где забыли registerPorts. */
const registry = globalThis as unknown as { senimDocumentsPort?: unknown; senimRequestsPort?: unknown };

/** NODE_ENV в типах Next — только для чтения; тест подменяет его на время проверки. */
const processEnv = process.env as Record<string, string | undefined>;
const nodeEnv = processEnv.NODE_ENV;
afterEach(() => {
  processEnv.NODE_ENV = nodeEnv;
  resetEnvCache();
});

describe("порты deal-core без регистрации", () => {
  it("в тестах — заглушки (документ без PDF, заявка не трогается)", () => {
    expect(registry.senimDocumentsPort).toBeUndefined();
    expect(typeof documents().createContract).toBe("function");
    expect(typeof requests().onDealCancelled).toBe("function");
  });

  it("вне тестов (NODE_ENV=development) — ошибка с подсказкой registerPorts", () => {
    processEnv.NODE_ENV = "development";
    resetEnvCache();
    expect(() => documents()).toThrow(/registerPorts/);
    expect(() => requests()).toThrow(/registerPorts/);
  });
});
