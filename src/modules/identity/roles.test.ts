import { describe, expect, it } from "vitest";
import { activeRoleOf, canGrant, parseSwitchableRole, roleToSwitch, switchRoleHref, switchTargets } from "./roles";

describe("activeRoleOf", () => {
  it("роль сессии, если она выдана", () => {
    expect(activeRoleOf(["CLIENT", "EXECUTOR"], "EXECUTOR", "CLIENT")).toBe("CLIENT");
  });

  it("сессия без выбранной роли — роль по умолчанию", () => {
    expect(activeRoleOf(["CLIENT", "EXECUTOR"], "EXECUTOR", null)).toBe("EXECUTOR");
  });

  it("отозванная роль не действует: роль по умолчанию", () => {
    expect(activeRoleOf(["CLIENT"], "CLIENT", "EXECUTOR")).toBe("CLIENT");
  });
});

describe("canGrant", () => {
  it("выдаёт недостающую роль заказчику и исполнителю", () => {
    expect(canGrant(["CLIENT"], "EXECUTOR")).toBe(true);
    expect(canGrant(["EXECUTOR"], "CLIENT")).toBe(true);
  });

  it("уже выданную роль не выдаёт повторно", () => {
    expect(canGrant(["CLIENT", "EXECUTOR"], "CLIENT")).toBe(false);
  });

  it("оператор не совмещается с другими ролями", () => {
    expect(canGrant(["OPERATOR"], "CLIENT")).toBe(false);
    expect(canGrant(["CLIENT"], "OPERATOR")).toBe(false);
  });
});

describe("roleToSwitch", () => {
  const both = { role: "CLIENT" as const, roles: ["CLIENT", "EXECUTOR"] as const };

  it("нужная роль есть, но не активна — переключиться в неё", () => {
    expect(roleToSwitch(both, ["EXECUTOR"])).toBe("EXECUTOR");
  });

  it("активная роль подходит или страница для всех — переключение не нужно", () => {
    expect(roleToSwitch(both, ["CLIENT"])).toBeNull();
    expect(roleToSwitch(both, [])).toBeNull();
  });

  it("нужной роли нет — переключение не поможет", () => {
    expect(roleToSwitch({ role: "CLIENT", roles: ["CLIENT"] }, ["EXECUTOR"])).toBeNull();
    expect(roleToSwitch(both, ["OPERATOR"])).toBeNull();
  });
});

describe("switchRoleHref", () => {
  it("роль и путь возврата", () => {
    expect(switchRoleHref("EXECUTOR", "/deals/abc")).toBe("/switch-role?to=EXECUTOR&returnTo=%2Fdeals%2Fabc");
  });

  it("внешний адрес возврата отбрасывается", () => {
    expect(switchRoleHref("CLIENT", "//evil.example")).toBe("/switch-role?to=CLIENT");
  });
});

describe("parseSwitchableRole", () => {
  it("принимает только роли переключателя", () => {
    expect(parseSwitchableRole("EXECUTOR")).toBe("EXECUTOR");
    expect(parseSwitchableRole("OPERATOR")).toBeNull();
    expect(parseSwitchableRole(["CLIENT"])).toBeNull();
  });
});

describe("switchTargets", () => {
  it("две роли — переключатель предлагает другую", () => {
    expect(switchTargets({ role: "EXECUTOR", roles: ["EXECUTOR", "CLIENT"] })).toEqual(["CLIENT"]);
  });

  it("одна роль или оператор — переключателя нет", () => {
    expect(switchTargets({ role: "CLIENT", roles: ["CLIENT"] })).toEqual([]);
    expect(switchTargets({ role: "OPERATOR", roles: ["OPERATOR"] })).toEqual([]);
  });
});
