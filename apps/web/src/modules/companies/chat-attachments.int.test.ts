import { describe, expect, it } from "vitest";
import { ru } from "@/i18n/ru";
import { db } from "@/platform/db";
import { makeClient, makeOperator } from "../../../test/factories";
import { makeOfferThread } from "../../../test/factories/companies";
import { chatAttachments, getChat, MASK, sendMessage } from "./index";

let n = 0;
const photo = (offerThread: { executor: { id: string } }, messageId: string, sortOrder = 0) => {
  n += 1;
  return db.storedFile.create({
    data: { storageKey: `message/test/${Date.now()}-${n}.jpg`, provider: "local", purpose: "MESSAGE", contentType: "image/jpeg", size: 1000, sha256: "3".repeat(64), uploadedById: offerThread.executor.id, messageId, sortOrder },
  });
};

describe("вложения чата: адреса по id", () => {
  it("обе стороны и оператор получают адреса вложений диалога по порядку; без вложений — пусто", async () => {
    const t = await makeOfferThread();
    expect(await chatAttachments(t.client, t.offerId)).toEqual([]);
    const message = await db.message.create({ data: { offerId: t.offerId, senderId: t.executor.id, body: "Вот образцы" } });
    const second = await photo(t, message.id, 1);
    const first = await photo(t, message.id, 0);

    for (const viewer of [t.client, t.executor, await makeOperator()]) {
      const list = await chatAttachments(viewer, t.offerId);
      expect(list.map((a) => a.id)).toEqual([first.id, second.id]);
      expect(list.every((a) => a.messageId === message.id && a.url.length > 0)).toBe(true);
    }
    // Тот же id вложений, что отдаёт getChat.
    const view = await getChat(t.client, t.offerId);
    expect(view.messages[0].attachments.map((a) => a.id).sort()).toEqual([first.id, second.id].sort());
  });

  it("чужой диалог — NOT_FOUND, адреса не раскрываются", async () => {
    const t = await makeOfferThread();
    const message = await db.message.create({ data: { offerId: t.offerId, senderId: t.executor.id, body: "Образцы" } });
    await photo(t, message.id);
    await expect(chatAttachments(await makeClient(), t.offerId)).rejects.toMatchObject({ code: "NOT_FOUND" });
    await expect(chatAttachments(t.client, "no-such-offer")).rejects.toMatchObject({ code: "NOT_FOUND" });
  });

  const ownFile = (userId: string, tag: string) =>
    db.storedFile.create({
      data: { storageKey: `message/test/${tag}-${Date.now()}.jpg`, provider: "local", purpose: "MESSAGE", contentType: "image/jpeg", size: 1000, sha256: "4".repeat(64), uploadedById: userId },
    });

  it("до оферты вложение отвергнуто, сообщение не создано, файл не прикреплён; текст без вложений — как раньше, с маской", async () => {
    const t = await makeOfferThread({ signed: false });
    const file = await ownFile(t.client.id, "before");
    await expect(sendMessage(t.client, t.offerId, "Вот стена", [file.id])).rejects.toMatchObject({ code: "CONFLICT", message: ru.companies.chat.errors.attachmentsBeforeOffer });
    expect(await db.message.count({ where: { offerId: t.offerId } })).toBe(0);
    expect((await db.storedFile.findUniqueOrThrow({ where: { id: file.id } })).messageId).toBeNull();

    const plain = await sendMessage(t.client, t.offerId, "Звоните +7 700 123 45 67", []);
    expect(plain.masked).toBe(true);
    expect(plain.text).toContain(MASK);
  });

  it("после оферты фото принято: файл прикреплён, адрес виден обеим сторонам; чужой файл не прикрепить", async () => {
    const t = await makeOfferThread({ dealStatus: "IN_PROGRESS", requestStatus: "CLOSED" });
    const own = await ownFile(t.client.id, "own");
    const sent = await sendMessage(t.client, t.offerId, "Вот стена", [own.id]);
    expect(sent.attachments.map((a) => a.id)).toEqual([own.id]);
    expect((await chatAttachments(t.executor, t.offerId)).map((a) => a.id)).toEqual([own.id]);

    const foreign = await ownFile(t.executor.id, "foreign");
    await expect(sendMessage(t.client, t.offerId, "Чужой файл", [foreign.id])).rejects.toBeTruthy();
  });

  it("оператор писать не может ни с вложением, ни без — правило прежнее", async () => {
    const t = await makeOfferThread({ dealStatus: "IN_PROGRESS", requestStatus: "CLOSED" });
    const operator = await makeOperator();
    const file = await ownFile(operator.id, "op");
    await expect(sendMessage(operator, t.offerId, "Текст", [file.id])).rejects.toMatchObject({ code: "FORBIDDEN" });
  });
});
