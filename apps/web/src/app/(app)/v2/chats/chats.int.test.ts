import { isRedirectError } from "next/dist/client/components/redirect-error";
import { renderToStaticMarkup } from "react-dom/server";
import type { ReactElement } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ru } from "@/i18n/ru";
import { MASK } from "@/modules/companies";
import type { CurrentUser } from "@/modules/identity";
import { db } from "@/platform/db";
import { makeClient } from "../../../../../test/factories";
import { makeOfferThread } from "../../../../../test/factories/companies";
import { freshBrowser } from "../../../../../test/factories/identity";
import { makeOpenRequest } from "../../../../../test/factories/requests";
import { signInAs } from "../../../../../test/factories/session";

const h = vi.hoisted(() => ({ device: "mobile" as "mobile" | "desktop", user: null as CurrentUser | null, asked: [] as string[] }));
vi.mock("@/platform/device", () => ({ getDevice: async () => h.device }));
vi.mock("next/headers", async () => (await import("../../../../../test/factories/identity")).nextHeadersMock);
vi.mock("@/app/(app)/_shell/auth", async (original) => ({
  ...(await original<object>()),
  requireV2User: async () => h.user!,
  // Ворота сторон: пользователь теста и его активная роль (покупатель или мастер) — сторона; адрес возврата запоминается.
  requireParty: async (next: string) => {
    h.asked.push(next);
    const user = h.user!;
    if (user.role !== "CLIENT" && user.role !== "EXECUTOR") throw new Error(`роль не стороны: ${user.role}`);
    return { user, side: user.role };
  },
}));

const { default: ChatsPage } = await import("./page");
const { default: ChatPage } = await import("./[offerId]/page");
const { loadChatAction, sendMessageAction } = await import("./actions");

const t = ru.app.chat;
const primaryCount = (html: string) => html.split("data-primary-action").length - 1;

/** Страница → разметка или 404. */
async function render(make: () => Promise<ReactElement>) {
  try {
    return { html: renderToStaticMarkup(await make()) };
  } catch (e) {
    if (isRedirectError(e)) return { redirect: e.digest.split(";")[2] };
    if (e instanceof Error && "digest" in e && String((e as { digest: unknown }).digest).includes("404")) return { notFound: true as const };
    throw e;
  }
}
const list = () => render(() => ChatsPage());
const room = (offerId: string) => render(() => ChatPage({ params: Promise.resolve({ offerId }) }));

beforeEach(() => {
  h.device = "mobile";
  h.asked = [];
  freshBrowser({ "user-agent": "vitest" });
});

describe("список чатов", () => {
  it("пусто — обучающий экран без кнопки; без заявок нет и ссылки «Мои заявки»", async () => {
    h.user = await makeClient();
    const { html } = await list();
    expect(html).toContain(t.list.emptyTitle);
    expect(html).not.toContain(t.list.myRequests);
    expect(primaryCount(html!)).toBe(0);
  });

  it("пусто, но есть заявка — вторичная ссылка «Мои заявки»", async () => {
    h.user = await makeClient();
    await makeOpenRequest(h.user, { segment: "COMFORT" });
    const { html } = await list();
    expect(html).toContain(t.list.myRequests);
    expect(html).toContain('href="/v2/requests"');
    expect(primaryCount(html!)).toBe(0);
  });

  it("строка — ссылка на диалог v2, а не на путь модуля; до оферты исполнитель — «Исполнитель №N», превью замаскировано", async () => {
    const thread = await makeOfferThread();
    h.user = thread.client;
    await db.message.create({ data: { offerId: thread.offerId, senderId: thread.executor.id, body: "Звоните +7 700 123 45 67" } });
    const { html } = await list();
    expect(html).toContain(`href="/v2/chats/${thread.offerId}"`);
    expect(html).not.toContain("#chat");
    expect(html).toContain(ru.common.executorLabel(thread.executor.executor.publicNumber));
    expect(html).not.toContain("123 45 67");
    expect(html).toContain(MASK);
    expect(primaryCount(html!)).toBe(0);
    expect(html!.split("<h1").length - 1).toBe(1);
  });

  it("диалоги без сообщений в списке не показываются; остался один пустой — обучающий экран; закрытый с сообщением — с чипом", async () => {
    const silent = await makeOfferThread();
    h.user = silent.client;
    const empty = await list();
    expect(empty.html).toContain(t.list.emptyTitle);
    expect(empty.html).not.toContain(silent.offerId);

    const talked = await makeOfferThread({ client: silent.client });
    await db.message.create({ data: { offerId: talked.offerId, senderId: talked.executor.id, body: "Здравствуйте" } });
    await db.offer.update({ where: { id: talked.offerId }, data: { chatClosedAt: new Date(), chatClosedReason: "причина" } });
    const { html } = await list();
    expect(html).toContain(`href="/v2/chats/${talked.offerId}"`);
    expect(html).toContain(t.list.closed);
    expect(html).not.toContain(silent.offerId);
  });

  it("чужие диалоги в списке не видны", async () => {
    const mine = await makeOfferThread();
    const other = await makeOfferThread();
    for (const thread of [mine, other]) await db.message.create({ data: { offerId: thread.offerId, senderId: thread.executor.id, body: "Привет" } });
    h.user = mine.client;
    const { html } = await list();
    expect(html).toContain(mine.offerId);
    expect(html).not.toContain(other.offerId);
  });
});

