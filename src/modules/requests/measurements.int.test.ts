import { describe, expect, it } from "vitest";
import { db } from "@/platform/db";
import { logger } from "@/platform/logger";
import { makeClient, makeExecutor } from "../../../test/factories";
import { inDays, makeChosen, makeMeasured, makeMeasuring, makeOpenRequest, offerInput } from "../../../test/factories/requests";
import {
  agreeToContract,
  completeMeasurement,
  getIncomingRequest,
  jobHandlers,
  listMyMeasurements,
  measurementNoDeal,
  onContractSigned,
  scheduleMeasurement,
  sendOffer,
} from "./index";

const code = (code: string) => expect.objectContaining({ code });
const statusOf = async (requestId: string) => (await db.request.findUniqueOrThrow({ where: { id: requestId } })).status;

describe("назначение замера OFFER_CHOSEN → MEASURING", () => {
  it("назначает исполнитель выбранного отклика; заказчик получает уведомление", async () => {
    const client = await makeClient();
    const { requestId, executor, offerId } = await makeChosen(client);

    const { measurementId } = await scheduleMeasurement(executor, { offerId, scheduledAt: inDays(2) });

    expect(await statusOf(requestId)).toBe("MEASURING");
    expect((await db.measurement.findUniqueOrThrow({ where: { id: measurementId } })).status).toBe("SCHEDULED");
    expect(await db.notification.findFirst({ where: { userId: client.id, kind: "measurement.scheduled" } })).not.toBeNull();
    expect((await listMyMeasurements(executor)).map((m) => m.id)).toEqual([measurementId]);
  });

  it("чужой исполнитель, прошлое время и повтор — отказ", async () => {
    const client = await makeClient();
    const { executor, offerId } = await makeChosen(client);
    const stranger = await makeExecutor({ segment: "COMFORT" });

    await expect(scheduleMeasurement(stranger, { offerId, scheduledAt: inDays(2) })).rejects.toThrow(code("NOT_FOUND"));
    await expect(scheduleMeasurement(executor, { offerId, scheduledAt: inDays(-1) })).rejects.toThrow(code("VALIDATION"));
    await scheduleMeasurement(executor, { offerId, scheduledAt: inDays(2) });
    await expect(scheduleMeasurement(executor, { offerId, scheduledAt: inDays(3) })).rejects.toThrow(code("CONFLICT"));
  });

  it("до выбора отклика замер не назначается", async () => {
    const client = await makeClient();
    const requestId = await makeOpenRequest(client);
    const executor = await makeExecutor({ segment: "COMFORT" });
    const { offerId } = await sendOffer(executor, offerInput(requestId));
    await expect(scheduleMeasurement(executor, { offerId, scheduledAt: inDays(2) })).rejects.toThrow(code("CONFLICT"));
  });
});

describe("напоминание о замере", () => {
  const remind = (measurementId: string) =>
    jobHandlers["requests.measurementReminder"]({ measurementId }, { jobId: "j", attempt: 1, log: logger });

  it("ставится за сутки до выезда и приходит обеим сторонам с SMS", async () => {
    const client = await makeClient();
    const { executor, offerId } = await makeChosen(client);
    const at = inDays(2);
    const { measurementId } = await scheduleMeasurement(executor, { offerId, scheduledAt: at });

    const job = await db.job.findFirstOrThrow({ where: { kind: "requests.measurementReminder" } });
    expect(job.runAt.getTime()).toBe(at.getTime() - 24 * 60 * 60 * 1000);

    await remind(measurementId);
    const notes = await db.notification.findMany({ where: { kind: "measurement.reminder" }, orderBy: { userId: "asc" } });
    expect(notes.map((n) => n.userId).sort()).toEqual([client.id, executor.id].sort());
    expect(await db.job.count({ where: { kind: "notifications.sendSms", dedupeKey: { in: notes.map((n) => `sms:${n.id}`) } } })).toBe(2);
  });

  it("выполненный замер не напоминается", async () => {
    const client = await makeClient();
    const m = await makeMeasuring(client);
    await completeMeasurement(m.executor, { measurementId: m.measurementId, finalPrice: 650_000, result: "" });

    await remind(m.measurementId);
    expect(await db.notification.count({ where: { kind: "measurement.reminder" } })).toBe(0);
  });
});

