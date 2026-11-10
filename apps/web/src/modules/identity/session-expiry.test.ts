import { describe, expect, it } from "vitest";
import type { ActionResult } from "@/platform/action";
import { leaveIfSignedOut, type Here } from "./session-expiry";

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

  it.each(["FORBIDDEN", "VALIDATION", "RATE_LIMITED", "UNAVAILABLE", "INTERNAL"] as const)("%s: остаётся на месте", (code) => {
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
