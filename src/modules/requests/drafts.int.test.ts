import { describe, expect, it } from "vitest";
import { db } from "@/platform/db";
import { makeClient, makeExecutor, makeOperator } from "../../../test/factories";
import { makeChosen, makeDraft, makeFurnitureType, makeMeasured, makeMeasuring, makeOpenRequest, sendStep } from "../../../test/factories/requests";
import { agreeToContract, cancelRequest, getDraft, likeTarget, listMyRequests, publishRequest, saveDraftStep } from "./index";

const code = (code: string) => expect.objectContaining({ code });

describe("черновик заявки", () => {
  it("создаётся на первом шаге и сохраняется на каждом следующем", async () => {
    const client = await makeClient();
    const type = await makeFurnitureType("Шкаф-купе");

    const first = await saveDraftStep(client, { requestId: null, step: { screen: "type", furnitureTypeId: type.id, customType: null } });
    expect(first.wizardStep).toBe(1);
    const second = await saveDraftStep(client, { requestId: first.requestId, step: { screen: "style", style: "loft", styleNote: "" } });
    await saveDraftStep(client, {
      requestId: first.requestId,
      step: { screen: "size", size: { mode: "known", widthCm: 240, heightCm: null, depthCm: 60 } },
    });

    expect(second.requestId).toBe(first.requestId);
    const draft = await getDraft(client, first.requestId);
    expect(draft).toMatchObject({ status: "DRAFT", mode: "TENDER", furnitureTypeId: type.id, style: "loft", wizardStep: 4 });
    expect(draft.details).toEqual({ widthCm: 240, depthCm: 60 });
  });

  it("возврат на ранний шаг не откатывает прогресс мастера", async () => {
    const client = await makeClient();
    const requestId = await makeDraft(client);
    const saved = await saveDraftStep(client, { requestId, step: { screen: "style", style: "classic", styleNote: "" } });
    expect(saved.wizardStep).toBe(6);
  });

  it("подсказка сегмента пересчитывается по материалам", async () => {
    const client = await makeClient();
    const requestId = await makeDraft(client);
    await saveDraftStep(client, {
      requestId,
      step: { screen: "materials", facade: "solid_wood", countertop: "none", hardware: "unknown", color: "", extras: [], description: "" },
    });
    expect((await db.request.findUniqueOrThrow({ where: { id: requestId } })).segmentSuggested).toBe("PREMIUM");
  });

  it("«Хочу похожее» создаёт прямой запрос исполнителю работы", async () => {
    const client = await makeClient();
    const executor = await makeExecutor({ segment: "PREMIUM" });
    const type = await makeFurnitureType("Стол");
    const item = await db.portfolioItem.create({
      data: { executorId: executor.executor.id, furnitureTypeId: type.id, style: "scandi", title: "Стол из карагача" },
    });

    const requestId = await makeDraft(client, { like: item.id, typeId: type.id });

    expect(await db.request.findUniqueOrThrow({ where: { id: requestId } })).toMatchObject({
      mode: "DIRECT",
      targetExecutorId: executor.executor.id,
      portfolioItemId: item.id,
    });
  });

  it("«Хочу похожее» на работу неподтверждённого или заблокированного исполнителя — не найдено", async () => {
    const client = await makeClient();
    const type = await makeFurnitureType("Комод");
    const rejected = await makeExecutor({ status: "REJECTED" });
    const blocked = await makeExecutor();
    await db.user.update({ where: { id: blocked.id }, data: { blockedAt: new Date() } });
    for (const ex of [rejected, blocked]) {
      const item = await db.portfolioItem.create({ data: { executorId: ex.executor.id, furnitureTypeId: type.id, style: "scandi", title: "Комод" } });
      await expect(makeDraft(client, { like: item.id, typeId: type.id })).rejects.toMatchObject({ code: "NOT_FOUND" });
      await expect(likeTarget(item.id)).rejects.toMatchObject({ code: "NOT_FOUND" });
    }
    expect(await db.request.count()).toBe(0);
  });

  it("фото помещения: свои загруженные файлы прикрепляются, убранные открепляются, чужие — отказ", async () => {
    const client = await makeClient();
    const stranger = await makeClient();
    const requestId = await makeDraft(client);
    const upload = (uploadedById: string, n: number) =>
      db.storedFile.create({
        data: { storageKey: `test/room-${uploadedById}-${n}`, provider: "local", purpose: "REQUEST_ROOM", contentType: "image/jpeg", size: 1, sha256: "x", uploadedById },
      });
    const [a, b] = [await upload(client.id, 1), await upload(client.id, 2)];
    const room = (photoFileIds: string[]) => saveDraftStep(client, { requestId, step: { screen: "room", photoFileIds } });

    await room([a.id, b.id]);
    expect((await getDraft(client, requestId)).photos.map((p) => p.id)).toEqual([a.id, b.id]);
    await room([b.id]);
    expect((await getDraft(client, requestId)).photos.map((p) => p.id)).toEqual([b.id]);
    await expect(room([b.id, (await upload(stranger.id, 3)).id])).rejects.toThrow(code("CONFLICT"));
  });

  it("чужой черновик не виден и не меняется (IDOR)", async () => {
    const owner = await makeClient();
    const stranger = await makeClient();
    const requestId = await makeDraft(owner);

    await expect(getDraft(stranger, requestId)).rejects.toThrow(code("NOT_FOUND"));
    await expect(saveDraftStep(stranger, { requestId, step: { screen: "style", style: "loft", styleNote: "" } })).rejects.toThrow(
      code("NOT_FOUND"),
    );
  });

  it("исполнитель не может создавать заявки", async () => {
    const executor = await makeExecutor();
    const type = await makeFurnitureType();
    await expect(
      saveDraftStep(executor, { requestId: null, step: { screen: "type", furnitureTypeId: type.id, customType: null } }),
    ).rejects.toThrow(code("FORBIDDEN"));
  });

  it("отправленную заявку мастер больше не меняет", async () => {
    const client = await makeClient();
    const requestId = await makeOpenRequest(client);
    await expect(saveDraftStep(client, { requestId, step: sendStep("PREMIUM") })).rejects.toThrow(code("CONFLICT"));
  });
});

