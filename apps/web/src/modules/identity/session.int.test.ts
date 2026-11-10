import { Code, ConnectError } from "@connectrpc/connect";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Role as ProtoRole } from "@/gen/senim/identity/v1/identity_pb";
import { ru } from "@/i18n/ru";
import { db } from "@/platform/db";
import { AppError } from "@/platform/errors";
import { logger } from "@/platform/logger";
import { cookieValue, deletedCookies, freshBrowser, putCookie, setEnv } from "../../../test/factories/identity";
import { makeClient, makeExecutor } from "../../../test/factories";
import { identityFake } from "../../../test/stubs/identity";
import { setIdentityForTests } from "./remote";
import { newSessionToken, sessionCookieName } from "./session-cookie";
import { endSession, getAccessToken, getCurrentUser, getShellUser, requireUserPage, signOutEverywhere } from "./session";

vi.mock("next/headers", async () => (await import("../../../test/factories/identity")).nextHeadersMock);

beforeEach(() => freshBrowser());
afterEach(() => vi.restoreAllMocks());

/** Пользователь identity с сессией, cookie ставится в «браузер». */
function signIn(init: Parameters<typeof identityFake.addUser>[0], activeRole?: ProtoRole) {
  const user = identityFake.addUser(init);
  const token = newSessionToken();
  identityFake.signIn(user.id, token, activeRole);
  putCookie(sessionCookieName(), token);
  return { user, token };
}

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

describe("getCurrentUser через identity", () => {
  it("без cookie — гость, identity не вызывается", async () => {
    expect(await getCurrentUser()).toBeNull();
    expect(identityFake.calls).toHaveLength(0);
  });

  it("cookie не того вида — гость без вызова identity", async () => {
    putCookie(sessionCookieName(), "not-a-token");

    expect(await getCurrentUser()).toBeNull();
    expect(identityFake.calls).toHaveLength(0);
  });

  it("сессия identity даёт пользователя и создаёт проекцию в старой базе", async () => {
    const { user } = signIn({ phone: "+77001234567" });

    expect(await getCurrentUser()).toMatchObject({ id: user.id, phone: "+77001234567", role: "CLIENT", roles: ["CLIENT"], fullName: null, executor: null });
    expect(await db.user.findUniqueOrThrow({ where: { id: user.id } })).toMatchObject({ role: "CLIENT", roles: ["CLIENT"] });
  });

  it("ФИО, ИИН и профиль исполнителя берутся из старой базы", async () => {
    const { executor: profile, ...legacy } = await makeExecutor();
    await db.user.update({ where: { id: legacy.id }, data: { fullName: "Айдос Серик", iinLast4: "5678" } });
    const { user } = signIn({ id: legacy.id, phone: legacy.phone, defaultRole: ProtoRole.EXECUTOR, roles: [ProtoRole.EXECUTOR] });

    expect(await getCurrentUser()).toMatchObject({
      id: user.id,
      role: "EXECUTOR",
      fullName: "Айдос Серик",
      iinLast4: "5678",
      executor: { id: profile.id },
    });
  });

  it("активная роль берётся из сессии identity, а не из роли по умолчанию", async () => {
    signIn({ phone: "+77001234567", roles: [ProtoRole.CLIENT, ProtoRole.EXECUTOR] }, ProtoRole.EXECUTOR);

    expect(await getCurrentUser()).toMatchObject({ role: "EXECUTOR", roles: ["CLIENT", "EXECUTOR"] });
  });

  it("session_invalid — гость, cookie остаётся (удалять её на странице нельзя)", async () => {
    signIn({ phone: "+77001234567" });
    identityFake.failNextWithCode("session_invalid");

    expect(await getCurrentUser()).toBeNull();
    expect(cookieValue(sessionCookieName())).toBeTruthy();
  });

  it("заблокированный пользователь — гость сразу", async () => {
    const { user } = signIn({ phone: "+77001234567" });
    identityFake.block(user.id);

    expect(await getCurrentUser()).toBeNull();
  });

  it("identity недоступен: ошибка «сервис недоступен», cookie на месте", async () => {
    const { token } = signIn({ phone: "+77001234567" });
    identityFake.failNextUnavailable();

    const err = await getCurrentUser().catch((e: unknown) => e);

    expect(err).toBeInstanceOf(AppError);
    expect((err as AppError).code).toBe("UNAVAILABLE");
    expect((err as AppError).message).toBe(ru.common.errors.unavailable);
    expect(cookieValue(sessionCookieName())).toBe(token);
  });

  it("другие сбои identity — общая ошибка без технических деталей", async () => {
    signIn({ phone: "+77001234567" });
    identityFake.failNextWithCode("caller_forbidden");

    const err = await getCurrentUser().catch((e: unknown) => e);

    expect((err as AppError).message).toBe(ru.common.errors.generic);
  });

  it("в проекции есть строка с тем же телефоном и другим id: CONFLICT, а не молчаливый дубль", async () => {
    signIn({ phone: "+77001234567" });
    await db.user.create({ data: { id: "legacy-cuid", phone: "+77001234567", role: "CLIENT", roles: ["CLIENT"] } });

    const err = await getCurrentUser().catch((e: unknown) => e);

    expect((err as AppError).code).toBe("CONFLICT");
    expect(await db.user.count()).toBe(1);
  });

  it("читает cookie только с именем своего контура", async () => {
    const { token } = signIn({ phone: "+77001234567" });
    freshBrowser();
    putCookie("__Host-senim_session", token); // в dev имя другое

    expect(await getCurrentUser()).toBeNull();
  });
});

