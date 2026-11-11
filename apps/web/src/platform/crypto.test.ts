import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { openValue, sealValue } from "./crypto";
import { resetEnvCache } from "./env";

// Ключ разработки берётся через env(), а env() требует строку подключения к базе — в модульном тесте её нет.
beforeAll(() => {
  vi.stubEnv("DATABASE_URL", "postgresql://unit-test");
  resetEnvCache();
});
afterAll(() => {
  vi.unstubAllEnvs();
  resetEnvCache();
});

describe("sealValue / openValue", () => {
  const IIN = "900101300123";

  it("значение открывается тем же контекстом и не лежит открытым", () => {
    const sealed = sealValue(IIN, "ctx-a");
    expect(sealed.startsWith("s1.")).toBe(true);
    expect(sealed).not.toContain(IIN);
    expect(openValue(sealed, "ctx-a")).toBe(IIN);
    expect(sealValue(IIN, "ctx-a")).not.toBe(sealed);
  });

  it("чужой контекст, подделка и чужой формат — исключение", () => {
    const sealed = sealValue(IIN, "ctx-a");
    expect(() => openValue(sealed, "ctx-b")).toThrow();
    const [v, iv, tag, data] = sealed.split(".");
    const flipped = `${data[0] === "A" ? "B" : "A"}${data.slice(1)}`;
    expect(() => openValue([v, iv, tag, flipped].join("."), "ctx-a")).toThrow();
    expect(() => openValue(`v1.${iv}.${tag}.${data}`, "ctx-a")).toThrow();
  });
});
