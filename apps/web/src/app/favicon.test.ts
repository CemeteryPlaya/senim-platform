import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

/**
 * Браузеры сами просят /favicon.ico (вкладка, закладки, история), даже когда в разметке есть icon.svg: без файла — 404 в
 * журнале и пустая вкладка в старых браузерах. Файл рисует scripts/generate-icons.mjs: ICO с PNG 16, 32 и 48 px.
 */
const FILE = path.join(__dirname, "favicon.ico");
const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47]);

describe("favicon.ico", () => {
  it("есть и это ICO с картинками 16, 32 и 48 px в PNG", () => {
    expect(existsSync(FILE)).toBe(true);
    const ico = readFileSync(FILE);
    expect([ico.readUInt16LE(0), ico.readUInt16LE(2)]).toEqual([0, 1]);
    const count = ico.readUInt16LE(4);
    const sizes = Array.from({ length: count }, (_, i) => {
      const entry = 6 + i * 16;
      const offset = ico.readUInt32LE(entry + 12);
      expect(ico.subarray(offset, offset + 4).equals(PNG)).toBe(true);
      return ico.readUInt8(entry);
    });
    expect(sizes).toEqual([16, 32, 48]);
  });
});
