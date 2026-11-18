import { mkdir, mkdtemp, readdir, rm, utimes } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createRunStorageRoot, removeStaleRunRoots, STALE_RUN_MS } from "./storage-dir";

let base: string;
beforeEach(async () => {
  base = await mkdtemp(path.join(tmpdir(), "senim-storage-dir-"));
});
afterEach(async () => {
  await rm(base, { recursive: true, force: true });
});

const NOW = Date.UTC(2026, 10, 19, 12);
const age = (full: string, ms: number) => utimes(full, (NOW - ms) / 1000, (NOW - ms) / 1000);

describe("папки хранилища прогонов тестов", () => {
  it("создаёт папку прогона с префиксом senim-test-storage-", async () => {
    const root = await createRunStorageRoot(base);
    expect(path.dirname(root)).toBe(base);
    expect(path.basename(root)).toMatch(/^senim-test-storage-.+/);
  });

  it("удаляет только папки прогонов старше суток: свежие и чужие папки остаются", async () => {
    const stale = await createRunStorageRoot(base);
    await mkdir(path.join(stale, "document"), { recursive: true });
    const fresh = await createRunStorageRoot(base);
    const foreign = path.join(base, "senim-ai-old");
    await mkdir(foreign);
    await age(stale, STALE_RUN_MS + 60_000);
    await age(fresh, STALE_RUN_MS - 60_000);
    await age(foreign, STALE_RUN_MS * 10);

    expect(await removeStaleRunRoots(base, NOW)).toEqual([stale]);
    expect((await readdir(base)).sort()).toEqual([path.basename(fresh), "senim-ai-old"].sort());
  });
});
