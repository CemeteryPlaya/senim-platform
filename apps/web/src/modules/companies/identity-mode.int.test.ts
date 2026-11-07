import { afterEach, describe, expect, it } from "vitest";
import { db } from "@/platform/db";
import { resetEnvCache } from "@/platform/env";
import { makeOperator, makeUser } from "../../../test/factories";
import { EXECUTOR_IDENTITY_KEY, getExecutorIdentityMode, setExecutorIdentityMode } from "./identity-mode";

function setDemoMode(on: boolean) {
  process.env.DEMO_MODE = on ? "true" : "false";
  resetEnvCache();
}

afterEach(() => {
  delete process.env.DEMO_MODE;
  resetEnvCache();
});

describe("режим «имя исполнителя скрыто / показано»", () => {
  it("по умолчанию — HIDDEN", async () => {
    setDemoMode(true);
    expect(await getExecutorIdentityMode()).toBe("HIDDEN");
  });

  it("оператор в демо переключает режим; в журнале — до и после", async () => {
    setDemoMode(true);
    const operator = await makeOperator();

    await setExecutorIdentityMode(operator, "SHOWN");

    expect(await getExecutorIdentityMode()).toBe("SHOWN");
    expect(await db.auditEvent.findFirstOrThrow({ where: { action: "companies.executor_identity.switched" } })).toMatchObject({
      actorRole: "OPERATOR",
      before: { mode: "HIDDEN" },
      after: { mode: "SHOWN" },
    });

    await setExecutorIdentityMode(operator, "HIDDEN");
    expect(await getExecutorIdentityMode()).toBe("HIDDEN");
  });

  it("повтор того же режима (двойной клик) ничего не пишет", async () => {
    setDemoMode(true);
    const operator = await makeOperator();
    await Promise.all([setExecutorIdentityMode(operator, "SHOWN"), setExecutorIdentityMode(operator, "SHOWN")]);
    await setExecutorIdentityMode(operator, "SHOWN");
    expect(await db.auditEvent.count({ where: { action: "companies.executor_identity.switched" } })).toBe(1);
  });

  it("не оператор и вне демо — FORBIDDEN, настройка не меняется", async () => {
    setDemoMode(true);
    const client = await makeUser("CLIENT");
    await expect(setExecutorIdentityMode(client, "SHOWN")).rejects.toMatchObject({ code: "FORBIDDEN" });

    setDemoMode(false);
    const operator = await makeOperator();
    await expect(setExecutorIdentityMode(operator, "SHOWN")).rejects.toMatchObject({ code: "FORBIDDEN" });
    expect(await db.platformSetting.count()).toBe(0);
  });

  it("вне демо настройка не действует: всегда HIDDEN", async () => {
    await db.platformSetting.create({ data: { key: EXECUTOR_IDENTITY_KEY, value: "SHOWN" } });
    setDemoMode(false);
    expect(await getExecutorIdentityMode()).toBe("HIDDEN");
    setDemoMode(true);
    expect(await getExecutorIdentityMode()).toBe("SHOWN");
  });
});
