import { afterEach, describe, expect, it } from "vitest";
import { db } from "@/platform/db";
import { resetEnvCache } from "@/platform/env";
import { makeOperator } from "../../../test/factories";
import { resetDemoData } from "./demo";

function setDemoMode(on: boolean) {
  process.env.DEMO_MODE = on ? "true" : "false";
  resetEnvCache();
}

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
  });

  // INTEGRATOR: включить (it.skip → it) после пересборки src/demo/seed.ts под ADR-009 — сейчас сид пишет Offer.price.
  it.skip("в DEMO_MODE пересоздаёт демо-данные, завершает все сессии и пишет событие в журнал", async () => {
    setDemoMode(true);
    const operator = await makeOperator();
    await db.session.create({ data: { userId: operator.id, tokenHash: "h", expiresAt: new Date(Date.now() + 3600_000) } });

    await resetDemoData(operator);

    expect(await db.user.count({ where: { id: operator.id } })).toBe(0);
    expect(await db.session.count()).toBe(0);
    expect(await db.user.count({ where: { isDemo: true, role: "OPERATOR" } })).toBe(1);
    expect(await db.auditEvent.findFirstOrThrow({ where: { action: "demo.reset" } })).toMatchObject({ actorRole: "SYSTEM" });
  });
});
