import { describe, expect, it } from "vitest";
import type { FilePurpose } from "@/generated/prisma/enums";
import type { CurrentUser } from "@/modules/identity";
import { db } from "@/platform/db";
import { makeClient, makeExecutor, makeOperator } from "../../../test/factories";
import { dealAt, makeDeal } from "../../../test/factories/deal";
import { canReadFile } from "./index";

let n = 0;
const file = (data: { purpose: FilePurpose; uploadedById?: string } & Record<string, string | undefined>) =>
  db.storedFile.create({ data: { storageKey: `t/${++n}.jpg`, provider: "local", contentType: "image/jpeg", size: 1, sha256: "x", ...data } });

/** Кто из списка может прочитать файл — одной строкой для сравнения. */
async function readers(photo: { id: string }, people: Record<string, CurrentUser | null>) {
  const allowed: string[] = [];
  for (const [name, user] of Object.entries(people)) if (await canReadFile(user, photo)) allowed.push(name);
  return allowed;
}

describe("canReadFile по сущности-владельцу (реальная БД)", () => {
  it("фото открытого тендера: заказчик, исполнитель сегмента, оператор — да; чужие — нет", async () => {
    const client = await makeClient();
    const request = await db.request.create({ data: { clientId: client.id, mode: "TENDER", status: "OPEN", segment: "COMFORT" } });
    const photo = await file({ purpose: "REQUEST_ROOM", requestId: request.id, uploadedById: client.id });
    const people = {
      client,
      comfort: await makeExecutor({ segment: "COMFORT" }),
      operator: await makeOperator(),
      premium: await makeExecutor({ segment: "PREMIUM" }),
      stranger: await makeClient(),
      guest: null,
    };
    expect(await readers(photo, people)).toEqual(["client", "comfort", "operator"]);
  });

  it("фото сдачи, «Ход работ», спор и документ сделки — стороны и оператор, чужие — нет (IDOR)", async () => {
    const deal = await dealAt("IN_PROGRESS");
    const report = await db.progressReport.create({ data: { dealId: deal.dealId, authorId: deal.executor.id, text: "Корпус собран" } });
    const dispute = await db.dispute.create({ data: { dealId: deal.dealId, openedById: deal.client.id, openedInStatus: "IN_PROGRESS", reason: "QUALITY", description: "Скол" } });
    const contract = await db.document.findFirstOrThrow({ where: { dealId: deal.dealId, kind: "CONTRACT" } });
    const otherDeal = await makeDeal();
    const people = {
      client: deal.client,
      executor: deal.executor,
      operator: await makeOperator(),
      otherClient: otherDeal.client,
      otherExecutor: otherDeal.executor,
      guest: null,
    };
    const parties = ["client", "executor", "operator"];

    expect(await readers(await file({ purpose: "DELIVERY", dealId: deal.dealId, uploadedById: deal.executor.id }), people)).toEqual(parties);
    expect(await readers(await file({ purpose: "PROGRESS_REPORT", progressReportId: report.id, uploadedById: deal.executor.id }), people)).toEqual(parties);
    expect(await readers(await file({ purpose: "DISPUTE", disputeId: dispute.id, uploadedById: deal.client.id }), people)).toEqual(parties);
    expect(await readers({ id: contract.fileId }, people)).toEqual(parties);
  });

  it("вложение чата — стороны отклика", async () => {
    const deal = await makeDeal();
    const outsider = await makeExecutor();
    const attachment = await file({ purpose: "MESSAGE", uploadedById: deal.client.id });
    const message = await db.message.create({ data: { offerId: deal.offerId, senderId: deal.client.id, body: "фото" } });
    await db.storedFile.update({ where: { id: attachment.id }, data: { messageId: message.id } });
    expect(await readers(attachment, { executor: deal.executor, outsider })).toEqual(["executor"]);
  });

  it("KYC — только сам мастер и оператор: ни другой мастер, ни заказчик его сделки", async () => {
    const deal = await makeDeal();
    const kyc = await file({ purpose: "KYC_ID", executorProfileId: deal.executor.executor.id, uploadedById: deal.executor.id });
    const registration = await file({ purpose: "KYC_REGISTRATION", executorProfileId: deal.executor.executor.id, uploadedById: deal.executor.id });
    const people = { executor: deal.executor, operator: await makeOperator(), client: deal.client, otherExecutor: await makeExecutor(), guest: null };
    expect(await readers(kyc, people)).toEqual(["executor", "operator"]);
    expect(await readers(registration, people)).toEqual(["executor", "operator"]);
  });

  it("скан банковского документа — только оператор, стороны сделки — нет", async () => {
    const deal = await dealAt("PAID_HOLD", { provider: "manual" });
    const hold = await db.moneyTransaction.findFirstOrThrow({ where: { dealId: deal.dealId, type: "HOLD" } });
    expect(hold.bankDocFileId).not.toBeNull();
    const people = { operator: await makeOperator(), client: deal.client, executor: deal.executor, guest: null };
    expect(await readers({ id: hold.bankDocFileId! }, people)).toEqual(["operator"]);
  });

  it("рисунок подписи — подписавший и оператор; другая сторона видит его только в PDF", async () => {
    const deal = await makeDeal();
    const contract = await db.document.findFirstOrThrow({ where: { dealId: deal.dealId, kind: "CONTRACT" } });
    const image = await file({ purpose: "HAND_SIGNATURE", uploadedById: deal.client.id });
    await db.handSignature.create({ data: { documentId: contract.id, userId: deal.client.id, party: "CLIENT", imageFileId: image.id, documentSha256: contract.sha256 } });
    const people = { client: deal.client, operator: await makeOperator(), executor: deal.executor, guest: null };
    expect(await readers(image, people)).toEqual(["client", "operator"]);
  });

  it("неприкреплённый файл — только загрузивший и оператор", async () => {
    const executor = await makeExecutor();
    const photo = await file({ purpose: "DELIVERY", uploadedById: executor.id });
    expect(await readers(photo, { executor, operator: await makeOperator(), other: await makeExecutor() })).toEqual(["executor", "operator"]);
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
