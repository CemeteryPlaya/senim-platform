import { describe, expect, it } from "vitest";
import { db } from "@/platform/db";
import { runDueJobs } from "@/platform/jobs";
import { makeOperator } from "../../../test/factories";
import { makeDeal, makeStagePhoto, signContract, stagesOf, TEMPLATES } from "../../../test/factories/deal";
import {
  acceptStage,
  confirmStagePayment,
  getDealView,
  jobHandlers,
  markStagePaid,
  openDispute,
  requestRework,
  resolveDispute,
  startStage,
  submitStage,
} from "./index";

/** Сделка с одним этапом, этап сдан. */
async function submittedStage() {
  const f = await makeDeal({ template: TEMPLATES.single });
  await signContract(f.dealId);
  const [stage] = await stagesOf(f.dealId);
  await startStage(f.executor, { stageId: stage.id });
  await submitStage(f.executor, { stageId: stage.id, report: "Всё готово", photoIds: [await makeStagePhoto(f.executor)] });
  return { ...f, stageId: stage.id };
}

/** «Прошло AUTO_ACCEPT_DAYS дней»: сдвигаем срок этапа и задачи в прошлое. */
async function timePasses(stageId: string) {
  const past = new Date(Date.now() - 1000);
  await db.stage.update({ where: { id: stageId }, data: { autoAcceptAt: past } });
  await db.job.updateMany({ where: { kind: "deal-core.autoAcceptStage" }, data: { runAt: past } });
}

