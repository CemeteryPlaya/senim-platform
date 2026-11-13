import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { decryptPii, encryptPii, openValue, sealValue } from "./crypto";
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

/** Тег GCM, обрезанный до `bytes` байт (Node без authTagLength принимает и короткий тег — проверяет только его начало). */
function withShortTag(sealed: string, bytes: number): string {
  const [v, iv, tag, data] = sealed.split(".");
  return [v, iv, Buffer.from(tag, "base64url").subarray(0, bytes).toString("base64url"), data].join(".");
}

describe("тег GCM — ровно 16 байт", () => {
  const IIN = "900101300123";

  it.each([4, 12, 15])("openValue: тег, обрезанный до %i байт, отклоняется", (bytes) => {
    expect(() => openValue(withShortTag(sealValue(IIN, "ctx-a"), bytes), "ctx-a")).toThrow();
  });

  it.each([4, 12, 15])("decryptPii: тег, обрезанный до %i байт, отклоняется", (bytes) => {
    expect(() => decryptPii(withShortTag(encryptPii(IIN), bytes))).toThrow();
  });

  it("целый тег открывается", () => {
    expect(openValue(sealValue(IIN, "ctx-a"), "ctx-a")).toBe(IIN);
    expect(decryptPii(encryptPii(IIN))).toBe(IIN);
  });

  it("значения, запечатанные до проверки длины тега (ключ разработки), открываются как прежде", () => {
    vi.stubEnv("PII_ENCRYPTION_KEY", undefined);
    resetEnvCache();
    try {
      expect(decryptPii("v1.OcHILCjdjV3XzD8W.ZYAfm15tzQnLGGUGHsb_1g.3BGslEfoaju_Ab63")).toBe(IIN);
      expect(openValue("s1.3twx4x42qMcxIjWR.WhIVhuDduFDV8S3s1hzP6Q.WB5TU8A8QLal2nw5", "ctx-a")).toBe(IIN);
    } finally {
      vi.stubEnv("DATABASE_URL", "postgresql://unit-test");
      resetEnvCache();
    }
  });
});
