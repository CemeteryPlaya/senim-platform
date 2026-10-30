import { beforeEach, describe, expect, it, vi } from "vitest";
import { seedDemo } from "@/demo/seed";
import { db } from "@/platform/db";
import { AppError } from "@/platform/errors";
import { cookieValue, freshBrowser, makeDemoPersona, setEnv } from "../../../test/factories/identity";
import { listDemoPersonas, loginAsDemoPersona } from "./demo";
import { getCurrentUser, SESSION_COOKIE } from "./session";

vi.mock("next/headers", async () => (await import("../../../test/factories/identity")).nextHeadersMock);

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

    expect(await loginAsDemoPersona(demo.id, "vitest")).toEqual({ id: demo.id, role: "OPERATOR", executor: null });

    expect(await getCurrentUser()).toMatchObject({ id: demo.id, role: "OPERATOR", isDemo: true });
  });

  it("не-демо пользователь недоступен, даже если знать его id", async () => {
    const real = await makeDemoPersona("CLIENT", "+77000007004", false);

    expect(await codeOf(loginAsDemoPersona(real.id))).toBe("NOT_FOUND");
    expect(cookieValue(SESSION_COOKIE)).toBeUndefined();
    expect(await db.session.count()).toBe(0);
  });

  it("заблокированная демо-персона недоступна", async () => {
    const demo = await makeDemoPersona("CLIENT", "+77000007005");
    await db.user.update({ where: { id: demo.id }, data: { blockedAt: new Date() } });

    expect(await codeOf(loginAsDemoPersona(demo.id))).toBe("NOT_FOUND");
  });

  it("работает для каждой персоны из сида", async () => {
    await seedDemo(db);
    const personas = await listDemoPersonas();

    expect(personas).toHaveLength(14);
    for (const persona of personas) {
      freshBrowser();
      await loginAsDemoPersona(persona.id);
      expect(await getCurrentUser()).toMatchObject({ id: persona.id });
    }
  });
});

describe("демо-персоны при DEMO_MODE=false", () => {
  beforeEach(() => setEnv({ DEMO_MODE: "false" }));

  it("список пуст", async () => {
    await makeDemoPersona("CLIENT", "+77000007006");
    expect(await listDemoPersonas()).toEqual([]);
  });

  it("вход персоной невозможен", async () => {
    const demo = await makeDemoPersona("CLIENT", "+77000007007");

    expect(await codeOf(loginAsDemoPersona(demo.id))).toBe("FORBIDDEN");
    expect(await db.session.count()).toBe(0);
  });
});
