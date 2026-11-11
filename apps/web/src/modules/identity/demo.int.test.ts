import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { seedDemo } from "@/demo/seed";
import { db } from "@/platform/db";
import { AppError } from "@/platform/errors";
import { useSeedStorage } from "../../../test/factories/documents";
import { cookieValue, freshBrowser, makeDemoPersona, setEnv } from "../../../test/factories/identity";
import { mirrorUser, signInAs } from "../../../test/factories/session";
import { identityFake } from "../../../test/stubs/identity";
import { listDemoPersonas, loginAsDemoPersona } from "./demo";
import { getCurrentUser } from "./session";
import { sessionCookieName } from "./session-cookie";

vi.mock("next/headers", async () => (await import("../../../test/factories/identity")).nextHeadersMock);

let cleanup: () => Promise<void>;
beforeAll(async () => {
  cleanup = await useSeedStorage();
});
afterAll(() => cleanup());

beforeEach(() => {
  freshBrowser();
  setEnv({ DEMO_MODE: "true" });
});

async function codeOf(p: Promise<unknown>): Promise<string> {
  const e = await p.then(
    () => null,
    (err: unknown) => err,
  );
  if (!(e instanceof AppError)) throw new Error(`ожидалась AppError, получено: ${String(e)}`);
  return e.code;
}

