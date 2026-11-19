import { describe, expect, it } from "vitest";
import { requestNumberOf } from "./request-number";

describe("requestNumberOf", () => {
  it("цифры — номер, пробелы по краям не мешают", () => {
    expect(requestNumberOf("42")).toBe(42);
    expect(requestNumberOf(" 7 ")).toBe(7);
    expect(requestNumberOf("2147483647")).toBe(2_147_483_647);
  });

  it("пусто, не цифры, ноль, дробь, знак и больше INT4 — null", () => {
    for (const raw of [undefined, "", " ", "abc", "0", "1.5", "-3", "+3", "4 2", "2147483648", "99999999999"]) expect(requestNumberOf(raw), String(raw)).toBeNull();
  });
});
