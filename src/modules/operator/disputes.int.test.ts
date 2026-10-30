import { describe, expect, it } from "vitest";
import { recordAudit, SYSTEM } from "@/modules/audit";
import { db } from "@/platform/db";
import { makeOperator } from "../../../test/factories";
import { makeDispute } from "../../../test/factories/operator";
import { getDisputeCard, listDisputes, resolveDispute } from "./disputes";

describe("споры", () => {
  it("очередь: сначала открытые", async () => {
    const operator = await makeOperator();
    const first = await makeDispute();
    const second = await makeDispute();
    await db.dispute.update({ where: { id: first.dispute.id }, data: { status: "RESOLVED", decision: "FAVOR_CLIENT", resolvedAt: new Date() } });

    const list = await listDisputes(operator);

    expect(list.map((d) => d.id)).toEqual([second.dispute.id, first.dispute.id]);
    expect(list[0]).toMatchObject({ status: "OPEN", reason: "QUALITY", deal: { number: second.deal.number } });
  });

  it("карточка содержит позиции сторон, этапы и историю сделки", async () => {
    const operator = await makeOperator();
    const { dispute, deal } = await makeDispute();
    await recordAudit(db, { actor: SYSTEM("test"), action: "dispute.opened", entity: { type: "dispute", id: dispute.id }, scope: `deal:${deal.id}` });

    const card = await getDisputeCard(operator, dispute.id);

    expect(card).toMatchObject({
      clientPosition: "Нужна замена фасадов",
      executorPosition: expect.any(String),
      stage: { title: "Этап 1" },
      deal: { number: deal.number, stages: [{ title: "Этап 1", payment: { status: "DUE" } }] },
    });
    expect(card.history.map((e) => e.action)).toEqual(["dispute.opened"]);
  });

  it("в пользу исполнителя: этап принят, сделка снова в работе, аудит и уведомления обеим сторонам", async () => {
    const operator = await makeOperator();
    const { dispute, deal, client, executor } = await makeDispute();

    await resolveDispute(operator, { disputeId: dispute.id, decision: "FAVOR_EXECUTOR", rationale: "Царапины от монтажа техники" });

    expect(await db.dispute.findUniqueOrThrow({ where: { id: dispute.id } })).toMatchObject({
      status: "RESOLVED",
      decision: "FAVOR_EXECUTOR",
      rationale: "Царапины от монтажа техники",
      resolvedById: operator.id,
    });
    expect((await db.deal.findUniqueOrThrow({ where: { id: deal.id } })).status).toBe("IN_PROGRESS");
    expect((await db.stage.findUniqueOrThrow({ where: { id: deal.stages[0].id } })).status).toBe("ACCEPTED");
    expect(await db.auditEvent.findFirstOrThrow({ where: { action: "dispute.resolved" } })).toMatchObject({ scope: `deal:${deal.id}`, actorId: operator.id });
    expect(await db.notification.count({ where: { userId: { in: [client.id, executor.id] } } })).toBe(2);
  });

  it("в пользу заказчика: этап на доработку; расторжение: сделка расторгнута", async () => {
    const operator = await makeOperator();
    const a = await makeDispute();
    const b = await makeDispute();

    await resolveDispute(operator, { disputeId: a.dispute.id, decision: "FAVOR_CLIENT", rationale: "Фото подтверждают дефект" });
    await resolveDispute(operator, { disputeId: b.dispute.id, decision: "TERMINATE", rationale: "Стороны не договорились" });

    expect((await db.stage.findUniqueOrThrow({ where: { id: a.deal.stages[0].id } })).status).toBe("REWORK");
    expect((await db.deal.findUniqueOrThrow({ where: { id: b.deal.id } })).status).toBe("TERMINATED");
  });

  it("частичное решение не больше суммы сделки", async () => {
    const operator = await makeOperator();
    const { dispute, deal } = await makeDispute();
    await expect(
      resolveDispute(operator, { disputeId: dispute.id, decision: "PARTIAL", decisionAmount: deal.totalAmount + 1, rationale: "Половина работы" }),
    ).rejects.toMatchObject({ code: "VALIDATION" });
  });

  it("двойное решение даёт ровно один успех", async () => {
    const operator = await makeOperator();
    const { dispute } = await makeDispute();
    const resolve = () => resolveDispute(operator, { disputeId: dispute.id, decision: "FAVOR_CLIENT", rationale: "Фото подтверждают дефект" });

    const results = await Promise.allSettled([resolve(), resolve()]);

    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    expect(await db.auditEvent.count({ where: { action: "dispute.resolved" } })).toBe(1);
  });
});
