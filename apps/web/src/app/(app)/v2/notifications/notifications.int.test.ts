import { isRedirectError } from "next/dist/client/components/redirect-error";
import { renderToStaticMarkup } from "react-dom/server";
import type { ReactElement } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ru } from "@/i18n/ru";
import { unreadCount } from "@/modules/notifications";
import { db } from "@/platform/db";
import { makeClient } from "../../../../../test/factories";
import { freshBrowser } from "../../../../../test/factories/identity";
import { signInAs } from "../../../../../test/factories/session";

const h = vi.hoisted(() => ({ revalidated: [] as unknown[][], user: null as { id: string } | null }));
vi.mock("next/cache", () => ({ revalidatePath: (...args: unknown[]) => h.revalidated.push(args), refresh: vi.fn() }));
vi.mock("next/headers", async () => (await import("../../../../../test/factories/identity")).nextHeadersMock);
vi.mock("@/app/(app)/_shell/auth", async (original) => ({
  ...(await original<object>()),
  requireV2User: async () => h.user!,
}));

const { default: NotificationsPage } = await import("./page");
const { markAllReadForm, openNotificationForm } = await import("./actions");

const t = ru.app.chat.notifications;
const primaryCount = (html: string) => html.split("data-primary-action").length - 1;

const notify = (userId: string, over: { title?: string; link?: string | null; readAt?: Date | null } = {}) =>
  db.notification.create({ data: { userId, kind: "test", title: over.title ?? "Новое предложение", body: "Цена и срок", link: over.link ?? null, readAt: over.readAt ?? null } });

const form = (id: string) => {
  const data = new FormData();
  data.set("id", id);
  return data;
};

/** Форма-действие → куда ведёт переход. */
async function redirectOf(run: () => Promise<void>): Promise<string | null> {
  try {
    await run();
    return null;
  } catch (e) {
    if (isRedirectError(e)) return e.digest.split(";")[2];
    throw e;
  }
}

async function page(params: Record<string, string> = {}): Promise<string> {
  return renderToStaticMarkup((await NotificationsPage({ searchParams: Promise.resolve(params) })) as ReactElement);
}

beforeEach(() => {
  h.revalidated = [];
  freshBrowser({ "user-agent": "vitest" });
});

describe("уведомления: экран", () => {
  it("пусто — обучающий экран; «Прочитать все» нет; главного действия нет", async () => {
    h.user = await makeClient();
    const html = await page();
    expect(html).toContain(t.emptyTitle);
    expect(html).not.toContain(t.markAll);
    expect(primaryCount(html)).toBe(0);
  });

  it("список: непрочитанное помечено для диктора, «Прочитать все» есть; чужие уведомления не видны; «Назад» и один h1", async () => {
    const me = await makeClient();
    h.user = me;
    await notify(me.id, { title: "Мое непрочитанное" });
    await notify(me.id, { title: "Мое прочитанное", readAt: new Date() });
    await notify((await makeClient()).id, { title: "Чужое" });
    const html = await page();
    expect(html).toContain("Мое непрочитанное");
    expect(html).toContain("Мое прочитанное");
    expect(html).not.toContain("Чужое");
    expect(html).toContain(`${t.unread}: `);
    expect(html.split(`${t.unread}: `).length - 1).toBe(1);
    expect(html).toContain(t.markAll);
    expect(html).toContain('href="/v2"');
    expect(primaryCount(html)).toBe(0);
    expect(html.split("<h1").length - 1).toBe(1);
  });
});

describe("уведомления: «Прочитать все» не глотает ошибку", () => {
  it("без сессии — не молчание: переход на список с ?error=1; на странице — сообщение", async () => {
    const me = await makeClient();
    await notify(me.id);
    freshBrowser({ "user-agent": "vitest" });
    expect(await redirectOf(() => markAllReadForm())).toBe("/v2/notifications?error=1");
    expect(await unreadCount(me.id)).toBe(1);
    h.user = me;
    const html = await page({ error: "1" });
    expect(html).toContain(t.markAllFailed);
    expect(await page()).not.toContain(t.markAllFailed);
  });

  it("список обёрнут в section с подписью, а не в nav", async () => {
    const me = await makeClient();
    h.user = me;
    await notify(me.id);
    const html = await page();
    expect(html).toContain(`<section aria-label="${t.label}">`);
    expect(html).not.toContain("<nav");
  });
});

describe("уведомления: действия", () => {
  it("открытие отмечает прочитанным и ведёт на экран v2: сделка, заявка, предложение; слой (app) сбрасывается", async () => {
    const me = await makeClient();
    await signInAs(me);
    const cases = [
      { link: "/deals/d1", to: "/v2/deals/d1" },
      { link: "/requests/r1", to: "/v2/requests/r1" },
      { link: "/requests/r1/offers/o1#chat", to: "/v2/chats/o1" },
    ];
    for (const { link, to } of cases) {
      const n = await notify(me.id, { link });
      expect(await redirectOf(() => openNotificationForm(form(n.id)))).toBe(to);
      expect((await db.notification.findUniqueOrThrow({ where: { id: n.id } })).readAt).not.toBeNull();
    }
    expect(h.revalidated).toHaveLength(cases.length);
    expect(h.revalidated[0]).toEqual(["/(app)", "layout"]);
    expect(await unreadCount(me.id)).toBe(0);
  });

  it("уведомление без ссылки или с чужим сайтом ведёт в список; чужое уведомление не открывается и не читается", async () => {
    const me = await makeClient();
    await signInAs(me);
    const plain = await notify(me.id);
    expect(await redirectOf(() => openNotificationForm(form(plain.id)))).toBe("/v2/notifications");
    const foreign = await notify((await makeClient()).id, { link: "/deals/secret" });
    expect(await redirectOf(() => openNotificationForm(form(foreign.id)))).toBe("/v2/notifications");
    expect((await db.notification.findUniqueOrThrow({ where: { id: foreign.id } })).readAt).toBeNull();
  });

  it("«Прочитать все»: все мои прочитаны, чужие нет, счётчик сброшен через слой (app)", async () => {
    const me = await makeClient();
    const other = await makeClient();
    await signInAs(me);
    await notify(me.id);
    await notify(me.id);
    await notify(other.id);
    await markAllReadForm();
    expect(await unreadCount(me.id)).toBe(0);
    expect(await unreadCount(other.id)).toBe(1);
    expect(h.revalidated).toEqual([["/(app)", "layout"]]);
  });
});
