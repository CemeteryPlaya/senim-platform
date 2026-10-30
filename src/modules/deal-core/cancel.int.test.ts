import { describe, expect, it } from "vitest";
import { db } from "@/platform/db";
import { dealOf, makeDeal, noCancelHooks } from "../../../test/factories/deal";
import { cancelDeal } from "./index";

describe("отмена сделки до начала работ", () => {
  it("договор становится SUPERSEDED в той же транзакции, с записью в журнале", async () => {
    const f = await makeDeal();
    const contract = await db.document.findFirstOrThrow({ where: { dealId: f.dealId, kind: "CONTRACT" } });

    await cancelDeal(f.client, { dealId: f.dealId, reason: "Передумали" }, noCancelHooks);

    expect(await dealOf(f.dealId)).toMatchObject({ status: "CANCELLED" });
    expect(await db.document.findUniqueOrThrow({ where: { id: contract.id } })).toMatchObject({ status: "SUPERSEDED" });
    const audit = await db.auditEvent.findMany({ where: { action: "document.superseded", entityId: contract.id } });
    expect(audit).toHaveLength(1);
  });
});