describe("список чатов мастера", () => {
  const tm = ru.app.masterDeal.chat;

  it("диалоги по своим предложениям: «Покупатель», ссылка на диалог v2; диалоги в роли покупателя не смешиваются", async () => {
    const thread = await makeOfferThread();
    await db.message.create({ data: { offerId: thread.offerId, senderId: thread.client.id, body: "Здравствуйте" } });
    // Тот же человек — покупатель в другом диалоге: в списке мастера его нет.
    const asClient = await makeOfferThread({ client: { ...thread.executor, role: "CLIENT" } });
    await db.message.create({ data: { offerId: asClient.offerId, senderId: asClient.executor.id, body: "Привет" } });
    h.user = { ...thread.executor, role: "EXECUTOR", roles: ["EXECUTOR", "CLIENT"] };
    const { html } = await list();
    expect(html).toContain(`href="/v2/chats/${thread.offerId}"`);
    expect(html).not.toContain(asClient.offerId);
    expect(html).toContain(tm.counterpart);
    expect(html).toContain(`aria-label="${tm.list.label}"`);
    expect(html).not.toMatch(/заказчик|отклик/i);
    expect(primaryCount(html!)).toBe(0);
  });

  it("пусто — обучающий экран мастера и ссылка «Заявки» (одобренному)", async () => {
    const thread = await makeOfferThread();
    h.user = { ...thread.executor, role: "EXECUTOR", roles: ["EXECUTOR"] };
    const { html } = await list();
    expect(html).toContain(tm.list.emptyTitle);
    expect(html).toContain('href="/v2/executor/requests"');
    expect(primaryCount(html!)).toBe(0);
  });
});

