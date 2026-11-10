import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { db } from "@/platform/db";
import { resetEnvCache } from "@/platform/env";
import { makeOperator } from "../../../test/factories";
import { useSeedStorage } from "../../../test/factories/documents";
import { signInAs } from "../../../test/factories/session";
import { identityFake } from "../../../test/stubs/identity";
import { resetDemoData } from "./demo";

function setDemoMode(on: boolean) {
  process.env.DEMO_MODE = on ? "true" : "false";
  resetEnvCache();
}

let cleanup: () => Promise<void>;
beforeAll(async () => {
  cleanup = await useSeedStorage();
});
afterAll(() => cleanup());

afterEach(() => {
  delete process.env.DEMO_MODE;
  resetEnvCache();
});

describe("сброс демо", () => {
  it("запрещён без DEMO_MODE и ничего не трогает", async () => {
    setDemoMode(false);
    const operator = await makeOperator();

    await expect(resetDemoData(operator)).rejects.toMatchObject({ code: "FORBIDDEN" });
    expect(await db.user.count()).toBe(1);
    expect(identityFake.calls).toHaveLength(0);
  });

  it("в DEMO_MODE пересоздаёт демо-данные, завершает все сессии и пишет событие в журнал", { timeout: 120_000 }, async () => {
    setDemoMode(true);
    const operator = await makeOperator();
    await signInAs(operator);

    await resetDemoData(operator);

    expect(await db.user.count({ where: { id: operator.id } })).toBe(0);
    expect(identityFake.calls.filter((c) => c.method === "resetDemo")).toHaveLength(1);
    expect(identityFake.sessionCount()).toBe(0);
    expect(await db.user.count({ where: { isDemo: true, role: "OPERATOR" } })).toBe(1);
    expect(await db.auditEvent.findFirstOrThrow({ where: { action: "demo.reset" } })).toMatchObject({ actorRole: "SYSTEM" });
  });
});
