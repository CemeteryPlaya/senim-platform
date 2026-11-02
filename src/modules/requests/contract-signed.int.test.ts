import { describe, expect, it } from "vitest";
import { db, transaction } from "@/platform/db";
import { makeDeal } from "../../../test/factories/deal";
import { onDealDocumentSigned } from "./index";

describe("заявка закрывается, когда оферта подписана обеими сторонами", () => {
  it("оферта → заявка CONTRACTING → CLOSED с записью в журнале", async () => {
    const f = await makeDeal();
    const contract = await db.document.findFirstOrThrow({ where: { dealId: f.dealId, kind: "CONTRACT" } });

    await transaction((tx) => onDealDocumentSigned(tx, contract.id));

    const request = await db.request.findUniqueOrThrow({ where: { id: f.requestId } });
    expect(request.status).toBe("CLOSED");
    expect(request.closedAt).not.toBeNull();
    expect(await db.auditEvent.count({ where: { action: "request.closed", entityId: f.requestId } })).toBe(1);
  });

  it("повторный вызов и заявка не в CONTRACTING ничего не меняют", async () => {
    const f = await makeDeal();
    const contract = await db.document.findFirstOrThrow({ where: { dealId: f.dealId, kind: "CONTRACT" } });
    await transaction((tx) => onDealDocumentSigned(tx, contract.id));
    await transaction((tx) => onDealDocumentSigned(tx, contract.id));

    expect(await db.auditEvent.count({ where: { action: "request.closed", entityId: f.requestId } })).toBe(1);
  });

  it("акт приёмки заявку не трогает", async () => {
    const f = await makeDeal();
    const contract = await db.document.findFirstOrThrow({ where: { dealId: f.dealId, kind: "CONTRACT" } });
    const act = await db.document.update({ where: { id: contract.id }, data: { kind: "ACCEPTANCE_ACT" } });

    await transaction((tx) => onDealDocumentSigned(tx, act.id));

    expect((await db.request.findUniqueOrThrow({ where: { id: f.requestId } })).status).toBe("CONTRACTING");
  });
});
