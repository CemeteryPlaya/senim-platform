import { describe, expect, it } from "vitest";
import { db } from "@/platform/db";
import { makeOperator, makeUser } from "../../../test/factories";
import { EXECUTOR_IDENTITY_KEY, getExecutorIdentityMode, setExecutorIdentityMode } from "./identity-mode";

describe("режим «имя исполнителя скрыто / показано»", () => {
  it("по умолчанию — HIDDEN", async () => {
    expect(await getExecutorIdentityMode()).toBe("HIDDEN");
  });

  it("оператор переключает режим; в журнале — до и после", async () => {
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
    const operator = await makeOperator();
    await Promise.all([setExecutorIdentityMode(operator, "SHOWN"), setExecutorIdentityMode(operator, "SHOWN")]);
    await setExecutorIdentityMode(operator, "SHOWN");
    expect(await db.auditEvent.count({ where: { action: "companies.executor_identity.switched" } })).toBe(1);
  });

  it("не оператор — FORBIDDEN; оператор без свежего второго фактора — MFA_REQUIRED; настройка не меняется", async () => {
    const client = await makeUser("CLIENT");
    await expect(setExecutorIdentityMode(client, "SHOWN")).rejects.toMatchObject({ code: "FORBIDDEN" });

    const operator = await makeOperator();
    const stale = { ...operator, mfa: { required: true, verifiedAt: new Date(Date.now() - 60 * 60_000) } };
    await expect(setExecutorIdentityMode(stale, "SHOWN")).rejects.toMatchObject({ code: "MFA_REQUIRED" });
    await expect(setExecutorIdentityMode({ ...operator, mfa: { required: true, verifiedAt: null } }, "SHOWN")).rejects.toMatchObject({ code: "MFA_REQUIRED" });
    expect(await db.platformSetting.count()).toBe(0);
  });

  it("записанная настройка действует без условий окружения", async () => {
    await db.platformSetting.create({ data: { key: EXECUTOR_IDENTITY_KEY, value: "SHOWN" } });
    expect(await getExecutorIdentityMode()).toBe("SHOWN");
  });
});
