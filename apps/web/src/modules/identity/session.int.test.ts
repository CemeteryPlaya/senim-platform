import { beforeEach, describe, expect, it, vi } from "vitest";
import { Role as ProtoRole } from "@/gen/senim/identity/v1/identity_pb";
import { ru } from "@/i18n/ru";
import { db } from "@/platform/db";
import { AppError } from "@/platform/errors";
import { cookieValue, freshBrowser, putCookie } from "../../../test/factories/identity";
import { makeClient, makeExecutor, makeOperator } from "../../../test/factories";
import { identityFake } from "../../../test/stubs/identity";
import { newSessionToken, sessionCookieName } from "./session-cookie";
import { endSession, getAccessToken, getCurrentUser, requireUserPage, SESSION_COOKIE, signOutEverywhere, startSession } from "./session";

vi.mock("next/headers", async () => (await import("../../../test/factories/identity")).nextHeadersMock);

beforeEach(() => freshBrowser());

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

describe("сессия, созданная старым входом", () => {
  it("startSession и cookie по-прежнему дают пользователя (до перехода входа на identity)", async () => {
    const operator = await makeOperator();
    await startSession(operator.id, "vitest");

    expect(await getCurrentUser()).toMatchObject({ id: operator.id, role: "OPERATOR" });
  });

  it("новый вход отзывает прежнюю сессию этого браузера", async () => {
    const client = await makeClient();
    await startSession(client.id);
    await startSession(client.id);

    expect(await db.session.count({ where: { revokedAt: null } })).toBe(1);
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

  it("блокировка в старой базе действует сразу", async () => {
    const operator = await makeOperator();
    await startSession(operator.id);
    await db.user.update({ where: { id: operator.id }, data: { blockedAt: new Date() } });

    expect(await getCurrentUser()).toBeNull();
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
