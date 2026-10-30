import { describe, expect, it } from "vitest";
import { db } from "@/platform/db";
import { makeClient, makeExecutor } from "../../../test/factories";
import { makeFurnitureType, makePortfolioItem, makeUploadedFile } from "../../../test/factories/companies";
import {
  attachPortfolioPhotos,
  createPortfolioItem,
  deletePortfolioItem,
  getOwnPortfolioItem,
  listOwnPortfolio,
  MASK,
  removePortfolioPhoto,
  setPortfolioPublished,
  updatePortfolioItem,
  type PortfolioInput,
} from "./index";

async function input(overrides: Partial<PortfolioInput> = {}): Promise<PortfolioInput> {
  const type = await makeFurnitureType({ name: "Кухня" });
  return { furnitureTypeId: type.id, style: "scandi", title: "Светлая кухня", description: "Фасады МДФ", priceFrom: 900_000, published: true, ...overrides };
}

describe("портфолио: своё", () => {
  it("исполнитель создаёт, меняет и видит свои работы", async () => {
    const executor = await makeExecutor();
    const { id } = await createPortfolioItem(executor, await input());
    await updatePortfolioItem(executor, id, await input({ title: "Кухня со столешницей из камня", style: "modern", priceFrom: null }));

    const items = await listOwnPortfolio(executor);
    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({ id, title: "Кухня со столешницей из камня", style: { key: "modern", name: "Современный" }, priceFrom: null, published: true });

    const audit = await db.auditEvent.findMany({ where: { entityId: id }, orderBy: { seq: "asc" } });
    expect(audit.map((a) => a.action)).toEqual(["portfolio.created", "portfolio.updated"]);
  });

  it("контакты и наименование в названии и описании скрываются", async () => {
    const executor = await makeExecutor({ legalName: "ИП Ким Руслан" });
    const { id, masked } = await createPortfolioItem(executor, await input({ title: "Кухня от Ким Руслан", description: "Пишите в WhatsApp" }));
    expect(masked).toBe(true);
    expect(await getOwnPortfolioItem(executor, id)).toMatchObject({ title: `Кухня от ${MASK}`, description: `Пишите в ${MASK}` });
  });

  it("снятие с публикации и удаление", async () => {
    const executor = await makeExecutor();
    const item = await makePortfolioItem(executor);
    await setPortfolioPublished(executor, item.id, false);
    expect(await getOwnPortfolioItem(executor, item.id)).toMatchObject({ published: false });

    await deletePortfolioItem(executor, item.id);
    expect(await db.portfolioItem.count()).toBe(0);
  });

  it("работу, по которой есть заявки «Хочу похожее», удалить нельзя — только снять с публикации", async () => {
    const executor = await makeExecutor();
    const client = await makeClient();
    const item = await makePortfolioItem(executor);
    await db.request.create({ data: { clientId: client.id, mode: "DIRECT", targetExecutorId: executor.executor.id, portfolioItemId: item.id } });
    await expect(deletePortfolioItem(executor, item.id)).rejects.toMatchObject({ code: "CONFLICT" });
  });

  it("неизвестный или выключенный тип мебели, неизвестный стиль — ошибка", async () => {
    const executor = await makeExecutor();
    const off = await makeFurnitureType({ active: false });
    await expect(createPortfolioItem(executor, await input({ furnitureTypeId: off.id }))).rejects.toMatchObject({ code: "VALIDATION" });
    await expect(createPortfolioItem(executor, await input({ style: "gothic" as PortfolioInput["style"] }))).rejects.toMatchObject({ code: "VALIDATION" });
  });
});

describe("портфолио: фото", () => {
  it("свои загруженные фото прикрепляются и открепляются", async () => {
    const executor = await makeExecutor();
    const item = await makePortfolioItem(executor, { photo: false });
    const a = await makeUploadedFile(executor);
    const b = await makeUploadedFile(executor);

    await attachPortfolioPhotos(executor, item.id, [a.id, b.id]);
    expect((await getOwnPortfolioItem(executor, item.id)).photos.map((p) => p.id)).toEqual([a.id, b.id]);

    await removePortfolioPhoto(executor, item.id, a.id);
    expect((await getOwnPortfolioItem(executor, item.id)).photos.map((p) => p.id)).toEqual([b.id]);
  });

  it("чужой файл, файл другого назначения или уже привязанный — отказ", async () => {
    const executor = await makeExecutor();
    const other = await makeExecutor();
    const item = await makePortfolioItem(executor, { photo: false });
    const foreign = await makeUploadedFile(other);
    const chatFile = await makeUploadedFile(executor, "MESSAGE");
    const used = await makeUploadedFile(executor);
    await attachPortfolioPhotos(executor, item.id, [used.id]);

    for (const fileId of [foreign.id, chatFile.id, used.id]) {
      await expect(attachPortfolioPhotos(executor, item.id, [fileId])).rejects.toMatchObject({ code: "VALIDATION" });
    }
  });

  it("не больше 10 фото у работы", async () => {
    const executor = await makeExecutor();
    const item = await makePortfolioItem(executor);
    const files = await Promise.all(Array.from({ length: 10 }, () => makeUploadedFile(executor)));
    await expect(attachPortfolioPhotos(executor, item.id, files.map((f) => f.id))).rejects.toMatchObject({ code: "VALIDATION" });
  });
});

describe("портфолио: чужое (IDOR)", () => {
  it("исполнитель не видит и не меняет чужие работы — как будто их нет", async () => {
    const owner = await makeExecutor();
    const intruder = await makeExecutor();
    const item = await makePortfolioItem(owner);
    const file = await makeUploadedFile(intruder);

    await expect(getOwnPortfolioItem(intruder, item.id)).rejects.toMatchObject({ code: "NOT_FOUND" });
    await expect(updatePortfolioItem(intruder, item.id, await input())).rejects.toMatchObject({ code: "NOT_FOUND" });
    await expect(setPortfolioPublished(intruder, item.id, false)).rejects.toMatchObject({ code: "NOT_FOUND" });
    await expect(deletePortfolioItem(intruder, item.id)).rejects.toMatchObject({ code: "NOT_FOUND" });
    await expect(attachPortfolioPhotos(intruder, item.id, [file.id])).rejects.toMatchObject({ code: "NOT_FOUND" });
    expect(await listOwnPortfolio(intruder)).toEqual([]);
    expect(await db.portfolioItem.findUniqueOrThrow({ where: { id: item.id } })).toMatchObject({ published: true, title: item.title });
  });

  it("заказчик не управляет портфолио", async () => {
    const client = await makeClient();
    await expect(listOwnPortfolio(client)).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(createPortfolioItem(client, await input())).rejects.toMatchObject({ code: "FORBIDDEN" });
  });
});