describe("отправка заявки DRAFT → OPEN", () => {
  it("открывает заявку, пишет журнал и уведомляет исполнителей сегмента", async () => {
    const client = await makeClient();
    const comfort = await makeExecutor({ segment: "COMFORT" });
    const premium = await makeExecutor({ segment: "PREMIUM" });
    const pending = await makeExecutor({ segment: "COMFORT", status: "PENDING" });
    const requestId = await makeDraft(client, { segment: "COMFORT" });

    await publishRequest(client, { requestId });

    expect(await db.request.findUniqueOrThrow({ where: { id: requestId } })).toMatchObject({ status: "OPEN", publishedAt: expect.any(Date) });
    expect(await db.auditEvent.findFirst({ where: { action: "request.published", entityId: requestId } })).toMatchObject({
      scope: `request:${requestId}`,
      actorId: client.id,
    });
    const notified = (await db.notification.findMany({ where: { kind: "request.new" } })).map((n) => n.userId);
    expect(notified).toEqual([comfort.id]);
    expect(notified).not.toContain(premium.id);
    expect(notified).not.toContain(pending.id);
  });

  it("незаполненный мастер отправить нельзя", async () => {
    const client = await makeClient();
    const type = await makeFurnitureType();
    const { requestId } = await saveDraftStep(client, { requestId: null, step: { screen: "type", furnitureTypeId: type.id, customType: null } });
    await expect(publishRequest(client, { requestId })).rejects.toThrow(code("VALIDATION"));
  });

  it("повторная отправка — конфликт, чужая — не найдена", async () => {
    const client = await makeClient();
    const requestId = await makeOpenRequest(client);
    await expect(publishRequest(client, { requestId })).rejects.toThrow(code("CONFLICT"));
    await expect(publishRequest(await makeClient(), { requestId })).rejects.toThrow(code("NOT_FOUND"));
  });

  it("прямой запрос: исполнитель получает важное уведомление «request.direct» с SMS", async () => {
    const client = await makeClient();
    const executor = await makeExecutor();
    const type = await makeFurnitureType();
    const item = await db.portfolioItem.create({ data: { executorId: executor.executor.id, furnitureTypeId: type.id, style: "modern", title: "Кухня" } });
    const requestId = await makeDraft(client, { like: item.id, typeId: type.id });

    await publishRequest(client, { requestId });

    const note = await db.notification.findFirstOrThrow({ where: { userId: executor.id } });
    expect(note).toMatchObject({ kind: "request.direct", link: `/executor/requests/${requestId}` });
    expect(await db.job.count({ where: { kind: "notifications.sendSms", dedupeKey: `sms:${note.id}` } })).toBe(1);
  });

  it("прямой запрос к неподтверждённому исполнителю не отправляется", async () => {
    const client = await makeClient();
    const executor = await makeExecutor();
    const type = await makeFurnitureType();
    const item = await db.portfolioItem.create({ data: { executorId: executor.executor.id, furnitureTypeId: type.id, style: "modern", title: "Кухня" } });
    const requestId = await makeDraft(client, { like: item.id, typeId: type.id });
    // Пока заказчик заполнял черновик, исполнителю отказали.
    await db.executorProfile.update({ where: { id: executor.executor.id }, data: { status: "REJECTED" } });
    await expect(publishRequest(client, { requestId })).rejects.toThrow(code("CONFLICT"));
  });
});

