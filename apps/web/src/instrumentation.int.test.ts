import { afterEach, describe, expect, it } from "vitest";
import type { DocumentsPort } from "@/modules/deal-core";
import { documentsPort } from "@/modules/documents";
import { resetEnvCache } from "@/platform/env";
import { register } from "./instrumentation";

const registry = globalThis as unknown as { senimDocumentsPort?: DocumentsPort };
const runtime = process.env.NEXT_RUNTIME;

afterEach(() => {
  delete registry.senimDocumentsPort;
  if (runtime === undefined) delete process.env.NEXT_RUNTIME;
  else process.env.NEXT_RUNTIME = runtime;
});

describe("instrumentation.register", () => {
  it("на сервере Node регистрирует порт документов для deal-core", async () => {
    process.env.NEXT_RUNTIME = "nodejs";
    await register();
    expect(registry.senimDocumentsPort).toBe(documentsPort);
  });

  it("неверные переменные окружения роняют старт сервера, а не первый запрос; порты не регистрируются", async () => {
    process.env.NEXT_RUNTIME = "nodejs";
    const saved = process.env.STAND_ACCESS_PASSWORD;
    process.env.STAND_ACCESS_PASSWORD = "короткий";
    resetEnvCache();
    try {
      await expect(register()).rejects.toThrow(/STAND_ACCESS_PASSWORD/);
      expect(registry.senimDocumentsPort).toBeUndefined();
    } finally {
      if (saved === undefined) delete process.env.STAND_ACCESS_PASSWORD;
      else process.env.STAND_ACCESS_PASSWORD = saved;
      resetEnvCache();
    }
  });

  it("в Edge ничего не регистрирует", async () => {
    process.env.NEXT_RUNTIME = "edge";
    await register();
    expect(registry.senimDocumentsPort).toBeUndefined();
  });
});
