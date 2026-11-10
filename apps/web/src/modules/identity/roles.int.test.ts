import { Code, ConnectError } from "@connectrpc/connect";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { db } from "@/platform/db";
import { AppError } from "@/platform/errors";
import { freshBrowser, putCookie } from "../../../test/factories/identity";
import { signInAs } from "../../../test/factories/session";
import { makeClient, makeExecutor, makeUser } from "../../../test/factories";
import { identityFake } from "../../../test/stubs/identity";
import { sessionCookieName } from "./session-cookie";
import { becomeClient, getCurrentUser, requireUserPage, switchRole } from "./session";

vi.mock("next/headers", async () => (await import("../../../test/factories/identity")).nextHeadersMock);

beforeEach(() => freshBrowser());
afterEach(() => vi.restoreAllMocks());

async function codeOf(p: Promise<unknown>): Promise<string> {
  const e = await p.then(
    () => null,
    (err: unknown) => err,
  );
  if (!(e instanceof AppError)) throw new Error(`ожидалась AppError, получено: ${String(e)}`);
  return e.code;
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

/** Исполнитель, который заказывал и как заказчик: обе роли, по умолчанию — исполнитель. */
const dualRole = () => makeExecutor({ roles: ["EXECUTOR", "CLIENT"] });

describe("активная роль", () => {
  it("сессия начинается в роли по умолчанию, роли — все выданные", async () => {
    const person = await dualRole();
    await signInAs(person);
    expect(await getCurrentUser()).toMatchObject({ role: "EXECUTOR", roles: ["EXECUTOR", "CLIENT"] });
  });

  it("вход сразу в другую выданную роль", async () => {
    const person = await dualRole();
    await signInAs(person, "CLIENT");
    expect(await getCurrentUser()).toMatchObject({ role: "CLIENT", roles: ["EXECUTOR", "CLIENT"] });
  });
});

describe("switchRole", () => {
  it("переключает роль сессии, после этого проекция в новой роли", async () => {
    const person = await dualRole();
    await signInAs(person);

    await switchRole(person, "CLIENT");

    expect(await getCurrentUser()).toMatchObject({ role: "CLIENT" });
    expect((await db.user.findUniqueOrThrow({ where: { id: person.id } })).role).toBe("CLIENT");
    expect(identityFake.calls.filter((c) => c.method === "switchRole")).toHaveLength(1);
  });

  it("роль, которой нет, — FORBIDDEN, сессия не меняется", async () => {
    const client = await makeClient();
    await signInAs(client);

    expect(await codeOf(switchRole(client, "EXECUTOR"))).toBe("FORBIDDEN");
    expect(await getCurrentUser()).toMatchObject({ role: "CLIENT" });
  });

  it("без сессии — UNAUTHENTICATED, identity не вызывается", async () => {
    const person = await dualRole();
    expect(await codeOf(switchRole(person, "CLIENT"))).toBe("UNAUTHENTICATED");
    expect(identityFake.calls).toHaveLength(0);
  });

  it("сессия недействительна (простой, отзыв) — UNAUTHENTICATED", async () => {
    const person = await dualRole();
    await signInAs(person);
    identityFake.failNextWithCode("session_invalid");

    expect(await codeOf(switchRole(person, "CLIENT"))).toBe("UNAUTHENTICATED");
  });

  it("двойной клик: оба вызова проходят, роль та же", async () => {
    const person = await dualRole();
    await signInAs(person);

    await Promise.all([switchRole(person, "CLIENT"), switchRole(person, "CLIENT")]);
    await switchRole(person, "CLIENT");

    expect(await getCurrentUser()).toMatchObject({ role: "CLIENT" });
  });

  it("переключение на одном устройстве не меняет роль другой открытой сессии", async () => {
    const person = await dualRole();
    const phoneToken = await signInAs(person);

    freshBrowser();
    await signInAs(person);
    await switchRole(person, "CLIENT");

    freshBrowser();
    putCookie(sessionCookieName(), phoneToken);
    expect(await getCurrentUser()).toMatchObject({ role: "EXECUTOR" });
  });

  it("новый вход начинается в последней активной роли", async () => {
    const person = await dualRole();
    await signInAs(person);
    await switchRole(person, "CLIENT");

    freshBrowser();
    await signInAs(person);
    expect(await getCurrentUser()).toMatchObject({ role: "CLIENT" });
  });
});

describe("requireUserPage и роли", () => {
  it("нужная роль есть, но не активна — страница переключения с возвратом", async () => {
    const person = await dualRole();
    await signInAs(person);

    expect(await redirectTarget(requireUserPage("/requests", "CLIENT"))).toBe("/switch-role?to=CLIENT&returnTo=%2Frequests");
  });

  it("нужной роли нет — вход с пояснением, как раньше", async () => {
    const client = await makeClient();
    await signInAs(client);

    expect(await redirectTarget(requireUserPage("/executor/requests", "EXECUTOR"))).toBe("/login?next=%2Fexecutor%2Frequests&reason=role");
  });
});

describe("becomeClient", () => {
  it("исполнитель становится заказчиком сразу и переходит в эту роль; профиль исполнителя остаётся", async () => {
    const executor = await makeExecutor();
    await signInAs(executor);

    await becomeClient(executor);
    await becomeClient({ ...executor, roles: ["EXECUTOR", "CLIENT"] });

    expect(await getCurrentUser()).toMatchObject({ role: "CLIENT", roles: ["EXECUTOR", "CLIENT"], executor: { id: executor.executor.id } });
    expect(identityFake.calls.filter((c) => c.method === "grantRole").map((c) => (c.request as { role: number }).role)).toEqual([1, 1]);
  });

  it("стать заказчиком может только исполнитель в своей роли", async () => {
    const client = await makeClient();
    expect(await codeOf(becomeClient(client))).toBe("FORBIDDEN");
    expect(identityFake.calls).toHaveLength(0);
  });

  it("роль выдана, а переключение не прошло: повтор довершает дело, роль одна", async () => {
    const executor = await makeExecutor();
    await signInAs(executor);
    vi.spyOn(identityFake.client, "switchRole").mockRejectedValueOnce(new ConnectError("unavailable", Code.Unavailable));

    await expect(becomeClient(executor)).rejects.toMatchObject({ code: "UNAVAILABLE" });
    await becomeClient(executor);

    expect(await getCurrentUser()).toMatchObject({ role: "CLIENT", roles: ["EXECUTOR", "CLIENT"] });
  });
});

describe("ограничения БД", () => {
  it("роль по умолчанию — одна из выданных", async () => {
    await expect(makeUser("CLIENT", "Без роли", ["EXECUTOR"])).rejects.toThrow();
  });

  it("оператор не совмещается с другими ролями", async () => {
    await expect(makeUser("OPERATOR", "Оператор-заказчик", ["OPERATOR", "CLIENT"])).rejects.toThrow();
  });

  it("замерщик площадки не совмещается с другими ролями", async () => {
    await expect(makeUser("MEASURER", "Замерщик-заказчик", ["MEASURER", "CLIENT"])).rejects.toThrow();
    await expect(makeUser("CLIENT", "Заказчик-замерщик", ["CLIENT", "MEASURER"])).rejects.toThrow();
    await expect(makeUser("MEASURER", "Замерщик")).resolves.toMatchObject({ roles: ["MEASURER"] });
  });
});
