import { afterEach, describe, expect, it } from "vitest";
import type { DocumentsPort } from "@/modules/deal-core";
import { documentsPort } from "@/modules/documents";
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

  it("в Edge ничего не регистрирует", async () => {
    process.env.NEXT_RUNTIME = "edge";
    await register();
    expect(registry.senimDocumentsPort).toBeUndefined();
  });
});
