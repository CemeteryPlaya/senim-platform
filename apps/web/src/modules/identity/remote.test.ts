import { describe, expect, it } from "vitest";
import { Role as ProtoRole } from "@/gen/senim/identity/v1/identity_pb";
import { Role } from "@/generated/prisma/enums";
import { roleFromProto, roleToProto } from "./projection";
import { identityClientIp } from "./remote";

describe("identityClientIp", () => {
  it.each(["203.0.113.7", "2001:db8::1", "::1"])("%s — адрес как есть", (ip) => {
    expect(identityClientIp(ip)).toBe(ip);
  });

  it.each([null, "", "203.0.113.7:51234", "[2001:db8::1]:443", "203.0.113.7, 10.0.0.1", "unknown", " 203.0.113.7"])("%j — пустая строка", (ip) => {
    expect(identityClientIp(ip)).toBe("");
  });
});

describe("роли identity и Prisma", () => {
  it.each(Object.values(Role))("%s туда и обратно", (role) => {
    expect(roleFromProto(roleToProto(role))).toBe(role);
  });

  it("четыре роли — четыре разные роли identity", () => {
    expect(new Set(Object.values(Role).map(roleToProto)).size).toBe(4);
  });

  it("ROLE_UNSPECIFIED — ошибка", () => {
    expect(() => roleFromProto(ProtoRole.UNSPECIFIED)).toThrow();
  });
});
