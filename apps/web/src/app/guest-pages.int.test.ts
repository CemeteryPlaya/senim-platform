import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ReactElement } from "react";
import { db } from "@/platform/db";
import { newSessionToken, sessionCookieName } from "@/modules/identity";
import { cookieValue, freshBrowser, putCookie } from "../../test/factories/identity";
import { identityFake } from "../../test/stubs/identity";
import { Landing } from "./_home/Landing";
import { LoginForm } from "./login/LoginForm";
import LoginPage from "./login/page";
import HomePage, { generateMetadata } from "./page";

vi.mock("next/headers", async () => (await import("../../test/factories/identity")).nextHeadersMock);

const PHONE = "+77001234567";

beforeEach(() => freshBrowser());
afterEach(() => vi.restoreAllMocks());

/** Вошедший по cookie: сессия есть в identity. */
function signedIn(): string {
  const user = identityFake.addUser({ phone: PHONE });
  const token = newSessionToken();
  identityFake.signIn(user.id, token);
  putCookie(sessionCookieName(), token);
  return token;
}

const home = () => HomePage({ searchParams: Promise.resolve({}) });
const login = async () => (await LoginPage({ searchParams: Promise.resolve({}) })) as ReactElement<{ children: ReactElement }>;

// Главная и вход открыты гостю: как оболочка (getShellUser), они рисуют гостя, а не границу ошибок.
describe("главная и вход при сбое identity", () => {
  it("identity недоступен у вошедшего: главная — лендинг, вход — форма, cookie на месте", async () => {
    const token = signedIn();

    identityFake.failNextUnavailable();
    expect((await home()).type).toBe(Landing);
    identityFake.failNextUnavailable();
    expect(await generateMetadata()).toEqual({});
    identityFake.failNextUnavailable();
    expect((await login()).props.children.type).toBe(LoginForm);
    expect(cookieValue(sessionCookieName())).toBe(token);
  });

  it("конфликт проекции (тот же телефон у другого id в старой базе): главная — лендинг, вход — форма", async () => {
    signedIn();
    await db.user.create({ data: { id: "legacy-cuid", phone: PHONE, role: "CLIENT", roles: ["CLIENT"] } });

    expect((await home()).type).toBe(Landing);
    expect((await login()).props.children.type).toBe(LoginForm);
  });
});
