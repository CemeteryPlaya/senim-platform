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
  requireBuyer: async (next: string) => {
    h.asked.push(next);
    return h.user!;
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

  it("чужие диалоги в списке не видны", async () => {
    const mine = await makeOfferThread();
    const other = await makeOfferThread();
    h.user = mine.client;
    const { html } = await list();
    expect(html).toContain(mine.offerId);
    expect(html).not.toContain(other.offerId);
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
    expect(html).not.toContain("<textarea");
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

  it("закрытый чат не принимает сообщение", async () => {
    const thread = await makeOfferThread();
    await db.offer.update({ where: { id: thread.offerId }, data: { chatClosedAt: new Date(), chatClosedReason: "причина" } });
    await signInAs(thread.client);
    expect(await sendMessageAction({ offerId: thread.offerId, text: "привет" })).toMatchObject({ ok: false, code: "CONFLICT" });
  });
});
