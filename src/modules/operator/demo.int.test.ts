import { afterEach, describe, expect, it } from "vitest";
import { db } from "@/platform/db";
import { resetEnvCache } from "@/platform/env";
import { makeOperator } from "../../../test/factories";
import { getPaymentRailSetting, resetDemoData, setPaymentRail } from "./demo";

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

  it("в DEMO_MODE пересоздаёт демо-данные, завершает все сессии и пишет событие в журнал", async () => {
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

describe("режим оплаты для новых сделок", () => {
  it("без DEMO_MODE переключать нельзя", async () => {
    setDemoMode(false);
    const operator = await makeOperator();
    await expect(setPaymentRail(operator, { mode: "escrow-simulator" })).rejects.toMatchObject({ code: "FORBIDDEN" });
    expect(await db.platformSetting.count()).toBe(0);
  });

  it("сохраняет режим в PlatformSetting с аудитом до и после", async () => {
    setDemoMode(true);
    const operator = await makeOperator();
    expect(await getPaymentRailSetting()).toEqual({ mode: "manual", source: "env" });

    await setPaymentRail(operator, { mode: "escrow-simulator" });

    expect(await getPaymentRailSetting()).toEqual({ mode: "escrow-simulator", source: "setting" });
    expect(await db.auditEvent.findFirstOrThrow({ where: { action: "settings.payments_rail.changed" } })).toMatchObject({
      before: { mode: "manual" },
      after: { mode: "escrow-simulator" },
    });
  });
});
