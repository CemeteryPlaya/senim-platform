import { describe, expect, it } from "vitest";
import type { ActionResult } from "@/platform/action";
import { askSecondFactor, leaveIfSignedOut, type Here } from "./session-expiry";

function here(pathname: string, search: string) {
  const visited: string[] = [];
  const loc: Here = { pathname, search, assign: (url: string | URL) => void visited.push(String(url)) };
  return { loc, visited };
}

const failed = (code: Exclude<ActionResult<unknown>, { ok: true }>["code"]): ActionResult<unknown> => ({ ok: false, code, error: "ошибка" });

describe("leaveIfSignedOut", () => {
  it("UNAUTHENTICATED: уводит на вход с возвратом на тот же путь и запрос", () => {
    const { loc, visited } = here("/deals/42", "?tab=chat");
    expect(leaveIfSignedOut(failed("UNAUTHENTICATED"), loc)).toBe(true);
    expect(visited).toEqual(["/login?next=%2Fdeals%2F42%3Ftab%3Dchat"]);
  });

  it("UNAUTHENTICATED без запроса: возврат на путь", () => {
    const { loc, visited } = here("/profile/contacts", "");
    expect(leaveIfSignedOut(failed("UNAUTHENTICATED"), loc)).toBe(true);
    expect(visited).toEqual(["/login?next=%2Fprofile%2Fcontacts"]);
  });

  it("CONSENT_REQUIRED: уводит на экран согласия с возвратом на тот же путь и запрос", () => {
    const { loc, visited } = here("/deals/42", "?tab=chat");
    expect(leaveIfSignedOut(failed("CONSENT_REQUIRED"), loc)).toBe(true);
    expect(visited).toEqual(["/consent?next=%2Fdeals%2F42%3Ftab%3Dchat"]);
  });

  it.each(["FORBIDDEN", "VALIDATION", "RATE_LIMITED", "UNAVAILABLE", "INTERNAL", "MFA_REQUIRED"] as const)("%s: остаётся на месте", (code) => {
    const { loc, visited } = here("/deals/42", "");
    expect(leaveIfSignedOut(failed(code), loc)).toBe(false);
    expect(visited).toEqual([]);
  });

  it("успех: остаётся на месте", () => {
    const { loc, visited } = here("/deals/42", "");
    expect(leaveIfSignedOut({ ok: true, data: 1 }, loc)).toBe(false);
    expect(visited).toEqual([]);
  });
});

describe("askSecondFactor", () => {
  it("MFA_REQUIRED: просит код с текстом сервера и не уводит со страницы", () => {
    const asked: string[] = [];
    expect(askSecondFactor({ ok: false, code: "MFA_REQUIRED", error: "Введите код" }, (m) => asked.push(m))).toBe(true);
    expect(asked).toEqual(["Введите код"]);
  });

  it.each(["UNAUTHENTICATED", "FORBIDDEN", "VALIDATION", "INTERNAL"] as const)("%s: код не спрашивает", (code) => {
    const asked: string[] = [];
    expect(askSecondFactor(failed(code), (m) => asked.push(m))).toBe(false);
    expect(asked).toEqual([]);
  });

  it("успех: код не спрашивает", () => {
    expect(askSecondFactor({ ok: true, data: null }, () => {
      throw new Error("не должен спрашивать");
    })).toBe(false);
  });
});