describe("отмена заявки → CANCELLED", () => {
  it.each(["DRAFT", "OPEN", "OFFER_CHOSEN", "MEASURING"] as const)("из %s разрешена заказчику", async (status) => {
    const client = await makeClient();
    const requestId =
      status === "DRAFT"
        ? await makeDraft(client)
        : status === "OPEN"
          ? await makeOpenRequest(client)
          : status === "OFFER_CHOSEN"
            ? (await makeChosen(client)).requestId
            : (await makeMeasuring(client)).requestId;
    expect((await db.request.findUniqueOrThrow({ where: { id: requestId } })).status).toBe(status);

    await cancelRequest(client, { requestId });

    expect((await db.request.findUniqueOrThrow({ where: { id: requestId } })).status).toBe("CANCELLED");
  });

  it("отменяет назначенный замер без платы, а после выезда начисляет плату за выезд", async () => {
    const client = await makeClient();
    const scheduled = await makeMeasuring(client);
    await cancelRequest(client, { requestId: scheduled.requestId });
    expect(await db.measurement.findUniqueOrThrow({ where: { id: scheduled.measurementId } })).toMatchObject({
      status: "CANCELLED",
      feeAccrued: null,
    });

    const measured = await makeMeasured(client);
    await cancelRequest(client, { requestId: measured.requestId });
    expect(await db.measurement.findUniqueOrThrow({ where: { id: measured.measurementId } })).toMatchObject({
      status: "NO_DEAL",
      feeAccrued: 10_000,
    });
  });

  it("после договора, повторно и чужим — запрещена", async () => {
    const client = await makeClient();
    const m = await makeMeasured(client);
    await agreeToContract(client, { requestId: m.requestId, template: "advance-50" });
    await expect(cancelRequest(client, { requestId: m.requestId })).rejects.toThrow(code("CONFLICT"));

    const other = await makeOpenRequest(client);
    await cancelRequest(client, { requestId: other });
    await expect(cancelRequest(client, { requestId: other })).rejects.toThrow(code("CONFLICT"));
    await expect(cancelRequest(await makeClient(), { requestId: other })).rejects.toThrow(code("NOT_FOUND"));
    await expect(cancelRequest(await makeOperator(), { requestId: other })).rejects.toThrow(code("FORBIDDEN"));
  });
});

describe("мои заявки", () => {
  it("показывают только свои, с числом откликов", async () => {
    const client = await makeClient();
    await makeChosen(client);
    await makeDraft(await makeClient());

    const list = await listMyRequests(client);

    expect(list).toHaveLength(1);
    expect(list[0]).toMatchObject({ status: "OFFER_CHOSEN", offersCount: 1, title: "Кухня" });
  });
});
