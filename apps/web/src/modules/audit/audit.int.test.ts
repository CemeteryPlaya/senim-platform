import { describe, expect, it } from "vitest";
import { makeClient } from "../../../test/factories";
import { db } from "@/platform/db";
import { listAuditEvents, recordAudit, SYSTEM } from "./index";

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

describe("listAuditEvents", () => {
  it("фильтры по сущности, корню, автору, префиксу действия и курсору; новые сверху", async () => {
    const user = await makeClient();
    const actor = { kind: "user" as const, id: user.id, role: "CLIENT" as const };
    await recordAudit(db, { actor, action: "deal.started", entity, scope: "deal:d1" });
    await recordAudit(db, { actor: SYSTEM("x"), action: "deal.paid", entity, scope: "deal:d1" });
    await recordAudit(db, { actor, action: "request.created", entity: { type: "request", id: "r1" } });
    expect((await listAuditEvents()).map((e) => e.action)).toEqual(["request.created", "deal.paid", "deal.started"]);
    expect((await listAuditEvents({ scope: "deal:d1", actorId: user.id })).map((e) => e.action)).toEqual(["deal.started"]);
    expect((await listAuditEvents({ entityType: "deal", entityId: "d1", actionPrefix: "deal." })).length).toBe(2);
    const [newest] = await listAuditEvents({ limit: 1 });
    expect((await listAuditEvents({ beforeSeq: newest.seq })).map((e) => e.action)).toEqual(["deal.paid", "deal.started"]);
    expect(await listAuditEvents({ from: new Date(Date.now() + 60_000) })).toEqual([]);
  });
});