describe("экран диалога", () => {
  it("до оферты: «Назад: Чаты», собеседник, системная строка, «Почему?», ссылка на предложение; без главного действия", async () => {
    const thread = await makeOfferThread();
    h.user = thread.client;
    await db.message.create({ data: { offerId: thread.offerId, senderId: thread.executor.id, body: "Здравствуйте" } });
    for (const device of ["mobile", "desktop"] as const) {
      h.device = device;
      const { html } = await room(thread.offerId);
      expect(html).toContain(ru.common.executorLabel(thread.executor.executor.publicNumber));
      expect(html).toContain('href="/v2/chats"');
      expect(html).toContain(ru.app.kit.back);
      expect(html).toContain(t.room.hiddenSystem);
      expect(html).toContain(t.room.why);
      expect(html).toContain(`href="/v2/requests/${thread.requestId}/offers/${thread.offerId}"`);
      expect(html).toContain("Здравствуйте");
      expect(primaryCount(html!)).toBe(0);
      expect(html!.split("<h1").length - 1).toBe(1);
      expect(h.asked.at(-1)).toBe(`/v2/chats/${thread.offerId}`);
    }
  });

  it("после оферты: системной строки и «Почему?» нет, ссылка ведёт на сделку", async () => {
    const thread = await makeOfferThread({ dealStatus: "IN_PROGRESS", requestStatus: "CLOSED" });
    h.user = thread.client;
    const { html } = await room(thread.offerId);
    expect(html).not.toContain(t.room.hiddenSystem);
    expect(html).not.toContain(t.room.why);
    expect(html).toContain(`href="/v2/deals/${thread.dealId}"`);
  });

  it("закрытый чат: поля ввода нет, причина видна", async () => {
    const thread = await makeOfferThread();
    await db.offer.update({ where: { id: thread.offerId }, data: { chatClosedAt: new Date(), chatClosedReason: "Нарушение правил" } });
    h.user = thread.client;
    const { html } = await room(thread.offerId);
    expect(html).toContain(t.room.closedTitle);
    expect(html).toContain("Нарушение правил");
    expect(html).toContain(t.room.closed.operatorClosed);
    expect(html).not.toContain("<textarea");
  });

  it("причина закрытия — свой текст покупателя по коду, без слова «отклик»", async () => {
    const declined = await makeOfferThread({ offerStatus: "DECLINED" });
    h.user = declined.client;
    const { html } = await room(declined.offerId);
    expect(html).toContain(t.room.closed.offerDeclined);
    expect(html).not.toMatch(/[Оо]тклик/);
    const withdrawn = await makeOfferThread({ offerStatus: "WITHDRAWN" });
    h.user = withdrawn.client;
    expect((await room(withdrawn.offerId)).html).toContain(t.room.closed.offerWithdrawn);
  });

  it("кнопка вложения: до оферты её нет и сказано почему, после оферты есть", async () => {
    const before = await makeOfferThread();
    h.user = before.client;
    const early = (await room(before.offerId)).html;
    expect(early).not.toContain(`aria-label="${ru.app.kit.chat.attach}"`);
    expect(early).toContain(t.room.why);
    const after = await makeOfferThread({ dealStatus: "IN_PROGRESS", requestStatus: "CLOSED" });
    h.user = after.client;
    expect((await room(after.offerId)).html).toContain(`aria-label="${ru.app.kit.chat.attach}"`);
  });

  it("вложения: фото сообщения — ссылка «Фото 1» на адрес файла (после оферты)", async () => {
    const thread = await makeOfferThread({ dealStatus: "IN_PROGRESS", requestStatus: "CLOSED" });
    h.user = thread.client;
    const message = await db.message.create({ data: { offerId: thread.offerId, senderId: thread.executor.id, body: "Образец" } });
    await db.storedFile.create({
      data: { storageKey: `message/test/page-${Date.now()}.jpg`, provider: "local", purpose: "MESSAGE", contentType: "image/jpeg", size: 1000, sha256: "6".repeat(64), uploadedById: thread.executor.id, messageId: message.id },
    });
    const { html } = await room(thread.offerId);
    expect(html).toContain(`aria-label="${t.room.photo(1)}"`);
    expect(html).toMatch(/<a href="[^"]*\/api\/files\//);
  });

  it("мастер этого отклика (активная роль мастера): диалог в v2 — «Покупатель», ссылка на заявку мастера; после сделки — на сделку", async () => {
    const tm = ru.app.masterDeal.chat;
    const thread = await makeOfferThread();
    await db.message.create({ data: { offerId: thread.offerId, senderId: thread.client.id, body: "Когда сможете начать?" } });
    h.user = { ...thread.executor, role: "EXECUTOR", roles: ["EXECUTOR", "CLIENT"] };
    for (const device of ["mobile", "desktop"] as const) {
      h.device = device;
      const { html } = await room(thread.offerId);
      expect(html!.match(/<h1[^>]*>([^<]*)<\/h1>/)?.[1]).toBe(tm.counterpart);
      expect(html).toContain(`href="/v2/executor/requests/${thread.requestId}"`);
      expect(html).toContain(tm.room.composerPlaceholder);
      expect(html).toContain("Когда сможете начать?");
      expect(html).toContain(t.room.hiddenSystem);
      expect(html).not.toMatch(/заказчик|отклик/i);
      expect(primaryCount(html!)).toBe(0);
      expect(h.asked.at(-1)).toBe(`/v2/chats/${thread.offerId}`);
    }
    const withDeal = await makeOfferThread({ dealStatus: "IN_PROGRESS", requestStatus: "CLOSED" });
    h.user = { ...withDeal.executor, role: "EXECUTOR", roles: ["EXECUTOR"] };
    expect((await room(withDeal.offerId)).html).toContain(`href="/v2/deals/${withDeal.dealId}"`);
    // Мастер другого отклика: диалог чужой — 404.
    expect(await room(thread.offerId)).toEqual({ notFound: true });
  });

  it("причина закрытия у мастера — его словами: «Вы отозвали предложение»", async () => {
    const withdrawn = await makeOfferThread({ offerStatus: "WITHDRAWN" });
    h.user = { ...withdrawn.executor, role: "EXECUTOR", roles: ["EXECUTOR"] };
    const { html } = await room(withdrawn.offerId);
    expect(html).toContain(ru.app.masterDeal.chat.room.closed.offerWithdrawn);
    expect(html).not.toContain("<textarea");
  });

  it("человек с двумя ролями: диалог, где он сторона в другой роли, — переключение роли с возвратом в диалог; в своей роли — экран", async () => {
    const thread = await makeOfferThread();
    // Активна роль покупателя, а в этом диалоге он мастер.
    h.user = { ...thread.executor, role: "CLIENT", roles: ["EXECUTOR", "CLIENT"] };
    const switched = await room(thread.offerId);
    expect(switched.redirect).toContain("/v2/switch-role?to=EXECUTOR");
    expect(switched.redirect).toContain(encodeURIComponent(`/v2/chats/${thread.offerId}`));
    // Активна роль мастера, а в диалоге он покупатель.
    const asClient = await makeOfferThread();
    h.user = { ...asClient.client, role: "EXECUTOR", roles: ["EXECUTOR", "CLIENT"] };
    expect((await room(asClient.offerId)).redirect).toContain("/v2/switch-role?to=CLIENT");
    // Роль не выдана — переключать не на что: диалог по активной роли чужой — 404.
    h.user = { ...thread.executor, role: "CLIENT", roles: ["CLIENT"] };
    expect(await room(thread.offerId)).toEqual({ notFound: true });
  });

  it("чужой и несуществующий диалог — 404", async () => {
    const thread = await makeOfferThread();
    h.user = await makeClient();
    expect(await room(thread.offerId)).toEqual({ notFound: true });
    expect(await room("no-such-offer")).toEqual({ notFound: true });
  });
});

