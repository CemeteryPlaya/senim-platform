import { describe, expect, it } from "vitest";
import { openDispute } from "@/modules/deal-core";
import { computeSplit } from "@/modules/payments";
import { db } from "@/platform/db";
import { makeOperator } from "../../../test/factories";
import { dealAt, dealOf, journalOf, PRICE } from "../../../test/factories/deal";
import { makeDispute } from "../../../test/factories/operator";
import { getDisputeCard, listDisputes, previewDisputeSplit, resolveDispute } from "./disputes";

describe("споры", () => {
  it("открытие спора: другой стороне — важное уведомление с SMS, операторам — в панели, со ссылкой на спор", async () => {
    const operator = await makeOperator();
    const blocked = await makeOperator();
    await db.user.update({ where: { id: blocked.id }, data: { blockedAt: new Date() } });
    const f = await dealAt("PAID_HOLD");

    const { disputeId } = await openDispute(f.client, { dealId: f.dealId, reason: "QUALITY", description: "Фасад с царапинами" });

    const party = await db.notification.findFirstOrThrow({ where: { userId: f.executor.id, kind: "dispute.opened" } });
    expect(await db.job.count({ where: { kind: "notifications.sendSms", dedupeKey: `sms:${party.id}` } })).toBe(1);
    const forOperators = await db.notification.findMany({ where: { kind: "dispute.opened", userId: { in: [operator.id, blocked.id] } } });
    expect(forOperators).toEqual([expect.objectContaining({ userId: operator.id, link: `/operator/disputes/${disputeId}` })]);
  });

  it("очередь: сначала открытые", async () => {
    const operator = await makeOperator();
    const first = await makeDispute();
    const second = await makeDispute();
    await resolveDispute(operator, { disputeId: first.disputeId, outcome: "CONTINUE", rationale: "Дефект устранён на месте" });

    const list = await listDisputes(operator);

    expect(list.map((d) => d.id)).toEqual([second.disputeId, first.disputeId]);
    expect(list[0]).toMatchObject({ status: "OPEN", reason: "QUALITY", openedInStatus: "IN_PROGRESS", deal: { id: second.dealId, priceTiyn: PRICE } });
    expect(list[1]).toMatchObject({ status: "RESOLVED", outcome: "CONTINUE" });
  });

  it("карточка: позиции сторон, этап при открытии, деньги заморожены по журналу, история сделки", async () => {
    const operator = await makeOperator();
    const f = await makeDispute();

    const card = await getDisputeCard(operator, f.disputeId);

    expect(card).toMatchObject({
      clientPosition: "Нужна замена фасадов",
      executorPosition: "Царапины появились при монтаже техники",
      openedInStatus: "IN_PROGRESS",
      deal: { id: f.dealId, priceTiyn: PRICE },
      money: { kind: "frozen" },
      aiHintEnabled: false,
    });
    expect(card.moneyHistory.map((h) => h.type)).toEqual(expect.arrayContaining(["HOLD", "FREEZE"]));
    expect(card.history.map((e) => e.action)).toEqual(expect.arrayContaining(["dispute.opened"]));
  });

  it("продолжить работу: заморозка снята, сделка снова в работе, аудит и уведомления обеим сторонам", async () => {
    const operator = await makeOperator();
    const f = await makeDispute();

    await resolveDispute(operator, { disputeId: f.disputeId, outcome: "CONTINUE", rationale: "Царапины от монтажа техники" });

    expect(await db.dispute.findUniqueOrThrow({ where: { id: f.disputeId } })).toMatchObject({
      status: "RESOLVED",
      outcome: "CONTINUE",
      rationale: "Царапины от монтажа техники",
      resolvedById: operator.id,
    });
    expect(await dealOf(f.dealId)).toMatchObject({ status: "IN_PROGRESS" });
    expect((await journalOf(f.dealId)).map((t) => t.type)).toContain("UNFREEZE");
    expect(await db.auditEvent.findFirstOrThrow({ where: { action: "dispute.resolved" } })).toMatchObject({ scope: `deal:${f.dealId}`, actorId: operator.id });
    expect(await db.notification.count({ where: { kind: "dispute.resolved", userId: { in: [f.client.id, f.executor.id] } } })).toBe(2);
  });

  it("полный возврат: деньги возвращаются покупателю целиком", async () => {
    const operator = await makeOperator();
    const f = await makeDispute();

    await resolveDispute(operator, { disputeId: f.disputeId, outcome: "FULL_REFUND", rationale: "Работа не соответствует оферте" });

    expect(await dealOf(f.dealId)).toMatchObject({ status: "REFUNDED" });
  });

  it("частичный раздел: расчёт заранее совпадает с операциями журнала после решения", async () => {
    const operator = await makeOperator();
    const f = await makeDispute();

    const preview = await previewDisputeSplit(operator, { disputeId: f.disputeId, masterShareKzt: 60_000 });
    expect(preview).toEqual({ ...computeSplit(PRICE, 60_000_00n), shareTiyn: 60_000_00n });
    expect(preview.masterTiyn + preview.platformTiyn + preview.refundTiyn).toBe((await dealOf(f.dealId)).buyerTotalTiyn);

    await resolveDispute(operator, { disputeId: f.disputeId, outcome: "PARTIAL_SPLIT", masterShareTiyn: preview.shareTiyn, rationale: "Сделана половина работы" });

    const journal = await journalOf(f.dealId);
    const amount = (type: string) => journal.find((t) => t.type === type)?.amountTiyn;
    expect([amount("SPLIT_MASTER"), amount("SPLIT_PLATFORM"), amount("REFUND")]).toEqual([preview.masterTiyn, preview.platformTiyn, preview.refundTiyn]);
    expect(await dealOf(f.dealId)).toMatchObject({ status: "SPLIT_PAYOUT" });
  });

  it("сумма мастеру больше цены — ошибка поля, ничего не меняется", async () => {
    const operator = await makeOperator();
    const f = await makeDispute();
    await expect(previewDisputeSplit(operator, { disputeId: f.disputeId, masterShareKzt: Number(PRICE / 100n) + 1 })).rejects.toMatchObject({
      code: "VALIDATION",
      details: { fieldErrors: { masterShareKzt: [expect.any(String)] } },
    });
    await expect(
      resolveDispute(operator, { disputeId: f.disputeId, outcome: "PARTIAL_SPLIT", masterShareTiyn: PRICE + 1n, rationale: "Сделана половина работы" }),
    ).rejects.toMatchObject({ code: "VALIDATION" });
    expect(await db.dispute.findUniqueOrThrow({ where: { id: f.disputeId } })).toMatchObject({ status: "OPEN" });
  });

  it("двойное решение даёт ровно один успех", async () => {
    const operator = await makeOperator();
    const f = await makeDispute();
    const resolve = () => resolveDispute(operator, { disputeId: f.disputeId, outcome: "CONTINUE", rationale: "Фото не подтверждают дефект" });

    const results = await Promise.allSettled([resolve(), resolve()]);

    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    expect(await db.auditEvent.count({ where: { action: "dispute.resolved" } })).toBe(1);
  });
});
