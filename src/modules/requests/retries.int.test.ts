import { describe, expect, it } from "vitest";
import { db } from "@/platform/db";
import { makeClient, makeOperator } from "../../../test/factories";
import { makeMeasuring, offerInput } from "../../../test/factories/requests";
import { allowOfferRetry, getIncomingRequest, listRetryCandidates, measurementNoDeal, sendOffer } from "./index";

const code = (c: string) => expect.objectContaining({ code: c });
const one = (results: PromiseSettledResult<unknown>[]) => results.filter((r) => r.status === "fulfilled").length;

/** Замер без сделки: отклик исполнителя отклонён, заявка снова открыта. */
async function afterNoDeal() {
  const client = await makeClient();
  const m = await makeMeasuring(client);
  await measurementNoDeal(client, { measurementId: m.measurementId, result: "" });
  return { client, ...m, executorId: m.executor.executor.id };
}

describe("повторный отклик по разрешению оператора (№16)", () => {
  it("без разрешения отклонённый исполнитель не откликается снова", async () => {
    const { executor, requestId } = await afterNoDeal();
    expect((await getIncomingRequest(executor, requestId)).canOffer).toBe(false);
    await expect(sendOffer(executor, offerInput(requestId))).rejects.toThrow(code("CONFLICT"));
  });

  it("оператор снимает блокировку с причиной (в журнал); исполнитель откликается ещё раз — один раз", async () => {
    const { executor, requestId, executorId } = await afterNoDeal();
    const operator = await makeOperator();
    expect(await listRetryCandidates(operator)).toMatchObject([{ requestId, executorId, afterNoDeal: true }]);

    const allowed = await Promise.allSettled([
      allowOfferRetry(operator, { requestId, executorId, reason: "Заказчик просит вернуть исполнителя" }),
      allowOfferRetry(operator, { requestId, executorId, reason: "Заказчик просит вернуть исполнителя" }),
    ]);
    expect(one(allowed)).toBe(1);
    expect(await db.auditEvent.findFirst({ where: { action: "offer.retry_allowed" } })).toMatchObject({
      meta: expect.objectContaining({ reason: "Заказчик просит вернуть исполнителя" }),
    });
    expect(await listRetryCandidates(operator)).toHaveLength(0);
    expect(await getIncomingRequest(executor, requestId)).toMatchObject({ canOffer: true, retryAllowed: true });

    const sent = await Promise.allSettled([sendOffer(executor, offerInput(requestId, 450_000)), sendOffer(executor, offerInput(requestId, 450_000))]);
    expect(one(sent)).toBe(1);
    const offers = await db.offer.findMany({ where: { requestId, executorId }, orderBy: { round: "asc" } });
    expect(offers.map((o) => [o.round, o.status])).toEqual([
      [1, "DECLINED"],
      [2, "SENT"],
    ]);
    expect((await getIncomingRequest(executor, requestId)).myOffer).toMatchObject({ status: "SENT", price: 450_000 });
  });

  it("только оператор и только после отклонённого отклика по открытой заявке", async () => {
    const { client, executor, requestId, executorId } = await afterNoDeal();
    await expect(allowOfferRetry(client, { requestId, executorId, reason: "Сам себе" })).rejects.toThrow(code("FORBIDDEN"));
    await expect(allowOfferRetry(executor, { requestId, executorId, reason: "Сам себе" })).rejects.toThrow(code("FORBIDDEN"));

    const operator = await makeOperator();
    const fresh = await makeMeasuring(await makeClient());
    await expect(allowOfferRetry(operator, { requestId: fresh.requestId, executorId: fresh.executor.executor.id, reason: "Рано" })).rejects.toThrow(
      code("CONFLICT"),
    );
  });
});
