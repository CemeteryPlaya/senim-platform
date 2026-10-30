import { describe, expect, it } from "vitest";
import { homePathFor, loginHref, safeReturnTo } from "./return-to";

describe("safeReturnTo", () => {
  it.each(["/deals/1", "/requests?tab=offers", "/", "/catalog?q=%D1%88%D0%BA%D0%B0%D1%84"])("пропускает свой адрес %s", (path) => {
    expect(safeReturnTo(path)).toBe(path);
  });

  it.each([
    "https://evil.example/",
    "//evil.example/path",
    "/\\evil.example",
    "/\\\\evil.example",
    "/\t/evil.example",
    "/\n/evil.example",
    "/\r/evil.example",
    "/\u0000/evil.example",
    "/%09/evil.example",
    "/%0a/evil.example",
    "/%E0%A4%A",
    "javascript:alert(1)",
    "deals/1",
    "",
    undefined,
    ["/a", "/b"],
  ])("не пускает на чужой, неполный или с управляющими символами адрес %j", (value) => {
    expect(safeReturnTo(value)).toBeNull();
  });
});

describe("loginHref", () => {
  it("кодирует адрес возврата и причину", () => {
    expect(loginHref("/deals/1?x=1")).toBe("/login?next=%2Fdeals%2F1%3Fx%3D1");
    expect(loginHref("/operator", "role")).toBe("/login?next=%2Foperator&reason=role");
  });

  it("не кладёт в ссылку чужой адрес", () => {
    expect(loginHref("https://evil.example")).toBe("/login");
  });
});

describe("homePathFor", () => {
  it("ведёт каждую роль на её главный экран", () => {
    expect(homePathFor({ role: "CLIENT", executor: null })).toBe("/requests");
    expect(homePathFor({ role: "OPERATOR", executor: null })).toBe("/operator");
    expect(homePathFor({ role: "EXECUTOR", executor: { status: "APPROVED" } })).toBe("/executor/requests");
  });

  it("исполнителя без подтверждения — на экран статуса регистрации", () => {
    expect(homePathFor({ role: "EXECUTOR", executor: { status: "PENDING" } })).toBe("/register/executor");
    expect(homePathFor({ role: "EXECUTOR", executor: null })).toBe("/register/executor");
  });
});
