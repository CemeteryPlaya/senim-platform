import { describe, expect, it } from "vitest";
import { makeClient } from "../../../test/factories";
import { db } from "@/platform/db";
import { recordAudit, SYSTEM } from "./index";

const entity = { type: "deal", id: "d1" };

describe("recordAudit: откуда", () => {
  it("действие человека вне запроса — ip и устройство неизвестны", async () => {
    const user = await makeClient();
    await recordAudit(db, { actor: { kind: "user", id: user.id, role: "CLIENT" }, action: "test.done", entity });
    expect(await db.auditEvent.findFirstOrThrow()).toMatchObject({ ip: null, userAgent: null, actorId: user.id });
  });

  it("явный origin записывается как есть", async () => {
    const user = await makeClient();
    await recordAudit(db, { actor: { kind: "user", id: user.id, role: "CLIENT" }, action: "test.done", entity, origin: { ip: "203.0.113.7", userAgent: "UA" } });
    expect(await db.auditEvent.findFirstOrThrow()).toMatchObject({ ip: "203.0.113.7", userAgent: "UA" });
  });

  it("системное действие — ip = null", async () => {
    await recordAudit(db, { actor: SYSTEM("deal-core"), action: "test.done", entity });
    expect(await db.auditEvent.findFirstOrThrow()).toMatchObject({ ip: null, userAgent: null, actorRole: "SYSTEM" });
  });
});
