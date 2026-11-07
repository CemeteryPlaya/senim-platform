import { beforeEach, describe, expect, it, vi } from "vitest";
import { db } from "@/platform/db";
import { cookieValue, freshBrowser, putCookie } from "../../../test/factories/identity";
import { makeClient, makeOperator } from "../../../test/factories";
import { endSession, getCurrentUser, requireUserPage, SESSION_COOKIE, signOutEverywhere, startSession } from "./session";

vi.mock("next/headers", async () => (await import("../../../test/factories/identity")).nextHeadersMock);

beforeEach(() => freshBrowser());

const minutesAgo = (m: number) => new Date(Date.now() - m * 60_000);

/** Куда ведёт redirect() из next/navigation (он бросает ошибку с digest). */
async function redirectTarget(p: Promise<unknown>): Promise<string | null> {
  try {
    await p;
    return null;
  } catch (e) {
    const digest = (e as { digest?: string }).digest ?? "";
    if (!digest.startsWith("NEXT_REDIRECT")) throw e;
    return digest.split(";")[2];
  }
}

describe("сессия", () => {
  it("без cookie пользователя нет; после входа — есть", async () => {
    const client = await makeClient();
    expect(await getCurrentUser()).toBeNull();

    await startSession(client.id, "vitest");

    expect(await getCurrentUser()).toMatchObject({ id: client.id, role: "CLIENT" });
  });

  it("новый вход отзывает прежнюю сессию этого браузера", async () => {
    const client = await makeClient();
    await startSession(client.id);
    await startSession(client.id);

    expect(await db.session.count({ where: { revokedAt: null } })).toBe(1);
  });

  it("lastSeenAt обновляется не чаще раза в 10 минут", async () => {
    const client = await makeClient();
    await startSession(client.id);

    const recent = minutesAgo(5);
    await db.session.updateMany({ data: { lastSeenAt: recent } });
    await getCurrentUser();
    expect((await db.session.findFirstOrThrow()).lastSeenAt).toEqual(recent);

    await db.session.updateMany({ data: { lastSeenAt: minutesAgo(15) } });
    await getCurrentUser();
    expect((await db.session.findFirstOrThrow()).lastSeenAt.getTime()).toBeGreaterThan(minutesAgo(1).getTime());
  });

  it("выход отзывает сессию и удаляет cookie", async () => {
    const client = await makeClient();
    await startSession(client.id);

    await endSession();

    expect(cookieValue(SESSION_COOKIE)).toBeUndefined();
    expect(await db.session.count({ where: { revokedAt: null } })).toBe(0);
  });

  it("выход со всех устройств отзывает сессии в других браузерах", async () => {
    const client = await makeClient();
    await startSession(client.id); // телефон
    const phoneToken = cookieValue(SESSION_COOKIE)!;
    freshBrowser();
    await startSession(client.id); // ноутбук

    await signOutEverywhere();

    expect(await db.session.count({ where: { userId: client.id, revokedAt: null } })).toBe(0);
    freshBrowser();
    putCookie(SESSION_COOKIE, phoneToken);
    expect(await getCurrentUser()).toBeNull();
  });

  it("заблокированный пользователь теряет доступ сразу", async () => {
    const client = await makeClient();
    await startSession(client.id);
    await db.user.update({ where: { id: client.id }, data: { blockedAt: new Date() } });

    expect(await getCurrentUser()).toBeNull();
  });
});

describe("requireUserPage", () => {
  it("гостя отправляет на вход с адресом возврата", async () => {
    expect(await redirectTarget(requireUserPage("/deals/42?tab=1", "CLIENT"))).toBe("/login?next=%2Fdeals%2F42%3Ftab%3D1");
  });

  it("пользователя с другой ролью отправляет на вход с пометкой", async () => {
    const operator = await makeOperator();
    await startSession(operator.id);

    expect(await redirectTarget(requireUserPage("/requests", "CLIENT"))).toBe("/login?next=%2Frequests&reason=role");
  });

  it("пользователя с нужной ролью пропускает", async () => {
    const client = await makeClient();
    await startSession(client.id);

    await expect(requireUserPage("/requests", "CLIENT")).resolves.toMatchObject({ id: client.id });
    await expect(requireUserPage("/anything")).resolves.toMatchObject({ id: client.id });
  });
});