describe("автоприёмка этапа (задача deal-core.autoAcceptStage)", () => {
  it("сдача ставит одну задачу на срок автоприёмки", async () => {
    const f = await submittedStage();
    const stage = await db.stage.findUniqueOrThrow({ where: { id: f.stageId } });
    const jobs = await db.job.findMany({ where: { kind: "deal-core.autoAcceptStage" } });
    expect(jobs).toHaveLength(1);
    expect(jobs[0].runAt).toEqual(stage.autoAcceptAt);
    expect(jobs[0].dedupeKey).toBe(`auto-accept:${f.stageId}:${stage.submittedAt!.getTime()}`);
    expect(stage.autoAcceptAt!.getTime() - stage.submittedAt!.getTime()).toBe(5 * 24 * 3600 * 1000);
  });

  it("до срока ничего не происходит", async () => {
    const f = await submittedStage();
    // К запуску могут быть готовы только задачи SMS о сдаче этапа; автоприёмка ждёт срока.
    await runDueJobs(jobHandlers);
    expect(await db.job.findFirstOrThrow({ where: { kind: "deal-core.autoAcceptStage" } })).toMatchObject({ status: "PENDING", attempts: 0 });
    expect((await stagesOf(f.dealId))[0].status).toBe("SUBMITTED");
  });

  it("после срока этап принимается системой, создаётся акт; повторный запуск ничего не дублирует", async () => {
    const f = await submittedStage();
    await timePasses(f.stageId);
    expect(await runDueJobs(jobHandlers)).toMatchObject({ done: 1 });

    const [stage] = await stagesOf(f.dealId);
    expect(stage).toMatchObject({ status: "ACCEPTED", acceptedBy: "system:auto-accept", autoAcceptAt: null });
    expect(await db.document.count({ where: { stageId: f.stageId, kind: "STAGE_ACT" } })).toBe(1);

    // Повтор той же задачи (например, после сбоя) — без второго акта и второго события
    await db.job.updateMany({ data: { status: "PENDING", runAt: new Date(0) } });
    expect(await runDueJobs(jobHandlers)).toMatchObject({ done: 1 });
    expect(await db.document.count({ where: { stageId: f.stageId, kind: "STAGE_ACT" } })).toBe(1);
    expect(await db.auditEvent.count({ where: { action: "deal.stage.auto_accepted" } })).toBe(1);
  });

  it("задача от прошлой сдачи не принимает этап, сданный заново после доработки", async () => {
    const f = await submittedStage();
    await requestRework(f.client, { stageId: f.stageId, note: "Поправить дверцу" });
    await submitStage(f.executor, { stageId: f.stageId, report: "Исправлено", photoIds: [await makeStagePhoto(f.executor)] });
    expect(await db.job.count({ where: { kind: "deal-core.autoAcceptStage" } })).toBe(2);

    // Наступил срок только старой задачи
    const [oldJob] = await db.job.findMany({ where: { kind: "deal-core.autoAcceptStage" }, orderBy: { createdAt: "asc" } });
    await db.job.update({ where: { id: oldJob.id }, data: { runAt: new Date(0) } });
    await runDueJobs(jobHandlers);
    expect((await stagesOf(f.dealId))[0].status).toBe("SUBMITTED");
  });

  it("открытый спор приостанавливает автоприёмку", async () => {
    const f = await submittedStage();
    await openDispute(f.client, { dealId: f.dealId, reason: "QUALITY", description: "Царапины на фасаде" });
    await timePasses(f.stageId);
    await runDueJobs(jobHandlers);
    expect((await stagesOf(f.dealId))[0].status).toBe("SUBMITTED");
  });

  it("спор сбрасывает срок, а решение «продолжить» ставит автоприёмку заново — от момента решения", async () => {
    // Сделка с авансом: первый этап принят (не закрыт), второй сдан.
    const f = await makeDeal();
    await signContract(f.dealId);
    const [advance, work] = await stagesOf(f.dealId);
    await markStagePaid(f.client, { stageId: advance.id });
    await confirmStagePayment(f.executor, { stageId: advance.id });
    await startStage(f.executor, { stageId: advance.id });
    await submitStage(f.executor, { stageId: advance.id, report: "Материалы закуплены", photoIds: [await makeStagePhoto(f.executor)] });
    await acceptStage(f.client, { stageId: advance.id });
    await startStage(f.executor, { stageId: work.id });
    await submitStage(f.executor, { stageId: work.id, report: "Корпус собран", photoIds: [await makeStagePhoto(f.executor)] });
    const { submittedAt } = await db.stage.findUniqueOrThrow({ where: { id: work.id } });

    const { disputeId } = await openDispute(f.client, { dealId: f.dealId, reason: "PAYMENT", description: "Спор об оплате первого этапа" });
    expect((await db.stage.findUniqueOrThrow({ where: { id: work.id } })).autoAcceptAt).toBeNull();
    // Спор, открытый до исправления выбора этапа, указывает на принятый первый этап — сданный второй остаётся SUBMITTED.
    await db.dispute.update({ where: { id: disputeId }, data: { stageId: advance.id } });
    await resolveDispute(await makeOperator(), { disputeId, decision: "FAVOR_EXECUTOR", rationale: "Оплата подтверждена выпиской" });

    const { resolvedAt } = await db.dispute.findUniqueOrThrow({ where: { id: disputeId } });
    const stage = await db.stage.findUniqueOrThrow({ where: { id: work.id } });
    expect(stage).toMatchObject({ status: "SUBMITTED", submittedAt });
    expect(stage.autoAcceptAt!.getTime() - resolvedAt!.getTime()).toBe(5 * 24 * 3600 * 1000);
    const resumed = await db.job.findFirstOrThrow({
      where: { kind: "deal-core.autoAcceptStage", dedupeKey: `auto-accept:${work.id}:${submittedAt!.getTime()}:resumed:${resolvedAt!.getTime()}` },
    });
    expect(resumed.runAt).toEqual(stage.autoAcceptAt);

    await timePasses(work.id);
    await runDueJobs(jobHandlers);
    expect((await stagesOf(f.dealId))[1]).toMatchObject({ status: "ACCEPTED", acceptedBy: "system:auto-accept" });
  });

  it("экран не показывает прошедший срок автоприёмки", async () => {
    const f = await submittedStage();
    expect((await getDealView(f.client, f.dealId)).stages[0].autoAcceptAt).toBeInstanceOf(Date);
    await db.stage.update({ where: { id: f.stageId }, data: { autoAcceptAt: new Date(Date.now() - 60_000) } });
    expect((await getDealView(f.client, f.dealId)).stages[0].autoAcceptAt).toBeNull();
  });
});
