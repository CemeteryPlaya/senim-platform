import { beforeEach, describe, expect, it, vi } from "vitest";
import { db, transaction } from "@/platform/db";
import { AppError } from "@/platform/errors";
import { cookieValue, freshBrowser, putCookie } from "../../../test/factories/identity";
import { makeClient, makeExecutor, makeOperator, makeUser } from "../../../test/factories";
import { becomeClient, getCurrentUser, grantRole, requireUserPage, SESSION_COOKIE, startSession, switchRole } from "./session";

vi.mock("next/headers", async () => (await import("../../../test/factories/identity")).nextHeadersMock);

beforeEach(() => freshBrowser());

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

const switches = (userId: string) => db.auditEvent.count({ where: { action: "user.role_switched", entityId: userId } });

/** Исполнитель, который заказывал и как заказчик: обе роли, по умолчанию — исполнитель. */
const dualRole = () => makeExecutor({ roles: ["EXECUTOR", "CLIENT"] });

describe("активная роль", () => {
  it("сессия начинается в роли по умолчанию, роли — все выданные", async () => {
    const person = await dualRole();
    await startSession(person.id);
    expect(await getCurrentUser()).toMatchObject({ role: "EXECUTOR", roles: ["EXECUTOR", "CLIENT"] });
  });

  it("роль, отозванная из выданных, не действует, даже если сессия её помнит", async () => {
    const person = await dualRole();
    await startSession(person.id);
    await switchRole(person, "CLIENT");

    await db.user.update({ where: { id: person.id }, data: { role: "EXECUTOR", roles: ["EXECUTOR"] } });

    expect(await getCurrentUser()).toMatchObject({ role: "EXECUTOR", roles: ["EXECUTOR"] });
  });
});

describe("switchRole", () => {
  it("переключает роль сессии и роль по умолчанию, пишет журнал", async () => {
    const person = await dualRole();
    await startSession(person.id);

    await switchRole(person, "CLIENT");

    expect(await getCurrentUser()).toMatchObject({ role: "CLIENT" });
    expect((await db.user.findUniqueOrThrow({ where: { id: person.id } })).role).toBe("CLIENT");
    expect(await db.auditEvent.findFirstOrThrow({ where: { action: "user.role_switched" } })).toMatchObject({
      actorId: person.id,
      actorRole: "EXECUTOR",
      before: { role: "EXECUTOR" },
      after: { role: "CLIENT" },
    });
  });

  it("роль, которой нет, — FORBIDDEN, сессия не меняется", async () => {
    const client = await makeClient();
    await startSession(client.id);

    expect(await codeOf(switchRole(client, "EXECUTOR"))).toBe("FORBIDDEN");
    expect(await getCurrentUser()).toMatchObject({ role: "CLIENT" });
  });

  it("оператор не переключается в другие роли", async () => {
    const operator = await makeOperator();
    await startSession(operator.id);

    expect(await codeOf(switchRole(operator, "CLIENT"))).toBe("FORBIDDEN");
    expect(await getCurrentUser()).toMatchObject({ role: "OPERATOR" });
  });

  it("без сессии — UNAUTHENTICATED", async () => {
    const person = await dualRole();
    expect(await codeOf(switchRole(person, "CLIENT"))).toBe("UNAUTHENTICATED");
  });

  it("двойной клик: одно переключение в журнале, роль та же", async () => {
    const person = await dualRole();
    await startSession(person.id);

    await Promise.all([switchRole(person, "CLIENT"), switchRole(person, "CLIENT")]);
    await switchRole(person, "CLIENT");

    expect(await switches(person.id)).toBe(1);
    expect(await getCurrentUser()).toMatchObject({ role: "CLIENT" });
  });

  it("переключение на одном устройстве не меняет роль другой открытой сессии", async () => {
    const person = await dualRole();
    await startSession(person.id);
    const phone = cookieValue(SESSION_COOKIE)!;

    freshBrowser();
    await startSession(person.id);
    await switchRole(person, "CLIENT");

    putCookie(SESSION_COOKIE, phone);
    expect(await getCurrentUser()).toMatchObject({ role: "EXECUTOR" });
  });

  it("новый вход начинается в последней активной роли", async () => {
    const person = await dualRole();
    await startSession(person.id);
    await switchRole(person, "CLIENT");

    freshBrowser();
    await startSession(person.id);
    expect(await getCurrentUser()).toMatchObject({ role: "CLIENT" });
  });
});

describe("requireUserPage и роли", () => {
  it("нужная роль есть, но не активна — страница переключения с возвратом", async () => {
    const person = await dualRole();
    await startSession(person.id);

    expect(await redirectTarget(requireUserPage("/requests", "CLIENT"))).toBe("/switch-role?to=CLIENT&returnTo=%2Frequests");
  });

  it("нужной роли нет — вход с пояснением, как раньше", async () => {
    const client = await makeClient();
    await startSession(client.id);

    expect(await redirectTarget(requireUserPage("/executor/requests", "EXECUTOR"))).toBe("/login?next=%2Fexecutor%2Frequests&reason=role");
  });
});

describe("grantRole и becomeClient", () => {
  it("повторная выдача роли ничего не добавляет", async () => {
    const client = await makeClient();
    expect(await transaction((tx) => grantRole(tx, client, "EXECUTOR"))).toBe(true);
    expect(await transaction((tx) => grantRole(tx, client, "EXECUTOR"))).toBe(false);
    expect((await db.user.findUniqueOrThrow({ where: { id: client.id } })).roles).toEqual(["CLIENT", "EXECUTOR"]);
    expect(await db.auditEvent.count({ where: { action: "user.role_granted", entityId: client.id } })).toBe(1);
  });

  it("оператору роли не выдаются, роль оператора не выдаётся никому", async () => {
    const operator = await makeOperator();
    expect(await transaction((tx) => grantRole(tx, operator, "CLIENT"))).toBe(false);
    expect(await codeOf(transaction((tx) => grantRole(tx, operator, "OPERATOR")))).toBe("FORBIDDEN");
    expect((await db.user.findUniqueOrThrow({ where: { id: operator.id } })).roles).toEqual(["OPERATOR"]);
  });

  it("исполнитель становится заказчиком сразу и переходит в эту роль; профиль исполнителя остаётся", async () => {
    const executor = await makeExecutor();
    await startSession(executor.id);

    await becomeClient(executor);
    await becomeClient({ ...executor, roles: ["EXECUTOR", "CLIENT"] });

    expect(await getCurrentUser()).toMatchObject({ role: "CLIENT", roles: ["EXECUTOR", "CLIENT"], executor: { id: executor.executor.id } });
    expect(await db.auditEvent.count({ where: { action: "user.role_granted", entityId: executor.id } })).toBe(1);
  });

  it("стать заказчиком может только исполнитель в своей роли", async () => {
    const client = await makeClient();
    expect(await codeOf(becomeClient(client))).toBe("FORBIDDEN");
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

  it("замерщику роль заказчика не выдаётся", async () => {
    const measurer = await makeUser("MEASURER", "Замерщик");
    expect(await transaction((tx) => grantRole(tx, measurer, "CLIENT"))).toBe(false);
    expect(await codeOf(transaction((tx) => grantRole(tx, measurer, "MEASURER")))).toBe("FORBIDDEN");
    expect((await db.user.findUniqueOrThrow({ where: { id: measurer.id } })).roles).toEqual(["MEASURER"]);
  });
});
