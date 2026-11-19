import { describe, expect, it } from "vitest";
import { MASK } from "@/modules/companies";
import { db } from "@/platform/db";
import { makeClient, makeExecutor, makeOperator } from "../../../test/factories";
import {
  makeChosen,
  makeDraft,
  makeFurnitureType,
  makeMeasured,
  makeMeasuring,
  makeOpenRequest,
  POINT,
  segmentStep,
  withPreContractFlows,
} from "../../../test/factories/requests";
import { agreeToContract, cancelRequest, getClientRequest, getDraft, likeTarget, listMyRequests, publishRequest, saveDraftStep } from "./index";

const code = (code: string) => expect.objectContaining({ code });

describe("черновик заявки", () => {
  it("создаётся на первом экране (тип и стиль); блок «Для продвинутых» — по желанию", async () => {
    const client = await makeClient();
    const type = await makeFurnitureType("Шкаф-купе");

    const first = await saveDraftStep(client, { requestId: null, step: { screen: "start", furnitureTypeId: type.id, customType: null, style: "loft", advanced: null } });
    expect(first.wizardStep).toBe(1);
    expect((await getDraft(client, first.requestId)).details).toEqual({});
    const second = await saveDraftStep(client, {
      requestId: first.requestId,
      step: {
        screen: "start",
        furnitureTypeId: type.id,
        customType: null,
        style: "loft",
        advanced: { size: { mode: "known", widthCm: 240, heightCm: null, depthCm: 60 }, facade: "ldsp", countertop: "none", hardware: "unknown" },
      },
    });

    expect(second.requestId).toBe(first.requestId);
    const draft = await getDraft(client, first.requestId);
    expect(draft).toMatchObject({ status: "DRAFT", mode: "TENDER", furnitureTypeId: type.id, style: "loft", wizardStep: 1, typeChosen: true });
    expect(draft.details).toEqual({ widthCm: 240, depthCm: 60, facade: "ldsp", unknown: ["hardware"] });
  });

  it("помощник ИИ может начать черновик шагом типа; прогресс мастера он не двигает", async () => {
    const client = await makeClient();
    const type = await makeFurnitureType();
    const { requestId, wizardStep } = await saveDraftStep(client, { requestId: null, step: { screen: "type", furnitureTypeId: type.id, customType: null } });
    expect(wizardStep).toBe(0);
    await saveDraftStep(client, { requestId, step: { screen: "size", size: { mode: "unknown" } } });
    expect(await getDraft(client, requestId)).toMatchObject({ wizardStep: 0, details: { unknown: ["size"] } });
    await expect(saveDraftStep(client, { requestId: null, step: segmentStep() })).rejects.toThrow(code("VALIDATION"));
  });

  it("уровень, описание, адрес и срок сохраняются на своих экранах; материалы помощника прогресс не двигают", async () => {
    const client = await makeClient();
    const type = await makeFurnitureType();
    const { requestId } = await saveDraftStep(client, { requestId: null, step: { screen: "type", furnitureTypeId: type.id, customType: null } });
    const step = (s: Parameters<typeof saveDraftStep>[1]["step"]) => saveDraftStep(client, { requestId, step: s });

    const afterMaterials = await step({ screen: "materials", facade: "ldsp", countertop: "none", hardware: "unknown", color: "", extras: [], description: "" });
    expect(afterMaterials.wizardStep).toBe(0);
    await step(segmentStep("ECONOMY"));
    await step({ screen: "room", photoFileIds: [], description: "Кухня до потолка, есть газовая труба" });
    await step({ screen: "place", city: "Алматы", address: "мкр Самал-2, 10", desiredDate: "2026-12-20", location: POINT, district: null, complex: null });

    const draft = await getDraft(client, requestId);
    expect(draft).toMatchObject({ segment: "ECONOMY", city: "Алматы", address: "мкр Самал-2, 10", desiredDate: new Date("2026-12-20T00:00:00Z"), location: POINT });
    expect(draft.details).toMatchObject({ facade: "ldsp", description: "Кухня до потолка, есть газовая труба", unknown: ["hardware"] });
  });

  it("шаг адреса сохраняет район и ЖК; ЖК без района — VALIDATION у complex", async () => {
    const client = await makeClient();
    const requestId = await makeDraft(client);
    const place = { screen: "place" as const, city: "Астана", address: "ул. Тестовая, 1", desiredDate: null, location: null };

    await saveDraftStep(client, { requestId, step: { ...place, district: "Есиль", complex: "ЖК Highvill" } });
    expect(await getDraft(client, requestId)).toMatchObject({ district: "Есиль", complex: "ЖК Highvill" });

    await saveDraftStep(client, { requestId, step: { ...place, district: null, complex: null } });
    expect(await getDraft(client, requestId)).toMatchObject({ district: null, complex: null });

    const invalid = saveDraftStep(client, { requestId, step: { ...place, district: null, complex: "ЖК Highvill" } });
    await expect(invalid).rejects.toThrow(code("VALIDATION"));
  });

  it("ЖК с телефоном — маска", async () => {
    const client = await makeClient();
    const requestId = await makeDraft(client);
    const place = { screen: "place" as const, city: "Астана", address: "ул. Тестовая, 1", desiredDate: null, location: null };
    await saveDraftStep(client, { requestId, step: { ...place, district: "Есиль", complex: "ЖК Highvill 87012345678" } });
    const row = await db.request.findUniqueOrThrow({ where: { id: requestId }, select: { complex: true } });
    expect(row.complex).toBe(`ЖК Highvill ${MASK}`);
  });

  it("контакты в свободном тексте заявки маскируются при сохранении: свой тип, стиль, описание, цвет, город", async () => {
    const client = await makeClient();
    const phone = "звоните 87012345678";
    const { requestId } = await saveDraftStep(client, { requestId: null, step: { screen: "start", furnitureTypeId: null, customType: `Шкаф, ${phone}`, style: null, advanced: null } });
    const step = (s: Parameters<typeof saveDraftStep>[1]["step"]) => saveDraftStep(client, { requestId, step: s });
    await step({ screen: "style", style: "loft", styleNote: "как в инсте ivan_mebel" });
    await step({ screen: "materials", facade: "ldsp", countertop: "none", hardware: "unknown", color: `белый, ${phone}`, extras: [], description: "" });
    await step({ screen: "room", photoFileIds: [], description: `Кухня до потолка, ${phone}` });
    await step({ screen: "place", city: "Алматы 8 701 234 56 78", address: "мкр Самал-2, 10", desiredDate: null, location: null, district: null, complex: null });

    const row = await db.request.findUniqueOrThrow({ where: { id: requestId }, select: { customType: true, city: true, details: true } });
    const stored = JSON.stringify(row);
    expect(stored).not.toMatch(/87012345678|8 701 234 56 78|ivan_mebel/);
    expect(row.customType).toBe(`Шкаф, звоните ${MASK}`);
    expect(row.city).toBe(`Алматы ${MASK}`);
    expect(row.details).toMatchObject({ description: `Кухня до потолка, звоните ${MASK}`, color: `белый, звоните ${MASK}`, styleNote: `как в ${MASK}` });
  });

  it("возврат на ранний шаг не откатывает прогресс мастера", async () => {
    const client = await makeClient();
    const requestId = await makeDraft(client);
    const saved = await saveDraftStep(client, { requestId, step: { screen: "style", style: "classic", styleNote: "" } });
    expect(saved.wizardStep).toBe(5);
  });

  it("точка адреса: обе координаты или ни одной; без точки адрес сохраняется, повторное сохранение без точки её стирает", async () => {
    const client = await makeClient();
    const requestId = await makeDraft(client);
    const place = { screen: "place" as const, city: "Астана", address: "ул. Тестовая, 1", desiredDate: null, district: null, complex: null };
    expect(await db.request.findUniqueOrThrow({ where: { id: requestId } })).toMatchObject({ addressLat: POINT.lat, addressLng: POINT.lng });
    await saveDraftStep(client, { requestId, step: { ...place, location: null } });
    expect(await db.request.findUniqueOrThrow({ where: { id: requestId } })).toMatchObject({ address: "ул. Тестовая, 1", addressLat: null, addressLng: null });
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
      await expect(likeTarget(item.id, client)).rejects.toMatchObject({ code: "NOT_FOUND" });
    }
    expect(await db.request.count()).toBe(0);
  });

  it("«Хочу похожее» на работу выключенного типа мебели — не найдено, как и в каталоге", async () => {
    const client = await makeClient();
    const executor = await makeExecutor();
    const type = await makeFurnitureType("Шкаф");
    const item = await db.portfolioItem.create({ data: { executorId: executor.executor.id, furnitureTypeId: type.id, style: "scandi", title: "Шкаф", published: true } });
    await db.furnitureType.update({ where: { id: type.id }, data: { active: false } });

    await expect(likeTarget(item.id, client)).rejects.toMatchObject({ code: "NOT_FOUND" });
    await expect(makeDraft(client, { like: item.id })).rejects.toMatchObject({ code: "NOT_FOUND" });
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
    const room = (photoFileIds: string[]) => saveDraftStep(client, { requestId, step: { screen: "room", photoFileIds, description: "" } });

    await room([a.id, b.id]);
    expect((await getDraft(client, requestId)).photos.map((p) => p.id)).toEqual([a.id, b.id]);
    await room([b.id]);
    expect((await getDraft(client, requestId)).photos.map((p) => p.id)).toEqual([b.id]);
    await expect(room([b.id, (await upload(stranger.id, 3)).id])).rejects.toThrow(code("CONFLICT"));
  });

  it("фото помещения, добавленные позже, встают в конец — порядок не сбивается", async () => {
    const client = await makeClient();
    const requestId = await makeDraft(client);
    const upload = (n: number) =>
      db.storedFile.create({
        data: { storageKey: `test/room-order-${client.id}-${n}`, provider: "local", purpose: "REQUEST_ROOM", contentType: "image/jpeg", size: 1, sha256: "x", uploadedById: client.id },
      });
    const [a, b, c] = [await upload(1), await upload(2), await upload(3)];
    const room = (photoFileIds: string[]) => saveDraftStep(client, { requestId, step: { screen: "room", photoFileIds, description: "" } });

    await room([a.id, b.id]);
    await room([a.id, b.id, c.id]);

    expect((await getDraft(client, requestId)).photos.map((p) => p.id)).toEqual([a.id, b.id, c.id]);
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
    await expect(saveDraftStep(client, { requestId, step: segmentStep("PREMIUM") })).rejects.toThrow(code("CONFLICT"));
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

describe("отмена заявки → CANCELLED (сценарии до договора)", () => {
  withPreContractFlows();

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

  it.each(["OFFER_CHOSEN", "MEASURING"] as const)("из %s выбранный отклик отклоняется — исполнитель больше не «выбран»", async (status) => {
    const client = await makeClient();
    const { requestId, offerId } = status === "OFFER_CHOSEN" ? await makeChosen(client) : await makeMeasuring(client);

    await cancelRequest(client, { requestId });

    expect((await db.offer.findUniqueOrThrow({ where: { id: offerId } })).status).toBe("DECLINED");
  });

  it("после договора, повторно и чужим — запрещена", async () => {
    const client = await makeClient();
    const m = await makeMeasured(client);
    await agreeToContract(client, { requestId: m.requestId });
    await expect(cancelRequest(client, { requestId: m.requestId })).rejects.toThrow(code("CONFLICT"));

    const other = await makeOpenRequest(client);
    await cancelRequest(client, { requestId: other });
    await expect(cancelRequest(client, { requestId: other })).rejects.toThrow(code("CONFLICT"));
    await expect(cancelRequest(await makeClient(), { requestId: other })).rejects.toThrow(code("NOT_FOUND"));
    await expect(cancelRequest(await makeOperator(), { requestId: other })).rejects.toThrow(code("FORBIDDEN"));
  });
});

describe("мои заявки", () => {
  withPreContractFlows();

  it("показывают только свои, с числом откликов", async () => {
    const client = await makeClient();
    await makeChosen(client);
    await makeDraft(await makeClient());

    const list = await listMyRequests(client);

    expect(list).toHaveLength(1);
    expect(list[0]).toMatchObject({ status: "OFFER_CHOSEN", offersCount: 1, title: "Кухня" });
  });

  it("обложка карточки — первое фото помещения; без фото — null", async () => {
    const client = await makeClient();
    const withPhotos = await makeDraft(client);
    const without = await makeDraft(client);
    const upload = (n: number) =>
      db.storedFile.create({
        data: { storageKey: `test/cover-${client.id}-${n}`, provider: "local", purpose: "REQUEST_ROOM", contentType: "image/jpeg", size: 1, sha256: "x", uploadedById: client.id },
      });
    const [a, b] = [await upload(1), await upload(2)];
    await saveDraftStep(client, { requestId: withPhotos, step: { screen: "room", photoFileIds: [a.id, b.id], description: "" } });

    const list = await listMyRequests(client);
    const cover = (id: string) => list.find((r) => r.id === id)?.cover;

    expect(cover(withPhotos)).toMatchObject({ id: a.id, src: expect.any(String) });
    expect(cover(without)).toBeNull();
  });
});

describe("черновик заявки: повтор первого шага с ключом", () => {
  const first = (furnitureTypeId: string) => ({ screen: "type" as const, furnitureTypeId, customType: null });

  it("первый шаг дважды с тем же ключом — один черновик, тот же requestId", async () => {
    const client = await makeClient();
    const type = await makeFurnitureType("Прихожая");
    const clientKey = crypto.randomUUID();

    const a = await saveDraftStep(client, { requestId: null, clientKey, step: first(type.id) });
    const b = await saveDraftStep(client, { requestId: null, clientKey, step: first(type.id) });

    expect(b.requestId).toBe(a.requestId);
    expect(await db.request.count({ where: { clientId: client.id } })).toBe(1);
    expect(await db.auditEvent.count({ where: { action: "request.created", entityId: a.requestId } })).toBe(1);
  });

  it("два одновременных первых шага с тем же ключом — один черновик", async () => {
    const client = await makeClient();
    const type = await makeFurnitureType("Гардеробная");
    const clientKey = crypto.randomUUID();

    const results = await Promise.all([0, 1].map(() => saveDraftStep(client, { requestId: null, clientKey, step: first(type.id) })));

    expect(new Set(results.map((r) => r.requestId)).size).toBe(1);
    expect(await db.request.count({ where: { clientId: client.id } })).toBe(1);
  });

  it("тот же ключ у другого покупателя — свой черновик", async () => {
    const type = await makeFurnitureType("Тумба");
    const clientKey = crypto.randomUUID();
    const a = await saveDraftStep(await makeClient(), { requestId: null, clientKey, step: first(type.id) });
    const b = await saveDraftStep(await makeClient(), { requestId: null, clientKey, step: first(type.id) });
    expect(b.requestId).not.toBe(a.requestId);
  });
});


describe("свой дизайн-проект в шаге «Помещение»", () => {
  let n = 0;
  const upload = (uploadedById: string, purpose: "REQUEST_ROOM" | "REQUEST_DESIGN", contentType = purpose === "REQUEST_DESIGN" ? "application/pdf" : "image/jpeg") =>
    db.storedFile.create({ data: { storageKey: `test/design-${uploadedById}-${++n}`, provider: "local", purpose, contentType, size: 1, sha256: "x", uploadedById } });
  const room = (client: Awaited<ReturnType<typeof makeClient>>, requestId: string, s: { photoFileIds?: string[]; designFileIds?: string[]; designContactsConfirmed?: boolean }) =>
    saveDraftStep(client, {
      requestId,
      step: { screen: "room", photoFileIds: s.photoFileIds ?? [], description: "", designFileIds: s.designFileIds ?? [], designContactsConfirmed: s.designContactsConfirmed ?? false },
    });
  const stored = (id: string) => db.storedFile.findUniqueOrThrow({ where: { id } });
  const confirmedAt = async (requestId: string) => (await db.request.findUniqueOrThrow({ where: { id: requestId } })).designConfirmedAt;

  it("PDF проекта с отметкой прикрепляется как REQUEST_DESIGN, отметка запоминается, аудит знает число файлов", async () => {
    const client = await makeClient();
    const requestId = await makeDraft(client);
    const pdf = await upload(client.id, "REQUEST_DESIGN");

    await room(client, requestId, { designFileIds: [pdf.id], designContactsConfirmed: true });

    expect(await stored(pdf.id)).toMatchObject({ requestId, purpose: "REQUEST_DESIGN" });
    const first = await confirmedAt(requestId);
    expect(first).toBeInstanceOf(Date);
    // Повторное сохранение не сдвигает время отметки.
    await room(client, requestId, { designFileIds: [pdf.id], designContactsConfirmed: true });
    expect(await confirmedAt(requestId)).toEqual(first);
    const audit = await db.auditEvent.findFirstOrThrow({ where: { action: "request.draft_saved", entityId: requestId }, orderBy: { createdAt: "desc" } });
    expect(audit.meta).toMatchObject({ screen: "room", designFiles: 1 });
  });

  it("файлы проекта без отметки — VALIDATION у отметки, даже мимо схемы; файл не прикрепляется", async () => {
    const client = await makeClient();
    const requestId = await makeDraft(client);
    const pdf = await upload(client.id, "REQUEST_DESIGN");

    await expect(room(client, requestId, { designFileIds: [pdf.id], designContactsConfirmed: false })).rejects.toThrow(
      expect.objectContaining({ code: "VALIDATION", details: { fieldErrors: { designContactsConfirmed: [expect.any(String)] } } }),
    );
    expect(await stored(pdf.id)).toMatchObject({ requestId: null });
    expect(await confirmedAt(requestId)).toBeNull();
  });

  it("назначения не смешиваются: файл проекта среди фото помещения и фото среди файлов проекта — отказ", async () => {
    const client = await makeClient();
    const requestId = await makeDraft(client);
    const pdf = await upload(client.id, "REQUEST_DESIGN");
    const photo = await upload(client.id, "REQUEST_ROOM");

    await expect(room(client, requestId, { photoFileIds: [pdf.id] })).rejects.toThrow(code("CONFLICT"));
    await expect(room(client, requestId, { designFileIds: [photo.id], designContactsConfirmed: true })).rejects.toThrow(code("CONFLICT"));
    expect(await stored(pdf.id)).toMatchObject({ requestId: null, purpose: "REQUEST_DESIGN" });
    expect(await stored(photo.id)).toMatchObject({ requestId: null, purpose: "REQUEST_ROOM" });
  });

  it("фото помещения и файлы проекта сохраняются вместе, каждый — по своему назначению", async () => {
    const client = await makeClient();
    const requestId = await makeDraft(client);
    const photo = await upload(client.id, "REQUEST_ROOM");
    const pdf = await upload(client.id, "REQUEST_DESIGN");
    const design = await upload(client.id, "REQUEST_DESIGN", "image/jpeg");

    await room(client, requestId, { photoFileIds: [photo.id], designFileIds: [pdf.id, design.id], designContactsConfirmed: true });

    expect((await getDraft(client, requestId)).photos.map((p) => p.id)).toEqual([photo.id]);
    const designFiles = await db.storedFile.findMany({ where: { requestId, purpose: "REQUEST_DESIGN" }, orderBy: { sortOrder: "asc" } });
    expect(designFiles.map((f) => f.id)).toEqual([pdf.id, design.id]);
    // Убрать фото не трогает файлы проекта, и наоборот.
    await room(client, requestId, { photoFileIds: [], designFileIds: [pdf.id, design.id], designContactsConfirmed: true });
    expect(await db.storedFile.count({ where: { requestId, purpose: "REQUEST_DESIGN" } })).toBe(2);
    await room(client, requestId, { photoFileIds: [photo.id], designFileIds: [], designContactsConfirmed: false });
    expect(await db.storedFile.count({ where: { requestId, purpose: "REQUEST_ROOM" } })).toBe(1);
  });

  it("шаг room без полей проекта (форма v1) не трогает файлы проекта и отметку", async () => {
    const client = await makeClient();
    const requestId = await makeDraft(client);
    const pdf = await upload(client.id, "REQUEST_DESIGN");
    await room(client, requestId, { designFileIds: [pdf.id], designContactsConfirmed: true });
    const before = await confirmedAt(requestId);

    await saveDraftStep(client, { requestId, step: { screen: "room", photoFileIds: [], description: "" } });

    expect(await stored(pdf.id)).toMatchObject({ requestId, purpose: "REQUEST_DESIGN" });
    expect(await confirmedAt(requestId)).toEqual(before);
    const audit = await db.auditEvent.findFirstOrThrow({ where: { action: "request.draft_saved", entityId: requestId }, orderBy: { createdAt: "desc" } });
    expect(audit.meta).not.toHaveProperty("designFiles");
  });

  it("убрали все файлы проекта — отметка сбрасывается, файлы откреплены", async () => {
    const client = await makeClient();
    const requestId = await makeDraft(client);
    const pdf = await upload(client.id, "REQUEST_DESIGN");
    await room(client, requestId, { designFileIds: [pdf.id], designContactsConfirmed: true });

    await room(client, requestId, { designFileIds: [] });

    expect(await confirmedAt(requestId)).toBeNull();
    expect(await stored(pdf.id)).toMatchObject({ requestId: null });
  });

  it("покупатель видит свой проект в черновике и в заявке: вид файла, номер, скрытый — с пометкой; отметка", async () => {
    const client = await makeClient();
    const operator = await makeOperator();
    const requestId = await makeDraft(client);
    const pdf = await upload(client.id, "REQUEST_DESIGN");
    const photo = await upload(client.id, "REQUEST_DESIGN", "image/jpeg");
    expect(await getDraft(client, requestId)).toMatchObject({ design: [], designConfirmed: false });

    await room(client, requestId, { designFileIds: [pdf.id, photo.id], designContactsConfirmed: true });
    await db.storedFile.update({ where: { id: photo.id }, data: { hiddenAt: new Date(), hiddenById: operator.id } });

    const draft = await getDraft(client, requestId);
    expect(draft.designConfirmed).toBe(true);
    expect(draft.design).toEqual([
      expect.objectContaining({ id: pdf.id, kind: "pdf", n: 1, hidden: false }),
      expect.objectContaining({ id: photo.id, kind: "image", n: 2, hidden: true }),
    ]);
    expect(draft.design[0]?.src).toEqual(expect.any(String));
    const card = await getClientRequest(client, requestId);
    expect(card.design.map((f) => [f.id, f.hidden])).toEqual([
      [pdf.id, false],
      [photo.id, true],
    ]);
    expect(card.designConfirmed).toBe(true);
  });

  it("отправка с файлами проекта без отметки в БД — VALIDATION; с отметкой — уходит", async () => {
    const client = await makeClient();
    const requestId = await makeDraft(client);
    const pdf = await upload(client.id, "REQUEST_DESIGN");
    await room(client, requestId, { designFileIds: [pdf.id], designContactsConfirmed: true });
    await db.request.update({ where: { id: requestId }, data: { designConfirmedAt: null } });

    await expect(publishRequest(client, { requestId })).rejects.toThrow(code("VALIDATION"));
    expect((await db.request.findUniqueOrThrow({ where: { id: requestId } })).status).toBe("DRAFT");

    await room(client, requestId, { designFileIds: [pdf.id], designContactsConfirmed: true });
    await publishRequest(client, { requestId });
    expect((await db.request.findUniqueOrThrow({ where: { id: requestId } })).status).toBe("OPEN");
  });
});