describe("getAccessToken", () => {
  it("гость — null; вошедший — внутренний токен, тот же Authenticate", async () => {
    expect(await getAccessToken()).toBeNull();

    const { user } = signIn({ phone: "+77001234567" });
    expect(await getAccessToken()).toBe(`fake-access-${user.id}`);
  });
});

describe("выход", () => {
  const callsOf = (method: string) => identityFake.calls.filter((c) => c.method === method).map((c) => c.request as Record<string, unknown>);

  it("endSession: SignOut с токеном и случайным ключом, сессии нет, cookie удалена", async () => {
    const { user, token } = signIn({ phone: "+77001234567" });

    await endSession();

    expect(callsOf("signOut")).toEqual([{ sessionToken: token, idempotencyKey: expect.stringMatching(/^[0-9a-f-]{36}$/) }]);
    expect(identityFake.sessionCount(user.id)).toBe(0);
    expect(cookieValue(sessionCookieName())).toBeUndefined();
  });

  it("вне dev cookie удаляется с теми же параметрами (Secure, Path, SameSite): иначе браузер игнорирует удаление __Host-", async () => {
    setEnv({ APP_ENV: "staging", PAYMENT_PROVIDER: "mock" });
    try {
      const { token } = signIn({ phone: "+77001234567" });
      expect(token).toBeTruthy();
      await endSession();
      signIn({ phone: "+77001234568" });
      await signOutEverywhere();

      expect(deletedCookies).toEqual([
        { name: "__Host-senim_session", options: expect.objectContaining({ secure: true, path: "/", httpOnly: true, sameSite: "lax" }) },
        { name: "__Host-senim_session", options: expect.objectContaining({ secure: true, path: "/" }) },
      ]);
    } finally {
      setEnv({ APP_ENV: undefined, PAYMENT_PROVIDER: undefined });
    }
  });

  it("endSession без cookie или с cookie не того вида: identity не вызывается", async () => {
    await endSession();
    putCookie(sessionCookieName(), "not-a-token");
    await endSession();

    expect(identityFake.calls).toHaveLength(0);
    expect(cookieValue(sessionCookieName())).toBeUndefined();
  });

  it("endSession: сбой identity (кроме недоступности) не мешает выйти", async () => {
    signIn({ phone: "+77001234567" });
    identityFake.failNextWithCode("caller_forbidden");

    await expect(endSession()).resolves.toBeUndefined();
    expect(cookieValue(sessionCookieName())).toBeUndefined();
  });

  it("endSession: identity недоступен — cookie всё равно удалена, человек видит ошибку", async () => {
    signIn({ phone: "+77001234567" });
    identityFake.failNextUnavailable();

    const err = await endSession().catch((e: unknown) => e);

    expect((err as AppError).code).toBe("UNAVAILABLE");
    expect(cookieValue(sessionCookieName())).toBeUndefined();
  });

  it("signOutEverywhere: сначала Authenticate, потом SignOutEverywhere; другие браузеры выходят, cookie удалена", async () => {
    const { user, token: phoneToken } = signIn({ phone: "+77001234567" });
    freshBrowser();
    const laptop = newSessionToken();
    identityFake.signIn(user.id, laptop);
    putCookie(sessionCookieName(), laptop);

    await signOutEverywhere();

    expect(identityFake.calls.map((c) => c.method)).toEqual(["authenticate", "signOutEverywhere"]);
    expect(callsOf("signOutEverywhere")[0]).toMatchObject({ sessionToken: laptop });
    expect(identityFake.sessionCount(user.id)).toBe(0);
    expect(cookieValue(sessionCookieName())).toBeUndefined();
    freshBrowser();
    putCookie(sessionCookieName(), phoneToken);
    expect(await getCurrentUser()).toBeNull();
  });

  it("signOutEverywhere гостя: SignOutEverywhere не вызывается, cookie убирается", async () => {
    putCookie(sessionCookieName(), newSessionToken()); // токен, которого identity не знает

    await signOutEverywhere();

    expect(callsOf("signOutEverywhere")).toHaveLength(0);
    expect(cookieValue(sessionCookieName())).toBeUndefined();
  });

  it("signOutEverywhere: identity недоступен — ошибка, cookie остаётся (человек не вышел)", async () => {
    const { token } = signIn({ phone: "+77001234567" });
    vi.spyOn(identityFake.client, "signOutEverywhere").mockRejectedValueOnce(new ConnectError("unavailable", Code.Unavailable));

    const err = await signOutEverywhere().catch((e: unknown) => e);

    expect((err as AppError).code).toBe("UNAVAILABLE");
    expect(cookieValue(sessionCookieName())).toBe(token);
  });
});