describe("демо-персоны при DEMO_MODE=true", () => {
  it("список — только пользователи с isDemo", async () => {
    const demo = await makeDemoPersona("CLIENT", "+77000007001");
    await makeDemoPersona("CLIENT", "+77000007002", false);

    expect((await listDemoPersonas()).map((p) => p.id)).toEqual([demo.id]);
  });

  it("вход персоной одним нажатием ставит сессию", async () => {
    const demo = await makeDemoPersona("OPERATOR", "+77000007003");
    await mirrorUser(demo.id);

    expect(await loginAsDemoPersona(demo.id, "vitest")).toEqual({ id: demo.id, role: "OPERATOR", executor: null });

    expect(await getCurrentUser()).toMatchObject({ id: demo.id, role: "OPERATOR", isDemo: true });
  });

  it("вход в указанной роли — шаг показа банку открывается сразу в нужной роли (ADR-004)", async () => {
    const demo = await makeDemoPersona("EXECUTOR", "+77000007008");
    await db.user.update({ where: { id: demo.id }, data: { roles: ["EXECUTOR", "CLIENT"] } });
    await mirrorUser(demo.id);

    expect(await loginAsDemoPersona(demo.id, "vitest", "CLIENT")).toMatchObject({ id: demo.id, role: "CLIENT" });
    expect(await getCurrentUser()).toMatchObject({ id: demo.id, role: "CLIENT", roles: ["EXECUTOR", "CLIENT"] });
    // Роль по умолчанию не меняется: это вход ведущего, а не выбор пользователя.
    expect((await db.user.findUniqueOrThrow({ where: { id: demo.id } })).role).toBe("EXECUTOR");
  });

  it("невыданная роль при входе отклоняется, сессия не создаётся", async () => {
    const demo = await makeDemoPersona("CLIENT", "+77000007009");
    await mirrorUser(demo.id);

    expect(await codeOf(loginAsDemoPersona(demo.id, "vitest", "OPERATOR"))).toBe("FORBIDDEN");
    expect(identityFake.sessionCount()).toBe(0);
  });

  it("вход возвращает статус профиля исполнителя из старой базы", async () => {
    const demo = await makeDemoPersona("EXECUTOR", "+77000007010");
    await db.executorProfile.create({
      data: { userId: demo.id, legalForm: "IP", legalName: "ИП Демо", binIinLast4: "0000", status: "PENDING" },
    });
    await mirrorUser(demo.id);

    expect(await loginAsDemoPersona(demo.id, "vitest")).toMatchObject({ id: demo.id, role: "EXECUTOR", executor: { status: "PENDING" } });
  });

  it("новый демо-вход отзывает прежнюю сессию браузера; токен, ключ и user-agent передаются в identity", async () => {
    const first = await makeDemoPersona("CLIENT", "+77000007011");
    const second = await makeDemoPersona("OPERATOR", "+77000007012");
    const oldToken = await signInAs(first);
    await mirrorUser(second.id);

    await loginAsDemoPersona(second.id, "vitest");

    expect(identityFake.sessionCount(first.id)).toBe(0);
    expect(await getCurrentUser()).toMatchObject({ id: second.id });
    const request = identityFake.calls.find((c) => c.method === "startDemoSession")?.request as Record<string, unknown>;
    expect(request).toMatchObject({ userId: second.id, userAgent: "vitest", sessionToken: cookieValue(sessionCookieName()) });
    expect(request.sessionToken).not.toBe(oldToken);
    expect(request.idempotencyKey).toMatch(/^[0-9a-f-]{36}$/);
  });

  it("отказ при входе персоной (роль не выдана, нет персоны) прежнюю сессию не трогает", async () => {
    const person = await makeDemoPersona("CLIENT", "+77000007014");
    const oldToken = await signInAs(person);

    expect(await codeOf(loginAsDemoPersona(person.id, "vitest", "OPERATOR"))).toBe("FORBIDDEN");
    const stranger = await makeDemoPersona("CLIENT", "+77000007015", false);
    await mirrorUser(stranger.id);
    expect(await codeOf(loginAsDemoPersona(stranger.id))).toBe("NOT_FOUND");

    expect(identityFake.calls.filter((c) => c.method === "signOut")).toHaveLength(0);
    expect(cookieValue(sessionCookieName())).toBe(oldToken);
    expect(await getCurrentUser()).toMatchObject({ id: person.id });
  });

  it("не-демо пользователь недоступен, даже если знать его id", async () => {
    const real = await makeDemoPersona("CLIENT", "+77000007004", false);
    await mirrorUser(real.id);

    expect(await codeOf(loginAsDemoPersona(real.id))).toBe("NOT_FOUND");
    expect(cookieValue(sessionCookieName())).toBeUndefined();
    expect(identityFake.sessionCount()).toBe(0);
  });

  it("заблокированная демо-персона недоступна", async () => {
    const demo = await makeDemoPersona("CLIENT", "+77000007005");
    await db.user.update({ where: { id: demo.id }, data: { blockedAt: new Date() } });
    await mirrorUser(demo.id);

    expect(await codeOf(loginAsDemoPersona(demo.id))).toBe("NOT_FOUND");
  });

  it("работает для каждой персоны из сида", async () => {
    await seedDemo(db); // люди сида заводятся в identity (SeedUsers) с теми же id
    const personas = await listDemoPersonas();

    expect(personas).toHaveLength(15); // с замерщиком площадки (ADR-005)
    for (const persona of personas) {
      freshBrowser();
      await loginAsDemoPersona(persona.id);
      expect(await getCurrentUser()).toMatchObject({ id: persona.id, role: persona.role, roles: persona.roles });
    }
    // Одна персона с двумя ролями (ADR-004): исполнитель, который заказывал как заказчик.
    const dual = personas.filter((p) => p.roles.length > 1);
    expect(dual.map((p) => [p.role, p.roles])).toEqual([["EXECUTOR", ["EXECUTOR", "CLIENT"]]]);
    expect(await db.deal.count({ where: { clientId: dual[0].id, status: "SPLIT_PAYOUT" } })).toBe(1);
  }, 120_000);
});

describe("демо-персоны при DEMO_MODE=false", () => {
  beforeEach(() => setEnv({ DEMO_MODE: "false" }));

  it("список пуст", async () => {
    await makeDemoPersona("CLIENT", "+77000007006");
    expect(await listDemoPersonas()).toEqual([]);
  });

  it("вход персоной невозможен, identity не вызывается", async () => {
    const demo = await makeDemoPersona("CLIENT", "+77000007007");

    expect(await codeOf(loginAsDemoPersona(demo.id))).toBe("FORBIDDEN");
    expect(identityFake.calls).toHaveLength(0);
  });

  it("identity выключил демо при включённом DEMO_MODE web — тот же отказ", async () => {
    setEnv({ DEMO_MODE: "true" });
    const demo = await makeDemoPersona("CLIENT", "+77000007013");
    await mirrorUser(demo.id);
    identityFake.demoEnabled = false;

    expect(await codeOf(loginAsDemoPersona(demo.id))).toBe("FORBIDDEN");
  });
});
