import { afterEach, describe, expect, it } from "vitest";
import { db } from "@/platform/db";
import { resetEnvCache } from "@/platform/env";
import { makeClient, makeExecutor, makeOperator, makeUser } from "../../../test/factories";
import { makeFurnitureType, makeOfferThread } from "../../../test/factories/companies";
import { MASK } from "./mask";
import { EXECUTOR_IDENTITY_KEY } from "./identity-mode";
import { listChats, sendMessage } from "./index";

afterEach(() => {
  delete process.env.DEMO_MODE;
  resetEnvCache();
});

describe("список чатов: владение", () => {
  it("заказчик видит только свои отклики, исполнитель — только свои", async () => {
    const mine = await makeOfferThread();
    const other = await makeOfferThread();
    const sameClient = await makeOfferThread({ client: mine.client });

    const forClient = await listChats(mine.client);
    expect(forClient.map((c) => c.offerId).sort()).toEqual([mine.offerId, sameClient.offerId].sort());
    expect(forClient.map((c) => c.offerId)).not.toContain(other.offerId);

    const forExecutor = await listChats(mine.executor);
    expect(forExecutor.map((c) => c.offerId)).toEqual([mine.offerId]);
  });

  it("оператор, замерщик и посторонний получают пустой список", async () => {
    await makeOfferThread();
    expect(await listChats(await makeOperator())).toEqual([]);
    expect(await listChats(await makeUser("MEASURER"))).toEqual([]);
    expect(await listChats(await makeClient())).toEqual([]);
    expect(await listChats(await makeExecutor())).toEqual([]);
  });

  it("роль решает, чей это чат: исполнитель в роли заказчика своих откликов не видит", async () => {
    const t = await makeOfferThread();
    expect(await listChats({ ...t.executor, role: "CLIENT" })).toEqual([]);
    expect(await listChats({ ...t.client, role: "EXECUTOR" })).toEqual([]);
  });
});

describe("список чатов: превью и сортировка", () => {
  it("превью — замаскированный текст; исходный телефон в БД не попал даже при обходе сервиса", async () => {
    const t = await makeOfferThread();
    await sendMessage(t.executor, t.offerId, "Звоните +7 700 123 45 67", []);
    const [viaService] = await listChats(t.client);
    expect(viaService.lastMessage).toBe(`Звоните ${MASK}`);

    // Строка, записанная в обход сервиса (до оферты), всё равно маскируется в превью.
    await db.message.create({ data: { offerId: t.offerId, senderId: t.executor.id, body: "Пишите на a.b@mail.kz или +7 701 555 44 33" } });
    const [raw] = await listChats(t.client);
    expect(raw.lastMessage).not.toMatch(/mail\.kz|555 44 33/);
    expect(raw.lastMessage).toContain(MASK);
  });

  it("после оферты текст как есть; чат без сообщений — lastMessage и lastAt пусты; сортировка по lastAt убыв.", async () => {
    const client = await makeClient();
    const empty = await makeOfferThread({ client });
    const older = await makeOfferThread({ client });
    const newer = await makeOfferThread({ client, dealStatus: "IN_PROGRESS", requestStatus: "CLOSED" });
    await sendMessage(older.executor, older.offerId, "Первое", []);
    await sendMessage(newer.executor, newer.offerId, "Мой номер +7 700 123 45 67", []);

    const list = await listChats(client);
    expect(list.map((c) => c.offerId)).toEqual([newer.offerId, older.offerId, empty.offerId]);
    expect(list[0].lastMessage).toBe("Мой номер +7 700 123 45 67");
    expect(list[0].lastAt).toBeInstanceOf(Date);
    expect(list[2]).toMatchObject({ lastMessage: null, lastAt: null });
  });
});

describe("список чатов: собеседник и заголовок", () => {
  it("до оферты заказчику — «Исполнитель №N» (имя скрыто), исполнителю — «Заказчик»; имя клиента не раскрывается", async () => {
    const t = await makeOfferThread();
    const [c] = await listChats(t.client);
    expect(c.counterpart).toBe(`Исполнитель №${t.executor.executor.publicNumber}`);
    const [e] = await listChats(t.executor);
    expect(e.counterpart).toBe("Заказчик");
    expect(JSON.stringify(e)).not.toContain(t.client.fullName);
    expect(JSON.stringify(c)).not.toContain(t.executor.phone);
  });

  it("режим «имя показано» меняет подпись так же, как в чате", async () => {
    process.env.DEMO_MODE = "true";
    resetEnvCache();
    await db.platformSetting.create({ data: { key: EXECUTOR_IDENTITY_KEY, value: "SHOWN" } });
    const t = await makeOfferThread();
    const { legalName } = await db.executorProfile.findUniqueOrThrow({ where: { id: t.executor.executor.id } });
    const [c] = await listChats(t.client);
    expect(c.counterpart).toContain(legalName);
  });

  it("заголовок — тип изделия и город заявки; ссылка ведёт на существующий экран отклика или сделки", async () => {
    const type = await makeFurnitureType({ name: "Кухня" });
    const t = await makeOfferThread();
    await db.request.update({ where: { id: t.requestId }, data: { furnitureTypeId: type.id, city: "Астана" } });
    const [c] = await listChats(t.client);
    expect(c.title).toBe("Кухня · Астана");
    expect(c.href).toBe(`/requests/${t.requestId}/offers/${t.offerId}#chat`);
    const [e] = await listChats(t.executor);
    expect(e.href).toBe(`/executor/requests/${t.requestId}#chat`);

    const d = await makeOfferThread({ dealStatus: "IN_PROGRESS", requestStatus: "CLOSED" });
    expect((await listChats(d.client))[0].href).toBe(`/deals/${d.dealId}#chat`);
    expect((await listChats(d.executor))[0].href).toBe(`/deals/${d.dealId}#chat`);
  });

  it("closed: отозванный отклик и закрытие оператором", async () => {
    const open = await makeOfferThread();
    const withdrawn = await makeOfferThread({ client: open.client, offerStatus: "WITHDRAWN" });
    const byOperator = await makeOfferThread({ client: open.client });
    await db.offer.update({ where: { id: byOperator.offerId }, data: { chatClosedAt: new Date(), chatClosedReason: "спор" } });
    const closed = new Map((await listChats(open.client)).map((c) => [c.offerId, c.closed]));
    expect(closed.get(open.offerId)).toBe(false);
    expect(closed.get(withdrawn.offerId)).toBe(true);
    expect(closed.get(byOperator.offerId)).toBe(true);
  });
});

describe("список чатов: предел", () => {
  it("не больше 100 диалогов; с перепиской идут раньше пустых", async () => {
    const client = await makeClient();
    const threads = [];
    for (let i = 0; i < 102; i += 1) threads.push(await makeOfferThread({ client }));
    const talked = threads[0];
    await db.message.create({ data: { offerId: talked.offerId, senderId: talked.executor.id, body: "Здравствуйте" } });

    const list = await listChats(client);
    expect(list).toHaveLength(100);
    expect(list[0].offerId).toBe(talked.offerId);
  }, 60_000);
});