describe("requireUserPage", () => {
  it("гостя отправляет на вход с адресом возврата", async () => {
    expect(await redirectTarget(requireUserPage("/deals/42?tab=1", "CLIENT"))).toBe("/login?next=%2Fdeals%2F42%3Ftab%3D1");
  });

  it("пользователя с другой ролью отправляет на вход с пометкой", async () => {
    signIn({ phone: "+77001234567", defaultRole: ProtoRole.OPERATOR, roles: [ProtoRole.OPERATOR] });

    expect(await redirectTarget(requireUserPage("/requests", "CLIENT"))).toBe("/login?next=%2Frequests&reason=role");
  });

  it("пользователя с нужной ролью пропускает", async () => {
    const client = await makeClient(); // знакомство пройдено: ФИО и ИИН есть
    signIn({ id: client.id, phone: client.phone });

    await expect(requireUserPage("/requests", "CLIENT")).resolves.toMatchObject({ id: client.id });
    await expect(requireUserPage("/anything")).resolves.toMatchObject({ id: client.id });
  });
});

describe("identity недоступен: оболочка и страницы", () => {
  it("getShellUser: гость и признак unavailable, cookie на месте", async () => {
    const { token } = signIn({ phone: "+77001234567" });
    identityFake.failNextUnavailable();

    expect(await getShellUser()).toEqual({ user: null, unavailable: true });
    expect(cookieValue(sessionCookieName())).toBe(token);
  });

  it("getShellUser: обычный гость и вошедший — без признака", async () => {
    expect(await getShellUser()).toEqual({ user: null, unavailable: false });

    signIn({ phone: "+77001234567" });
    const shell = await getShellUser();
    expect(shell.unavailable).toBe(false);
    expect(shell.user).toMatchObject({ phone: "+77001234567" });
  });

  it("getShellUser: конфликт проекции — гость без плашки, запись в лог без телефона и токена", async () => {
    const { token } = signIn({ phone: "+77001234567" });
    await db.user.create({ data: { id: "legacy-cuid", phone: "+77001234567", role: "CLIENT", roles: ["CLIENT"] } });
    const warn = vi.spyOn(logger, "warn");

    expect(await getShellUser()).toEqual({ user: null, unavailable: false });
    expect(warn).toHaveBeenCalledWith("identity.shell_user_conflict", { reason: "projection_conflict" });
    expect(JSON.stringify(warn.mock.calls)).not.toMatch(/7001234567|legacy-cuid/);
    expect(JSON.stringify(warn.mock.calls)).not.toContain(token);
    expect(cookieValue(sessionCookieName())).toBe(token);
  });

  it("requireUserPage пропускает UNAVAILABLE дальше в границу ошибок, без редиректа", async () => {
    signIn({ phone: "+77001234567" });
    identityFake.failNextUnavailable();

    const err = await requireUserPage("/requests", "CLIENT").catch((e: unknown) => e);

    expect(err).toBeInstanceOf(AppError);
    expect((err as AppError).code).toBe("UNAVAILABLE");
    expect((err as { digest?: string }).digest).toBeUndefined();
  });

  it("сессия истекла по простою: requireUserPage уводит на вход с возвратом", async () => {
    signIn({ phone: "+77001234567" });
    identityFake.failNextWithCode("session_invalid");

    expect(await redirectTarget(requireUserPage("/deals/42?tab=1", "CLIENT"))).toBe("/login?next=%2Fdeals%2F42%3Ftab%3D1");
  });

  it("ошибка конфигурации mesh всплывает как есть, а не как ConnectError(Unknown)", async () => {
    signIn({ phone: "+77001234567" });
    setIdentityForTests(null);
    try {
      await expect(getCurrentUser()).rejects.toThrow(/V2_ENABLED/);
    } finally {
      setIdentityForTests(identityFake.client);
    }
  });
});
