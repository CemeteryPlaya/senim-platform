import { describe, expect, it } from "vitest";
import { db } from "@/platform/db";
import { makeClient, makeExecutor, makeOperator } from "../../../test/factories";
import { makeOfferThread, withFeature } from "../../../test/factories/companies";
import { dealContacts, getChat, revokeClientPhone, sendMessage, shareClientPhone } from "./index";

/**
 * Контакты сторон (ТЗ п. 3, решение 2.2.10): телефон и Instagram скрыты до заключения оферты
 * (Deal.signedAt), маска чата работает до оферты; после — контакты видны обеим сторонам этой сделки
 * и никому чужому. Телефон заказчика до оферты по согласию — только под флагом clientPhoneConsent.
 */
const code = (p: Promise<unknown>) => p.then(() => "OK", (e: { code?: string }) => e.code ?? String(e));
const PHONE_TEXT = "Звоните +7 701 123 45 67 или пишите в инстаграм @dala_mebel";

async function thread(signed: boolean) {
  const t = await makeOfferThread({ dealStatus: "CREATED", signed, requestStatus: "CONTRACTING" });
  await db.user.update({ where: { id: t.client.id }, data: { instagram: "aigerim.home" } });
  await db.user.update({ where: { id: t.executor.id }, data: { instagram: "dala_mebel" } });
  return { ...t, dealId: t.dealId! };
}

describe("до заключения оферты контакты не раскрываются", () => {
  it("ни заказчику, ни исполнителю этой сделки: ни в карточке сделки, ни в чате", async () => {
    const t = await thread(false);
    expect(await dealContacts(t.client, t.dealId)).toBeNull();
    expect(await dealContacts(t.executor, t.dealId)).toBeNull();
    expect((await getChat(t.client, t.offerId)).contacts).toBeNull();
    expect((await getChat(t.executor, t.offerId)).contacts).toBeNull();
  });

  it("телефоны и Instagram в чате маскируются у обеих сторон", async () => {
    const t = await thread(false);
    const fromClient = await sendMessage(t.client, t.offerId, PHONE_TEXT, []);
    const fromExecutor = await sendMessage(t.executor, t.offerId, PHONE_TEXT, []);
    for (const m of [fromClient, fromExecutor]) {
      expect(m.masked).toBe(true);
      expect(m.text).not.toContain("701");
      expect(m.text).not.toContain("dala_mebel");
    }
  });

  it("чат отклика без сделки — блока контактов нет", async () => {
    const t = await makeOfferThread();
    expect((await getChat(t.client, t.offerId)).contacts).toBeNull();
    expect((await getChat(t.executor, t.offerId)).contacts).toBeNull();
  });
});

