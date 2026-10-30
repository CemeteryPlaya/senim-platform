import { describe, expect, it } from "vitest";
import { db } from "@/platform/db";
import { makeClient, makeExecutor, makeOperator } from "../../../test/factories";
import { canReadFile } from "./index";

let n = 0;
const file = (data: Record<string, string | undefined>) =>
  db.storedFile.create({
    data: { storageKey: `t/${++n}.jpg`, provider: "local", purpose: "REQUEST_ROOM", contentType: "image/jpeg", size: 1, sha256: "x", ...data },
  });

describe("canReadFile по сущности-владельцу (реальная БД)", () => {
  it("фото открытого тендера: заказчик, исполнитель сегмента, оператор — да; чужие — нет", async () => {
    const client = await makeClient();
    const stranger = await makeClient();
    const comfort = await makeExecutor({ segment: "COMFORT" });
    const premium = await makeExecutor({ segment: "PREMIUM" });
    const operator = await makeOperator();
    const request = await db.request.create({ data: { clientId: client.id, mode: "TENDER", status: "OPEN", segment: "COMFORT" } });
    const photo = await file({ requestId: request.id, uploadedById: client.id });

    expect(await canReadFile(client, photo)).toBe(true);
    expect(await canReadFile(comfort, photo)).toBe(true);
    expect(await canReadFile(operator, photo)).toBe(true);
    expect(await canReadFile(premium, photo)).toBe(false);
    expect(await canReadFile(stranger, photo)).toBe(false);
    expect(await canReadFile(null, photo)).toBe(false);
  });

  it("фото этапа сделки: только стороны сделки", async () => {
    const client = await makeClient();
    const executor = await makeExecutor();
    const outsider = await makeExecutor();
    const request = await db.request.create({ data: { clientId: client.id, mode: "TENDER", status: "CLOSED", segment: "COMFORT" } });
    const offer = await db.offer.create({
      data: { requestId: request.id, executorId: executor.executor.id, price: 1, durationDays: 1, warrantyMonths: 1, measurementTerms: "FREE", status: "ACCEPTED" },
    });
    const deal = await db.deal.create({
      data: {
        requestId: request.id,
        offerId: offer.id,
        clientId: client.id,
        executorId: executor.executor.id,
        title: "Кухня",
        totalAmount: 1,
        paymentMode: "MANUAL",
        stageTemplate: "t",
        autoAcceptDays: 5,
      },
    });
    const stage = await db.stage.create({ data: { dealId: deal.id, order: 1, title: "Этап", amount: 1, paymentDue: "ON_ACCEPTANCE" } });
    const photo = await file({ stageId: stage.id, uploadedById: executor.id, purpose: "STAGE_REPORT" });
    const attachment = await file({ uploadedById: client.id, purpose: "MESSAGE" });
    const message = await db.message.create({ data: { offerId: offer.id, senderId: client.id, body: "фото" } });
    await db.storedFile.update({ where: { id: attachment.id }, data: { messageId: message.id } });

    expect(await canReadFile(client, photo)).toBe(true);
    expect(await canReadFile(executor, photo)).toBe(true);
    expect(await canReadFile(outsider, photo)).toBe(false);
    expect(await canReadFile(executor, attachment)).toBe(true);
    expect(await canReadFile(outsider, attachment)).toBe(false);
  });

  it("портфолио публично; несуществующий файл — нет", async () => {
    const executor = await makeExecutor();
    const type = await db.furnitureType.create({ data: { slug: "kitchen", name: "Кухня" } });
    const item = await db.portfolioItem.create({ data: { executorId: executor.executor.id, furnitureTypeId: type.id, style: "modern", title: "Кухня" } });
    const photo = await file({ portfolioItemId: item.id, uploadedById: executor.id, purpose: "PORTFOLIO" });
    expect(await canReadFile(null, photo)).toBe(true);
    expect(await canReadFile(null, { id: "missing" })).toBe(false);
  });
});