describe("результат замера", () => {
  it("SCHEDULED → DONE с итоговой ценой", async () => {
    const client = await makeClient();
    const m = await makeMeasuring(client);

    await completeMeasurement(m.executor, { measurementId: m.measurementId, finalPrice: 650_000, result: "Ниша 3 м" });

    expect(await db.measurement.findUniqueOrThrow({ where: { id: m.measurementId } })).toMatchObject({
      status: "DONE",
      finalPrice: 650_000,
      doneAt: expect.any(Date),
    });
    expect(await statusOf(m.requestId)).toBe("MEASURING");
    await expect(completeMeasurement(m.executor, { measurementId: m.measurementId, finalPrice: 1, result: "" })).rejects.toThrow(
      code("CONFLICT"),
    );
    await expect(completeMeasurement(client, { measurementId: m.measurementId, finalPrice: 1, result: "" })).rejects.toThrow(
      code("FORBIDDEN"),
    );
  });

  it("замер без сделки: NO_DEAL, плата за выезд только записью, отклик DECLINED, заявка снова OPEN", async () => {
    const client = await makeClient();
    const m = await makeMeasured(client);

    await measurementNoDeal(client, { measurementId: m.measurementId, result: "Дорого" });

    expect(await db.measurement.findUniqueOrThrow({ where: { id: m.measurementId } })).toMatchObject({ status: "NO_DEAL", feeAccrued: 10_000 });
    expect((await db.offer.findUniqueOrThrow({ where: { id: m.offerId } })).status).toBe("DECLINED");
    expect(await statusOf(m.requestId)).toBe("OPEN");
    expect(await db.notification.findFirst({ where: { userId: m.executor.id, kind: "measurement.no_deal" } })).not.toBeNull();
    // Новые исполнители снова могут откликнуться.
    const fresh = await makeExecutor({ segment: "COMFORT" });
    await expect(sendOffer(fresh, offerInput(m.requestId))).resolves.toMatchObject({ offerId: expect.any(String) });
  });

  it("исполнитель тоже может зафиксировать отказ на выезде; бесплатный замер платы не начисляет", async () => {
    const client = await makeClient();
    const m = await makeMeasuring(client, "FREE");
    await measurementNoDeal(m.executor, { measurementId: m.measurementId, result: "Заказчик передумал" });
    expect(await db.measurement.findUniqueOrThrow({ where: { id: m.measurementId } })).toMatchObject({ status: "NO_DEAL", feeAccrued: null });
    await expect(measurementNoDeal(client, { measurementId: m.measurementId, result: "" })).rejects.toThrow(code("CONFLICT"));
  });

  it("чужие участники замер не меняют (IDOR)", async () => {
    const m = await makeMeasuring(await makeClient());
    await expect(measurementNoDeal(await makeClient(), { measurementId: m.measurementId, result: "" })).rejects.toThrow(code("NOT_FOUND"));
    await expect(
      completeMeasurement(await makeExecutor({ segment: "COMFORT" }), { measurementId: m.measurementId, finalPrice: 1, result: "" }),
    ).rejects.toThrow(code("NOT_FOUND"));
  });
});

describe("согласие с договором MEASURING → CONTRACTING → CLOSED", () => {
  it("создаёт сделку по итоговой цене и шаблону этапов", async () => {
    const client = await makeClient();
    const m = await makeMeasured(client, 600_001);

    const { dealId } = await agreeToContract(client, { requestId: m.requestId, template: "advance-50" });

    expect(await statusOf(m.requestId)).toBe("CONTRACTING");
    const deal = await db.deal.findUniqueOrThrow({ where: { id: dealId }, include: { stages: true } });
    expect(deal).toMatchObject({ totalAmount: 600_001, offerId: m.offerId, clientId: client.id, executorId: m.executor.executor.id, stageTemplate: "advance-50" });
    expect(deal.stages.reduce((s, st) => s + st.amount, 0)).toBe(600_001);
    expect(await db.notification.findFirst({ where: { userId: m.executor.id, kind: "request.contracting" } })).not.toBeNull();

    await onContractSigned(db, m.requestId);
    expect(await statusOf(m.requestId)).toBe("CLOSED");
    await expect(onContractSigned(db, m.requestId)).rejects.toThrow(code("CONFLICT"));
  });

  it("до результата замера согласиться нельзя", async () => {
    const client = await makeClient();
    const m = await makeMeasuring(client);
    await expect(agreeToContract(client, { requestId: m.requestId, template: "advance-50" })).rejects.toThrow(code("CONFLICT"));
  });

  it("двойной клик даёт одну сделку", async () => {
    const client = await makeClient();
    const m = await makeMeasured(client);
    const results = await Promise.allSettled([
      agreeToContract(client, { requestId: m.requestId, template: "no-prepayment" }),
      agreeToContract(client, { requestId: m.requestId, template: "no-prepayment" }),
    ]);
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    expect(await db.deal.count({ where: { requestId: m.requestId } })).toBe(1);
  });

  it("соглашается только заказчик-владелец", async () => {
    const client = await makeClient();
    const m = await makeMeasured(client);
    await expect(agreeToContract(await makeClient(), { requestId: m.requestId, template: "advance-50" })).rejects.toThrow(code("NOT_FOUND"));
    await expect(agreeToContract(m.executor, { requestId: m.requestId, template: "advance-50" })).rejects.toThrow(code("FORBIDDEN"));
  });

  it("исполнитель видит адрес и итоговую цену в своей заявке", async () => {
    const client = await makeClient();
    const m = await makeMeasured(client, 620_000);
    expect(await getIncomingRequest(m.executor, m.requestId)).toMatchObject({
      address: "ул. Тестовая, 1, кв. 2",
      myOffer: { status: "ACCEPTED", measurement: { status: "DONE", finalPrice: 620_000 } },
    });
  });
});
