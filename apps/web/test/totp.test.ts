import { describe, expect, it } from "vitest";
import { fromBase32, toBase32, totpCode, totpNow, totpStep } from "../e2e/totp";

// Векторы RFC 6238 (приложение B, SHA1, секрет "12345678901234567890"): последние шесть цифр восьмизначных кодов.
const SECRET = Buffer.from("12345678901234567890", "ascii");

describe("e2e/totp — RFC 6238", () => {
  it.each([
    [59, "287082"],
    [1111111109, "081804"],
    [1234567890, "005924"],
    [2000000000, "279037"],
  ])("t=%i → %s", (t, code) => {
    expect(totpCode(SECRET, totpStep(t * 1000))).toBe(code);
  });

  it("base32 туда и обратно; пробелы и регистр секрета на экране не мешают", () => {
    const b32 = toBase32(SECRET);
    expect(b32).toBe("GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ");
    expect(fromBase32(b32.toLowerCase().replace(/(.{4})/g, "$1 "))).toEqual(SECRET);
    expect(totpNow(b32, 59_000)).toBe("287082");
  });
});
