import { describe, expect, it } from "vitest";
import { db } from "@/platform/db";
import { makeClient, makeOperator } from "../../../test/factories";
import { dealOf, makeDeal, makeStagePhoto, signAct, signContract, stagesOf, TEMPLATES } from "../../../test/factories/deal";
import {
  acceptStage,
  confirmStagePayment,
  markStagePaid,
  openDispute,
  resolveDispute,
  startStage,
  submitDisputePosition,
  submitStage,
} from "./index";

const code = (p: Promise<unknown>) => p.then(() => "OK", (e: { code?: string }) => e.code ?? String(e));

/** Manual-сделка с одним этапом: этап сдан, заказчик открыл спор. */
async function disputed() {
  const f = await makeDeal({ template: TEMPLATES.single });
  await signContract(f.dealId);
  const [stage] = await stagesOf(f.dealId);
  await startStage(f.executor, { stageId: stage.id });
  await submitStage(f.executor, { stageId: stage.id, report: "Готово", photoIds: [await makeStagePhoto(f.executor)] });
  const { disputeId } = await openDispute(f.client, { dealId: f.dealId, reason: "QUALITY", description: "Фасад с царапинами" });
  return { ...f, stageId: stage.id, disputeId, operator: await makeOperator() };
}

describe("спор", () => {
  it("открывается стороной, хранится структурированно и останавливает действия по этапам", async () => {
    const f = await disputed();
    expect(await dealOf(f.dealId)).toMatchObject({ status: "DISPUTE" });
    expect(await db.dispute.findUniqueOrThrow({ where: { id: f.disputeId } })).toMatchObject({
      status: "OPEN",
      reason: "QUALITY",
      stageId: f.stageId,
      clientPosition: "Фасад с царапинами",
      executorPosition: null,
    });
    expect(await code(acceptStage(f.client, { stageId: f.stageId }))).toBe("CONFLICT");

    await submitDisputePosition(f.executor, { disputeId: f.disputeId, position: "Царапины от доставки другой фирмы" });
    expect((await db.dispute.findUniqueOrThrow({ where: { id: f.disputeId } })).executorPosition).toMatch(/доставки/);
    expect(await code(submitDisputePosition(await makeClient(), { disputeId: f.disputeId, position: "Я тоже хочу сказать" }))).toBe("NOT_FOUND");
  });

  it("в пользу исполнителя: этап принят, создан акт, сделка продолжается", async () => {
    const f = await disputed();
    await resolveDispute(f.operator, { disputeId: f.disputeId, decision: "FAVOR_EXECUTOR", rationale: "Фото подтверждают качество" });
    expect(await dealOf(f.dealId)).toMatchObject({ status: "IN_PROGRESS" });
    expect((await stagesOf(f.dealId))[0]).toMatchObject({ status: "ACCEPTED", acceptedBy: f.operator.id });
    expect(await db.document.count({ where: { stageId: f.stageId, kind: "STAGE_ACT" } })).toBe(1);
    expect(await db.dispute.findUniqueOrThrow({ where: { id: f.disputeId } })).toMatchObject({
      status: "RESOLVED",
      decision: "FAVOR_EXECUTOR",
      resolvedById: f.operator.id,
    });
  });

  it("все этапы закрылись во время спора — после решения сделка завершается", async () => {
    const f = await makeDeal({ template: TEMPLATES.single });
    await signContract(f.dealId);
    const [stage] = await stagesOf(f.dealId);
    await startStage(f.executor, { stageId: stage.id });
    await submitStage(f.executor, { stageId: stage.id, report: "Готово", photoIds: [await makeStagePhoto(f.executor)] });
    await acceptStage(f.client, { stageId: stage.id });
    const { disputeId } = await openDispute(f.client, { dealId: f.dealId, reason: "PAYMENT", description: "Спор об оплате" });
    // Во время спора стороны договорились: оплата отмечена и подтверждена, акт подписан.
    await markStagePaid(f.client, { stageId: stage.id });
    await confirmStagePayment(f.executor, { stageId: stage.id });
    await signAct(stage.id);
    expect((await stagesOf(f.dealId))[0].status).toBe("CLOSED");

    await resolveDispute(await makeOperator(), { disputeId, decision: "FAVOR_EXECUTOR", rationale: "Стороны договорились" });
    expect(await dealOf(f.dealId)).toMatchObject({ status: "COMPLETED" });
  });

  it("в пользу заказчика: этап на доработку с обоснованием", async () => {
    const f = await disputed();
    await resolveDispute(f.operator, { disputeId: f.disputeId, decision: "FAVOR_CLIENT", rationale: "Заменить фасад за счёт исполнителя" });
    expect(await dealOf(f.dealId)).toMatchObject({ status: "IN_PROGRESS" });
    expect((await stagesOf(f.dealId))[0]).toMatchObject({ status: "REWORK", reworkNote: "Заменить фасад за счёт исполнителя" });
  });

  it("расторжение и частичное решение закрывают сделку", async () => {
    const f = await disputed();
    await resolveDispute(f.operator, { disputeId: f.disputeId, decision: "TERMINATE", rationale: "Стороны не договорились" });
    expect(await dealOf(f.dealId)).toMatchObject({ status: "TERMINATED" });

    const g = await disputed();
    expect(await code(resolveDispute(g.operator, { disputeId: g.disputeId, decision: "PARTIAL", rationale: "Половина работы выполнена" }))).toBe(
      "VALIDATION",
    );
    expect(
      await code(resolveDispute(g.operator, { disputeId: g.disputeId, decision: "PARTIAL", decisionAmount: 10_000_000, rationale: "Слишком много денег" })),
    ).toBe("VALIDATION");
    await resolveDispute(g.operator, { disputeId: g.disputeId, decision: "PARTIAL", decisionAmount: 40_000, rationale: "Половина работы выполнена" });
    expect(await db.dispute.findUniqueOrThrow({ where: { id: g.disputeId } })).toMatchObject({ decision: "PARTIAL", decisionAmount: 40_000 });
    expect(await dealOf(g.dealId)).toMatchObject({ status: "TERMINATED" });
  });

  it("решает только оператор; двойной клик оператора — одно решение", async () => {
    const f = await disputed();
    expect(await code(resolveDispute(f.client, { disputeId: f.disputeId, decision: "FAVOR_CLIENT", rationale: "Решаю сам за себя" }))).toBe("FORBIDDEN");

    const input = { disputeId: f.disputeId, decision: "FAVOR_EXECUTOR" as const, rationale: "Фото подтверждают качество" };
    const results = await Promise.allSettled([resolveDispute(f.operator, input), resolveDispute(f.operator, input)]);
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    expect(await db.document.count({ where: { stageId: f.stageId, kind: "STAGE_ACT" } })).toBe(1);
    expect(await db.auditEvent.count({ where: { action: "dispute.resolved" } })).toBe(1);
  });
});

