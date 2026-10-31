import { describe, expect, it } from "vitest";
import { db } from "@/platform/db";
import { makeDeal, makeStagePhoto, signContract, stagesOf, TEMPLATES } from "../../../test/factories/deal";
import { openDispute, requestRework, startStage, submitStage, submitDisputePosition } from "./index";

/** Отчёт этапа и тексты спора видит другая сторона: без контактов, у исполнителя — и без наименования. */
describe("тексты сторон в сделке", () => {
  it("отчёт этапа исполнителя — без телефона и наименования", async () => {
    const f = await makeDeal({ template: TEMPLATES.single });
    await signContract(f.dealId);
    const [first] = await stagesOf(f.dealId);
    const { legalName } = await db.executorProfile.findUniqueOrThrow({ where: { id: f.executor.executor.id } });
    await startStage(f.executor, { stageId: first.id });

    await submitStage(f.executor, {
      stageId: first.id,
      report: `Готово. ${legalName}, звоните 8 701 123 45 67`,
      photoIds: [await makeStagePhoto(f.executor)],
    });

    const [stage] = await stagesOf(f.dealId);
    expect(stage.report).toContain("Готово");
    expect(stage.report).not.toMatch(/701/);
    expect(stage.report).not.toContain(legalName.replace(/^ИП\s+/, ""));
  });

  it("описание спора и позиция стороны — без контактов", async () => {
    const f = await makeDeal({ template: TEMPLATES.single });
    await signContract(f.dealId);
    await openDispute(f.client, { dealId: f.dealId, reason: "QUALITY", description: "Царапины, пишите мне на client@example.com" });
    const dispute = await db.dispute.findFirstOrThrow({ where: { dealId: f.dealId } });
    expect(dispute.description).not.toContain("@example.com");
    expect(dispute.clientPosition).not.toContain("@example.com");

    await submitDisputePosition(f.executor, { disputeId: dispute.id, position: "Не согласен, наберите +7 701 123 45 67" });
    expect((await db.dispute.findUniqueOrThrow({ where: { id: dispute.id } })).executorPosition).not.toMatch(/701/);
  });

  it("замечание заказчика при доработке — без контактов", async () => {
    const f = await makeDeal({ template: TEMPLATES.single });
    await signContract(f.dealId);
    const [first] = await stagesOf(f.dealId);
    await startStage(f.executor, { stageId: first.id });
    await submitStage(f.executor, { stageId: first.id, report: "Готово", photoIds: [await makeStagePhoto(f.executor)] });

    await requestRework(f.client, { stageId: first.id, note: "Переделайте фасад, детали в WhatsApp +7 701 123 45 67" });

    const [stage] = await stagesOf(f.dealId);
    expect(stage.reworkNote).toContain("Переделайте фасад");
    expect(stage.reworkNote).not.toMatch(/701|WhatsApp/);
    const audit = await db.auditEvent.findFirstOrThrow({ where: { action: "deal.stage.rework", scope: `deal:${f.dealId}` } });
    expect(JSON.stringify(audit.meta)).not.toMatch(/701/);
  });
});
