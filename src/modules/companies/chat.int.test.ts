import { describe, expect, it } from "vitest";
import { db } from "@/platform/db";
import { makeClient, makeExecutor, makeOperator } from "../../../test/factories";
import { makeOfferThread, makeUploadedFile } from "../../../test/factories/companies";
import { getChat, MASK, sendMessage } from "./index";

describe("чат отклика: стороны", () => {
  it("заказчик и исполнитель переписываются; у каждого своё «я» и подпись собеседника", async () => {
    const t = await makeOfferThread();

    await sendMessage(t.client, t.offerId, "  Здравствуйте! Можно без ручек?  ", []);
    await sendMessage(t.executor, t.offerId, "Да, профиль Gola — плюс 40 000 ₸.", []);

    const forClient = await getChat(t.client, t.offerId);
    expect(forClient.canWrite).toBe(true);
    expect(forClient.messages.map((m) => [m.kind, m.author, m.text])).toEqual([
      ["own", "Вы", "Здравствуйте! Можно без ручек?"],
      ["other", `Исполнитель №${t.executor.executor.publicNumber}`, "Да, профиль Gola — плюс 40 000 ₸."],
    ]);

    const forExecutor = await getChat(t.executor, t.offerId);
    expect(forExecutor.messages.map((m) => [m.kind, m.author])).toEqual([
      ["other", "Заказчик"],
      ["own", "Вы"],
    ]);
  });

  it("второй стороне приходит уведомление со ссылкой на заявку или сделку", async () => {
    const t = await makeOfferThread();
    await sendMessage(t.executor, t.offerId, "Когда удобно приехать на замер?", []);
    const [toClient] = await db.notification.findMany({ where: { userId: t.client.id } });
    expect(toClient).toMatchObject({ kind: "chat.message", link: `/requests/${t.requestId}` });
    expect(toClient.title).toContain(`Исполнитель №${t.executor.executor.publicNumber}`);

    const withDeal = await makeOfferThread({ dealStatus: "IN_PROGRESS", requestStatus: "CLOSED" });
    await sendMessage(withDeal.client, withDeal.offerId, "Аванс отправила", []);
    const [toExecutor] = await db.notification.findMany({ where: { userId: withDeal.executor.id } });
    expect(toExecutor).toMatchObject({ kind: "chat.message", link: `/deals/${withDeal.dealId}` });
  });

  it("контакты маскируются до записи: исходный текст не хранится, факт пишется в журнал", async () => {
    const t = await makeOfferThread();
    const sent = await sendMessage(t.executor, t.offerId, "Звоните +7 700 123 45 67 или в WhatsApp", []);

    expect(sent).toMatchObject({ text: `Звоните ${MASK} или в ${MASK}`, masked: true, kind: "own" });
    const stored = await db.message.findUniqueOrThrow({ where: { id: sent.id } });
    expect(stored).toMatchObject({ body: `Звоните ${MASK} или в ${MASK}`, wasMasked: true });
    expect(JSON.stringify(await db.message.findMany())).not.toContain("123 45 67");

    const notice = await db.notification.findFirstOrThrow({ where: { userId: t.client.id } });
    expect(notice.body).not.toContain("123 45 67");

    const audit = await db.auditEvent.findMany({ where: { action: "chat.contacts_masked" } });
    expect(audit).toHaveLength(1);
    expect(audit[0]).toMatchObject({ actorId: t.executor.id, entityType: "message", entityId: sent.id, scope: `request:${t.requestId}` });
    expect(JSON.stringify({ ...audit[0], seq: String(audit[0].seq) })).not.toContain("123 45 67");
  });
});

describe("чат отклика: анонимность исполнителя", () => {
  it("наименование исполнителя в его сообщении скрыто, у заказчика — только контакты", async () => {
    const t = await makeOfferThread();
    const { legalName } = await db.executorProfile.findUniqueOrThrow({ where: { userId: t.executor.id } });
    const sent = await sendMessage(t.executor, t.offerId, `Это ${legalName}, сделаем за месяц`, []);
    expect(sent.text).not.toContain(legalName.replace(/^ИП\s+/, ""));
    expect(sent.masked).toBe(true);
  });
});