describe("после заключения оферты контакты видны сторонам этой сделки", () => {
  it("заказчик видит телефон и Instagram исполнителя, исполнитель — заказчика", async () => {
    const t = await thread(true);
    expect(await dealContacts(t.client, t.dealId)).toEqual({ of: "executor", phone: t.executor.phone, phoneDisplay: expect.any(String), instagram: "dala_mebel" });
    expect(await dealContacts(t.executor, t.dealId)).toEqual({ of: "client", phone: t.client.phone, phoneDisplay: expect.any(String), instagram: "aigerim.home" });
    expect((await getChat(t.client, t.offerId)).contacts).toEqual(await dealContacts(t.client, t.dealId));
    expect((await getChat(t.executor, t.offerId)).contacts).toEqual(await dealContacts(t.executor, t.dealId));
  });

  it("Instagram не указан — только телефон", async () => {
    const t = await thread(true);
    await db.user.update({ where: { id: t.executor.id }, data: { instagram: null } });
    expect(await dealContacts(t.client, t.dealId)).toMatchObject({ phone: t.executor.phone, instagram: null });
  });

  it("чужим — NOT_FOUND: другой заказчик, другой исполнитель, соперник по заявке; оператору блок не нужен", async () => {
    const t = await thread(true);
    const rival = await makeExecutor();
    await db.offer.create({
      data: { requestId: t.requestId, executorId: rival.executor.id, priceTiyn: 800_000_00n, durationDays: 15, warrantyMonths: 12, measurementTerms: "FREE", status: "DECLINED" },
    });
    expect(await code(dealContacts(await makeClient(), t.dealId))).toBe("NOT_FOUND");
    expect(await code(dealContacts(await makeExecutor(), t.dealId))).toBe("NOT_FOUND");
    expect(await code(dealContacts(rival, t.dealId))).toBe("NOT_FOUND");
    expect(await code(dealContacts(t.client, "no-such-deal"))).toBe("NOT_FOUND");
    // Оператор видит телефоны в своей панели, как раньше; в карточке сделки и в чате — без блока контактов.
    const operator = await makeOperator();
    expect(await dealContacts(operator, t.dealId)).toBeNull();
    expect((await getChat(operator, t.offerId)).contacts).toBeNull();
  });

  it("заказчик в роли исполнителя (другая активная роль) контакты своей сделки как заказчик не получает", async () => {
    const t = await thread(true);
    const asExecutor = { ...t.client, role: "EXECUTOR" as const };
    expect(await code(dealContacts(asExecutor, t.dealId))).toBe("NOT_FOUND");
  });

  it("маска в чате больше не применяется; сообщения до оферты остаются маскированными", async () => {
    const t = await thread(false);
    const before = await sendMessage(t.client, t.offerId, PHONE_TEXT, []);
    await db.deal.update({ where: { id: t.dealId }, data: { signedAt: new Date() } });

    const fromClient = await sendMessage(t.client, t.offerId, PHONE_TEXT, []);
    const fromExecutor = await sendMessage(t.executor, t.offerId, PHONE_TEXT, []);
    expect(fromClient).toMatchObject({ text: PHONE_TEXT, masked: false });
    expect(fromExecutor).toMatchObject({ text: PHONE_TEXT, masked: false });
    expect(await db.auditEvent.count({ where: { action: "chat.contacts_masked", entityId: { in: [fromClient.id, fromExecutor.id] } } })).toBe(0);

    const history = (await getChat(t.executor, t.offerId)).messages;
    expect(history.find((m) => m.id === before.id)).toMatchObject({ masked: true });
    expect(history.find((m) => m.id === before.id)?.text).not.toContain("701");
  });
});

describe("телефон заказчика до оферты по согласию (ADR-008) — флаг clientPhoneConsent", () => {
  async function talked(signed = false) {
    const t = await thread(signed);
    await sendMessage(t.executor, t.offerId, "Здравствуйте! Когда удобно приехать?", []);
    await sendMessage(t.client, t.offerId, "Добрый день, в субботу", []);
    return t;
  }

  it("флаг выключен (по умолчанию): кнопки нет, показать — FORBIDDEN, ранее показанный номер исполнитель не видит", async () => {
    await withFeature("clientPhoneConsent", false, async () => {
      const t = await talked();
      expect((await getChat(t.client, t.offerId)).clientPhone).toBeNull();
      expect(await code(shareClientPhone(t.client, t.offerId))).toBe("FORBIDDEN");
      expect(await db.offer.findUniqueOrThrow({ where: { id: t.offerId } })).toMatchObject({ clientPhoneSharedAt: null });

      await db.offer.update({ where: { id: t.offerId }, data: { clientPhoneSharedAt: new Date() } });
      expect((await getChat(t.executor, t.offerId)).clientPhone).toBeNull();
      expect(await dealContacts(t.executor, t.dealId)).toBeNull();
      // Скрыть можно и без флага: отзыв согласия ничего не раскрывает.
      expect(await code(revokeClientPhone(t.client, t.offerId))).toBe("OK");
    });
  });

  it("флаг включён: после переписки заказчик показывает номер, исполнитель его видит — до оферты", async () => {
    await withFeature("clientPhoneConsent", true, async () => {
      const t = await talked();
      expect((await getChat(t.client, t.offerId)).clientPhone).toEqual({ for: "client", shared: false });
      expect(await code(shareClientPhone(t.client, t.offerId))).toBe("OK");
      expect((await getChat(t.executor, t.offerId)).clientPhone).toEqual({ for: "executor", phone: t.client.phone, display: expect.any(String) });
      // Instagram и телефон исполнителя этим путём не раскрываются.
      expect(await dealContacts(t.client, t.dealId)).toBeNull();
    });
  });

  it("флаг включён, оферта заключена: согласие не нужно — кнопки нет, показать — CONFLICT, контакты видны", async () => {
    await withFeature("clientPhoneConsent", true, async () => {
      const t = await talked(true);
      expect((await getChat(t.client, t.offerId)).clientPhone).toBeNull();
      expect(await code(shareClientPhone(t.client, t.offerId))).toBe("CONFLICT");
      expect((await getChat(t.executor, t.offerId)).contacts).toMatchObject({ of: "client", phone: t.client.phone });
    });
  });
});