describe("действия диалога", () => {
  it("отправка: до оферты телефон и ссылка на мессенджер маскируются, ответ — вся лента с новым сообщением", async () => {
    const thread = await makeOfferThread();
    await signInAs(thread.client);
    const result = await sendMessageAction({ offerId: thread.offerId, text: "Мой номер +7 701 555 44 33, пишите https://t.me/some_master" });
    if (!result.ok) throw new Error(result.error);
    const mine = result.data.messages.filter((m) => m.mine);
    expect(mine).toHaveLength(1);
    expect(mine[0].text).toContain(MASK);
    expect(mine[0].text).not.toMatch(/555 44 33|t\.me/);
    expect(result.data.messages[0]).toMatchObject({ kind: "system", text: t.room.hiddenSystem });
    expect(await db.message.count({ where: { offerId: thread.offerId } })).toBe(1);
    expect((await db.message.findFirstOrThrow({ where: { offerId: thread.offerId } })).body).not.toMatch(/555 44 33/);
  });

  it("замаскированное сообщение другой стороны показывается как отдаёт модуль", async () => {
    const thread = await makeOfferThread();
    await signInAs(thread.executor);
    await sendMessageAction({ offerId: thread.offerId, text: "Звоните +7 700 123 45 67" });
    await signInAs(thread.client);
    const loaded = await loadChatAction({ offerId: thread.offerId });
    if (!loaded.ok) throw new Error(loaded.error);
    expect(loaded.data.messages.map((m) => m.text).join("|")).toContain(`Звоните ${MASK}`);
  });

  it("пустое сообщение — ошибка без записи; чужой диалог — NOT_FOUND и для чтения, и для записи", async () => {
    const thread = await makeOfferThread();
    await signInAs(thread.client);
    expect(await sendMessageAction({ offerId: thread.offerId, text: "   " })).toMatchObject({ ok: false, code: "VALIDATION" });
    expect(await db.message.count({ where: { offerId: thread.offerId } })).toBe(0);

    await signInAs(await makeClient());
    expect(await loadChatAction({ offerId: thread.offerId })).toMatchObject({ ok: false, code: "NOT_FOUND" });
    expect(await sendMessageAction({ offerId: thread.offerId, text: "привет" })).toMatchObject({ ok: false, code: "NOT_FOUND" });
    expect(await db.message.count({ where: { offerId: thread.offerId } })).toBe(0);
  });

  it("до оферты фото отвергается сервером: сообщения нет, файл не привязан", async () => {
    const thread = await makeOfferThread();
    await signInAs(thread.client);
    const file = await db.storedFile.create({
      data: { storageKey: `message/test/early-${Date.now()}.jpg`, provider: "local", purpose: "MESSAGE", contentType: "image/jpeg", size: 1000, sha256: "8".repeat(64), uploadedById: thread.client.id },
    });
    expect(await sendMessageAction({ offerId: thread.offerId, text: "Вот стена", fileIds: [file.id] })).toMatchObject({
      ok: false,
      code: "CONFLICT",
      error: ru.companies.chat.errors.attachmentsBeforeOffer,
    });
    expect(await db.message.count({ where: { offerId: thread.offerId } })).toBe(0);
    expect((await db.storedFile.findUniqueOrThrow({ where: { id: file.id } })).messageId).toBeNull();
  });

  it("после оферты: сообщение с фото — файл прикрепляется, лента отдаёт адрес; фото без текста и чужой файл — ошибка без сообщения", async () => {
    const thread = await makeOfferThread({ dealStatus: "IN_PROGRESS", requestStatus: "CLOSED" });
    await signInAs(thread.client);
    const file = (userId: string, tag: string) =>
      db.storedFile.create({
        data: { storageKey: `message/test/${tag}-${Date.now()}.jpg`, provider: "local", purpose: "MESSAGE", contentType: "image/jpeg", size: 1000, sha256: "7".repeat(64), uploadedById: userId },
      });
    const mine = await file(thread.client.id, "mine");
    const sent = await sendMessageAction({ offerId: thread.offerId, text: "Вот стена", fileIds: [mine.id] });
    if (!sent.ok) throw new Error(sent.error);
    const withPhoto = sent.data.messages.find((m) => m.attachments && m.attachments.length > 0);
    expect(withPhoto?.attachments?.map((a) => a.name)).toEqual([t.room.photo(1)]);

    const second = await file(thread.client.id, "second");
    expect(await sendMessageAction({ offerId: thread.offerId, text: "  ", fileIds: [second.id] })).toMatchObject({ ok: false, code: "VALIDATION" });
    const foreign = await file(thread.executor.id, "foreign");
    expect(await sendMessageAction({ offerId: thread.offerId, text: "Чужой", fileIds: [foreign.id] })).toMatchObject({ ok: false });
    expect(await db.message.count({ where: { offerId: thread.offerId } })).toBe(1);
    // Больше предела — схема.
    const many = Array.from({ length: 6 }, (_, i) => `f${i}`);
    expect(await sendMessageAction({ offerId: thread.offerId, text: "много", fileIds: many })).toMatchObject({ ok: false, code: "VALIDATION" });
  });

  it("опрос ограничен по частоте на пользователя: после 60 за минуту — RATE_LIMITED, клиент тихо паузит", async () => {
    const thread = await makeOfferThread();
    await signInAs(thread.client);
    for (let i = 0; i < 60; i += 1) expect(await loadChatAction({ offerId: thread.offerId })).toMatchObject({ ok: true });
    expect(await loadChatAction({ offerId: thread.offerId })).toMatchObject({ ok: false, code: "RATE_LIMITED" });
    // Другой человек не затронут.
    await signInAs(thread.executor);
    expect(await loadChatAction({ offerId: thread.offerId })).toMatchObject({ ok: true });
  });

  it("закрытый чат не принимает сообщение", async () => {
    const thread = await makeOfferThread();
    await db.offer.update({ where: { id: thread.offerId }, data: { chatClosedAt: new Date(), chatClosedReason: "причина" } });
    await signInAs(thread.client);
    expect(await sendMessageAction({ offerId: thread.offerId, text: "привет" })).toMatchObject({ ok: false, code: "CONFLICT" });
  });
});
