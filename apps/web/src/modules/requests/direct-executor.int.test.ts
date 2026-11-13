import { describe, expect, it } from "vitest";
import type { CurrentUser } from "@/modules/identity";
import { db } from "@/platform/db";
import { actingAs, makeClient, makeExecutor } from "../../../test/factories";
import { makePortfolioItem } from "../../../test/factories/companies";
import { makeFurnitureType, placeStep, segmentStep } from "../../../test/factories/requests";
import {
  executorTarget,
  getDraft,
  getIncomingRequest,
  likeTarget,
  listIncomingRequests,
  publishRequest,
  saveDraftStep,
  type StepInput,
} from "./index";

/**
 * Прямая заявка мастеру по публичному номеру (`/requests/new?executor=<номер>`, профиль мастера): черновик адресуется
 * мастеру так же, как при «Хочу похожее», только без работы. Те же проверки: мастер подтверждён и не заблокирован, себе
 * адресовать нельзя, несуществующий номер — «не найдено».
 */

const code = (c: string) => expect.objectContaining({ code: c });

/** Все экраны мастера; первый — с номером мастера (или работой). */
async function fillDraft(client: CurrentUser, target: { executor?: number; like?: string }): Promise<string> {
  const type = await makeFurnitureType();
  const steps: StepInput[] = [
    { screen: "start", furnitureTypeId: type.id, customType: null, style: "modern", advanced: null },
    segmentStep("COMFORT"),
    { screen: "room", photoFileIds: [], description: "" },
    placeStep,
    { screen: "send" },
  ];
  let requestId: string | null = null;
  for (const step of steps) {
    const first: boolean = requestId === null;
    const saved: { requestId: string } = await saveDraftStep(client, {
      requestId,
      like: first ? (target.like ?? null) : null,
      executor: first ? (target.executor ?? null) : null,
      step,
    });
    requestId = saved.requestId;
  }
  return requestId!;
}

describe("прямая заявка по номеру мастера", () => {
  it("черновик адресован мастеру без привязки к работе; после отправки заявку видит только он", async () => {
    const client = await makeClient();
    const target = await makeExecutor({ segment: "COMFORT" });
    const other = await makeExecutor({ segment: "COMFORT" });

    const requestId = await fillDraft(client, { executor: target.executor.publicNumber });

    expect(await db.request.findUniqueOrThrow({ where: { id: requestId } })).toMatchObject({
      mode: "DIRECT",
      targetExecutorId: target.executor.id,
      portfolioItemId: null,
    });
    expect((await getDraft(client, requestId)).target).toEqual({ publicNumber: target.executor.publicNumber, segment: "COMFORT" });

    await publishRequest(client, { requestId });

    expect((await listIncomingRequests(target)).map((r) => r.id)).toContain(requestId);
    expect((await listIncomingRequests(other)).map((r) => r.id)).not.toContain(requestId);
    await expect(getIncomingRequest(other, requestId)).rejects.toThrow(code("NOT_FOUND"));
    const notified = await db.notification.findMany({ where: { kind: "request.direct" }, select: { userId: true } });
    expect(notified.map((n) => n.userId)).toEqual([target.id]);
  });

  it("executorTarget отдаёт номер и уровень мастера, без имени", async () => {
    const client = await makeClient();
    const target = await makeExecutor({ segment: "PREMIUM", legalName: "ИП Секретный" });

    const view = await executorTarget(target.executor.publicNumber, client);

    expect(view).toEqual({ publicNumber: target.executor.publicNumber, segment: "PREMIUM" });
    expect(JSON.stringify(view)).not.toContain("Секретный");
  });

  it("несуществующий номер, неподтверждённый и заблокированный мастер — не найдено; заявка не создаётся", async () => {
    const client = await makeClient();
    const rejected = await makeExecutor({ status: "REJECTED" });
    const pending = await makeExecutor({ status: "PENDING" });
    const blocked = await makeExecutor();
    await db.user.update({ where: { id: blocked.id }, data: { blockedAt: new Date() } });
    const missing = (await db.executorProfile.aggregate({ _max: { publicNumber: true } }))._max.publicNumber! + 1000;

    for (const n of [missing, rejected.executor.publicNumber, pending.executor.publicNumber, blocked.executor.publicNumber]) {
      await expect(executorTarget(n, client)).rejects.toThrow(code("NOT_FOUND"));
      await expect(fillDraft(client, { executor: n })).rejects.toThrow(code("NOT_FOUND"));
    }
    expect(await db.request.count({ where: { clientId: client.id } })).toBe(0);
  });

  it("свой номер (тот же человек в роли заказчика) — не найдено, как своя работа", async () => {
    const executor = await makeExecutor({ segment: "COMFORT", roles: ["EXECUTOR", "CLIENT"] });
    const me = actingAs(executor, "CLIENT");

    await expect(executorTarget(executor.executor.publicNumber, me)).rejects.toThrow(code("NOT_FOUND"));
    await expect(fillDraft(me, { executor: executor.executor.publicNumber })).rejects.toThrow(code("NOT_FOUND"));
    expect(await db.request.count({ where: { clientId: me.id } })).toBe(0);
    // Другой заказчик того же мастера выбирает как обычно.
    await expect(executorTarget(executor.executor.publicNumber, await makeClient())).resolves.toMatchObject({ publicNumber: executor.executor.publicNumber });
  });

  it("номер мастера и работа вместе — ошибка ввода; номер на уже созданном черновике ничего не меняет", async () => {
    const client = await makeClient();
    const target = await makeExecutor();
    const item = await makePortfolioItem(target);

    await expect(fillDraft(client, { executor: target.executor.publicNumber, like: item.id })).rejects.toThrow(code("VALIDATION"));
    expect(await db.request.count({ where: { clientId: client.id } })).toBe(0);

    const tender = await fillDraft(client, {});
    await saveDraftStep(client, { requestId: tender, executor: target.executor.publicNumber, step: segmentStep("ECONOMY") });
    expect(await db.request.findUniqueOrThrow({ where: { id: tender } })).toMatchObject({ mode: "TENDER", targetExecutorId: null });
  });

  it("«Хочу похожее» работает как прежде: прямой запрос с привязкой к работе", async () => {
    const client = await makeClient();
    const target = await makeExecutor();
    const item = await makePortfolioItem(target);

    await expect(likeTarget(item.id, client)).resolves.toMatchObject({ id: item.id });
    const requestId = await fillDraft(client, { like: item.id });

    expect(await db.request.findUniqueOrThrow({ where: { id: requestId } })).toMatchObject({
      mode: "DIRECT",
      targetExecutorId: target.executor.id,
      portfolioItemId: item.id,
    });
  });
});