/** Manual-сделка с авансом: первый этап принят (акт ещё не подписан — этап не закрыт), второй — не начат. */
async function firstAccepted() {
  const f = await makeDeal();
  await signContract(f.dealId);
  const [advance, work] = await stagesOf(f.dealId);
  await markStagePaid(f.client, { stageId: advance.id });
  await confirmStagePayment(f.executor, { stageId: advance.id });
  await startStage(f.executor, { stageId: advance.id });
  await submitStage(f.executor, { stageId: advance.id, report: "Материалы закуплены", photoIds: [await makeStagePhoto(f.executor)] });
  await acceptStage(f.client, { stageId: advance.id });
  return { ...f, advance, work, operator: await makeOperator() };
}

const disputeOf = (id: string) => db.dispute.findUniqueOrThrow({ where: { id } });

describe("спор — о том этапе, где идёт работа", () => {
  it("сданный этап важнее принятого раньше: спор о нём, решение двигает его", async () => {
    const f = await firstAccepted();
    await startStage(f.executor, { stageId: f.work.id });
    await submitStage(f.executor, { stageId: f.work.id, report: "Корпус собран", photoIds: [await makeStagePhoto(f.executor)] });
    const { disputeId } = await openDispute(f.client, { dealId: f.dealId, reason: "QUALITY", description: "Корпус собран криво" });
    expect(await disputeOf(disputeId)).toMatchObject({ stageId: f.work.id });

    await resolveDispute(f.operator, { disputeId, decision: "FAVOR_EXECUTOR", rationale: "Фото подтверждают качество" });
    expect((await stagesOf(f.dealId)).map((s) => s.status)).toEqual(["ACCEPTED", "ACCEPTED", "PENDING"]);
  });

  it("этап в работе: спор о нём, а не о принятом раньше", async () => {
    const f = await firstAccepted();
    await startStage(f.executor, { stageId: f.work.id });
    const { disputeId } = await openDispute(f.client, { dealId: f.dealId, reason: "DEADLINE", description: "Сроки сорваны на неделю" });
    expect(await disputeOf(disputeId)).toMatchObject({ stageId: f.work.id });

    await resolveDispute(f.operator, { disputeId, decision: "FAVOR_CLIENT", rationale: "Ускорить работу и сдать за неделю" });
    expect((await stagesOf(f.dealId))[1]).toMatchObject({ status: "REWORK" });
  });

  it("решение, неприменимое к этапу спора, — CONFLICT, спор остаётся открытым", async () => {
    const f = await firstAccepted();
    const { disputeId } = await openDispute(f.client, { dealId: f.dealId, reason: "QUALITY", description: "Материалы не те, что в договоре" });
    expect(await disputeOf(disputeId)).toMatchObject({ stageId: f.advance.id });

    await expect(
      resolveDispute(f.operator, { disputeId, decision: "FAVOR_CLIENT", rationale: "Вернуть этап на доработку" }),
    ).rejects.toMatchObject({ code: "CONFLICT", message: expect.stringMatching(/уже принят/) });
    expect(await disputeOf(disputeId)).toMatchObject({ status: "OPEN" });
    expect(await dealOf(f.dealId)).toMatchObject({ status: "DISPUTE" });

    // В пользу исполнителя принятый этап остаётся принятым — сделка продолжается.
    await resolveDispute(f.operator, { disputeId, decision: "FAVOR_EXECUTOR", rationale: "Материалы соответствуют договору" });
    expect(await dealOf(f.dealId)).toMatchObject({ status: "IN_PROGRESS" });
    expect((await stagesOf(f.dealId))[0]).toMatchObject({ status: "ACCEPTED" });
  });
});
