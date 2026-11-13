import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { sealValue } from "@/platform/crypto";
import { resetEnvCache } from "@/platform/env";
import { openRole, ROLE_TTL_MS, sealRole } from "./role-cookie";

const NOW = Date.UTC(2026, 10, 13, 10, 0, 0);

// Ключ печати разработки берётся через env(), а env() требует строку подключения к базе — в модульном тесте её нет.
beforeAll(() => {
  vi.stubEnv("DATABASE_URL", "postgresql://unit-test");
  resetEnvCache();
});
afterAll(() => {
  vi.unstubAllEnvs();
  resetEnvCache();
});

describe("cookie выбора роли", () => {
  it("запечатанная роль открывается до конца срока", () => {
    expect(openRole(sealRole("CLIENT", NOW), NOW)).toBe("CLIENT");
    expect(openRole(sealRole("EXECUTOR", NOW), NOW + ROLE_TTL_MS - 1)).toBe("EXECUTOR");
  });

  it("срок 30 минут: после него — null", () => {
    expect(ROLE_TTL_MS).toBe(30 * 60_000);
    expect(openRole(sealRole("EXECUTOR", NOW), NOW + ROLE_TTL_MS)).toBeNull();
  });

  it("значение открытым текстом не читается: в cookie нет ни роли, ни срока", () => {
    const sealed = sealRole("EXECUTOR", NOW);
    expect(sealed).not.toContain("EXECUTOR");
    expect(sealed).not.toContain(String(NOW + ROLE_TTL_MS));
  });

  it("подделка — null: изменённый символ, обрезка, открытый текст, мусор, пусто", () => {
    const sealed = sealRole("CLIENT", NOW);
    // Первый символ шифртекста (последний символ base64url может нести только биты дополнения — его замена ничего не меняет).
    const at = sealed.lastIndexOf(".") + 1;
    const swapped = sealed[at] === "A" ? "B" : "A";
    expect(openRole(`${sealed.slice(0, at)}${swapped}${sealed.slice(at + 1)}`, NOW)).toBeNull();
    expect(openRole(sealed.slice(0, -4), NOW)).toBeNull();
    expect(openRole(`EXECUTOR.${NOW + ROLE_TTL_MS}`, NOW)).toBeNull();
    expect(openRole("s1.a.b.c", NOW)).toBeNull();
    expect(openRole("", NOW)).toBeNull();
    expect(openRole(undefined, NOW)).toBeNull();
  });

  it("значение другого назначения тем же ключом не открывается", () => {
    expect(openRole(sealValue(`EXECUTOR.${NOW + ROLE_TTL_MS}`, "documents.signature"), NOW)).toBeNull();
  });

  it("чужая роль внутри верной печати — null", () => {
    expect(openRole(sealValue(`OPERATOR.${NOW + ROLE_TTL_MS}`, "app.login.role.v1"), NOW)).toBeNull();
  });
});