describe("чат отклика: доступ (IDOR)", () => {
  it("чужой заказчик и чужой исполнитель не читают и не пишут — как будто чата нет", async () => {
    const t = await makeOfferThread();
    const strangerClient = await makeClient();
    const strangerExecutor = await makeExecutor();

    for (const stranger of [strangerClient, strangerExecutor]) {
      await expect(getChat(stranger, t.offerId)).rejects.toMatchObject({ code: "NOT_FOUND" });
      await expect(sendMessage(stranger, t.offerId, "привет", [])).rejects.toMatchObject({ code: "NOT_FOUND" });
    }
    expect(await db.message.count()).toBe(0);
  });

  it("исполнитель-заказчик не путаются: исполнитель другого отклика той же заявки не видит этот чат", async () => {
    const t = await makeOfferThread();
    const rival = await makeExecutor();
    await db.offer.create({
      data: { requestId: t.requestId, executorId: rival.executor.id, price: 1, durationDays: 1, warrantyMonths: 1, measurementTerms: "FREE" },
    });
    await expect(getChat(rival, t.offerId)).rejects.toMatchObject({ code: "NOT_FOUND" });
  });

  it("оператор читает, но не пишет", async () => {
    const t = await makeOfferThread();
    await sendMessage(t.client, t.offerId, "Вопрос по замеру", []);
    const operator = await makeOperator();

    const chat = await getChat(operator, t.offerId);
    expect(chat.canWrite).toBe(false);
    expect(chat.messages.map((m) => [m.kind, m.author])).toEqual([["other", "Заказчик"]]);
    await expect(sendMessage(operator, t.offerId, "Я оператор", [])).rejects.toMatchObject({ code: "FORBIDDEN" });
  });

  it("несуществующий отклик — NOT_FOUND", async () => {
    const client = await makeClient();
    await expect(getChat(client, "nope")).rejects.toMatchObject({ code: "NOT_FOUND" });
  });
});

describe("чат отклика: закрытый чат и проверка ввода", () => {
  it("отозванный отклик: история видна, писать нельзя", async () => {
    const t = await makeOfferThread();
    await sendMessage(t.client, t.offerId, "Добрый день", []);
    await db.offer.update({ where: { id: t.offerId }, data: { status: "WITHDRAWN" } });

    const chat = await getChat(t.client, t.offerId);
    expect(chat).toMatchObject({ canWrite: false, closedReason: "Исполнитель отозвал отклик — чат закрыт" });
    expect(chat.messages).toHaveLength(1);
    await expect(sendMessage(t.client, t.offerId, "Ещё вопрос", [])).rejects.toMatchObject({ code: "CONFLICT" });
  });

  it("пустое и слишком длинное сообщение отклоняются", async () => {
    const t = await makeOfferThread();
    await expect(sendMessage(t.client, t.offerId, "   ", [])).rejects.toMatchObject({ code: "VALIDATION" });
    await expect(sendMessage(t.client, t.offerId, "а".repeat(2001), [])).rejects.toMatchObject({ code: "VALIDATION" });
  });
});

describe("чат отклика: вложения", () => {
  it("свой загруженный файл привязывается к сообщению", async () => {
    const t = await makeOfferThread();
    const file = await makeUploadedFile(t.client, "MESSAGE");
    const sent = await sendMessage(t.client, t.offerId, "Фото кухни", [file.id]);
    expect(sent.attachments).toEqual([{ id: file.id }]);
    expect(await db.storedFile.findUniqueOrThrow({ where: { id: file.id } })).toMatchObject({ messageId: sent.id });
  });

  it("чужой, уже привязанный или не тот файл — отказ, сообщение не создаётся", async () => {
    const t = await makeOfferThread();
    const foreign = await makeUploadedFile(t.executor, "MESSAGE");
    const portfolioFile = await makeUploadedFile(t.client, "PORTFOLIO");
    const used = await makeUploadedFile(t.client, "MESSAGE");
    await sendMessage(t.client, t.offerId, "первое", [used.id]);

    for (const fileId of [foreign.id, portfolioFile.id, used.id, "nope"]) {
      await expect(sendMessage(t.client, t.offerId, "с файлом", [fileId])).rejects.toMatchObject({ code: "VALIDATION" });
    }
    expect(await db.message.count()).toBe(1);
  });
});
