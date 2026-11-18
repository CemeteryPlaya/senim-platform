import { mkdir, mkdtemp, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { dirSizeBytes, TURBOPACK_CACHE_LIMIT_BYTES, trimTurbopackDevCache } from "../e2e/turbopack-cache";

let distDir: string;
beforeEach(async () => {
  distDir = await mkdtemp(path.join(tmpdir(), "senim-turbopack-"));
});
afterEach(async () => {
  await rm(distDir, { recursive: true, force: true });
});

const cacheDir = () => path.join(distDir, "dev", "cache", "turbopack");
async function fill(bytes: number[]) {
  await mkdir(path.join(cacheDir(), "sub"), { recursive: true });
  for (const [i, n] of bytes.entries()) await writeFile(path.join(cacheDir(), i % 2 ? "sub" : "", `f${i}`), new Uint8Array(n));
}
const exists = (p: string) => stat(p).then(() => true, () => false);

describe("предохранитель кэша Turbopack перед e2e-сервером", () => {
  it("порог — 5 ГБ", () => {
    expect(TURBOPACK_CACHE_LIMIT_BYTES).toBe(5 * 1024 ** 3);
  });

  it("считает размер папки с вложенными; нет папки — 0", async () => {
    await fill([100, 200, 300]);
    expect(await dirSizeBytes(cacheDir())).toBe(600);
    expect(await dirSizeBytes(path.join(distDir, "missing"))).toBe(0);
  });

  it("кэш больше порога удаляется целиком, остальная папка сборки остаётся", async () => {
    await fill([600, 600]);
    await writeFile(path.join(distDir, "keep.json"), "{}");
    expect(await trimTurbopackDevCache(distDir, 1000)).toEqual({ removed: true, bytes: 1200 });
    expect(await exists(cacheDir())).toBe(false);
    expect(await exists(path.join(distDir, "keep.json"))).toBe(true);
  });

  it("кэш не больше порога и отсутствующий кэш не трогаются", async () => {
    await fill([500, 500]);
    expect(await trimTurbopackDevCache(distDir, 1000)).toEqual({ removed: false, bytes: 1000 });
    expect(await exists(cacheDir())).toBe(true);
    await rm(cacheDir(), { recursive: true });
    expect(await trimTurbopackDevCache(distDir, 1000)).toEqual({ removed: false, bytes: 0 });
  });
});
