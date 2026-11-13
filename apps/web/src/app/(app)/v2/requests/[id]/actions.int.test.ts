import { beforeEach, describe, expect, it, vi } from "vitest";
import { sendOffer } from "@/modules/requests";
import { db } from "@/platform/db";
import { makeClient, makeExecutor } from "../../../../../../test/factories";
import { freshBrowser } from "../../../../../../test/factories/identity";
import { makeExecutorWithTerms, makeOpenRequest, offerInput } from "../../../../../../test/factories/requests";
import { signInAs } from "../../../../../../test/factories/session";
import { cancelRequestAction, chooseOfferSort } from "./actions";

vi.mock("next/headers", async () => (await import("../../../../../../test/factories/identity")).nextHeadersMock);

beforeEach(() => {
  freshBrowser({ "user-agent": "vitest" });
});

async function openRequestWithOffer() {
  const client = await makeClient();
  const requestId = await makeOpenRequest(client, { segment: "COMFORT" });
  await sendOffer(await makeExecutorWithTerms("COMFORT"), offerInput(requestId));
  return { client, requestId };
}

describe("cancelRequestAction", () => {
  it("отменяет заявку, предложения отклоняются, событие аудита одно", async () => {
    const { client, requestId } = await openRequestWithOffer();
    await signInAs(client);
    expect(await cancelRequestAction({ requestId })).toEqual({ ok: true, data: undefined });
    expect((await db.request.findUniqueOrThrow({ where: { id: requestId } })).status).toBe("CANCELLED");
    expect((await db.offer.findMany({ where: { requestId } })).map((o) => o.status)).toEqual(["DECLINED"]);
    expect(await db.auditEvent.count({ where: { action: "request.cancelled", scope: `request:${requestId}` } })).toBe(1);
  });

  it("двойное нажатие: один эффект, второй вызов — конфликт, а не вторая отмена", async () => {
    const { client, requestId } = await openRequestWithOffer();
    await signInAs(client);
    const results = await Promise.all([cancelRequestAction({ requestId }), cancelRequestAction({ requestId })]);
    expect(results.filter((r) => r.ok)).toHaveLength(1);
    const failed = results.find((r) => !r.ok);
    expect(failed && !failed.ok ? failed.code : null).toBe("CONFLICT");
    expect(await db.auditEvent.count({ where: { action: "request.cancelled", scope: `request:${requestId}` } })).toBe(1);
    // Повтор после отмены — тоже конфликт, состояние то же.
    const again = await cancelRequestAction({ requestId });
    expect(again.ok).toBe(false);
    expect((await db.request.findUniqueOrThrow({ where: { id: requestId } })).status).toBe("CANCELLED");
  });

  it("чужая заявка: не найдена, статус не меняется", async () => {
    const { requestId } = await openRequestWithOffer();
    await signInAs(await makeClient("Нурланов Айдос Ержанович"));
    const result = await cancelRequestAction({ requestId });
    expect(result.ok ? null : result.code).toBe("NOT_FOUND");
    expect((await db.request.findUniqueOrThrow({ where: { id: requestId } })).status).toBe("OPEN");
  });

  it("мастер не может отменить заявку", async () => {
    const { requestId } = await openRequestWithOffer();
    await signInAs(await makeExecutor());
    expect((await cancelRequestAction({ requestId })).ok).toBe(false);
    expect((await db.request.findUniqueOrThrow({ where: { id: requestId } })).status).toBe("OPEN");
  });

  it("плохой вход отклоняет схема, до базы дело не доходит", async () => {
    await signInAs(await makeClient());
    const result = await cancelRequestAction({ requestId: "" });
    expect(result.ok ? null : result.code).toBe("VALIDATION");
  });
});

describe("chooseOfferSort", () => {
  it("ведёт на карточку заявки с сортировкой в адресе", async () => {
    const { client, requestId } = await openRequestWithOffer();
    await signInAs(client);
    await expect(chooseOfferSort(requestId, "duration")).rejects.toMatchObject({
      digest: expect.stringContaining(`/v2/requests/${requestId}?sort=duration`),
    });
  });

  it("неизвестная сортировка отклоняется схемой: перехода нет", async () => {
    const { client, requestId } = await openRequestWithOffer();
    await signInAs(client);
    // @ts-expect-error неверное значение нарочно: проверяем схему на сервере
    await expect(chooseOfferSort(requestId, "cheap")).resolves.toBeUndefined();
  });
});
