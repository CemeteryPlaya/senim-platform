import { mkdir, readFile, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import sharp from "sharp";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { env, resetEnvCache } from "@/platform/env";
import { makeClient } from "../../../test/factories";
import { setEnv } from "../../../test/factories/identity";
import { testTempDir } from "../../../test/storage-dir";
import { markLocalStorageIfNew, PRUNE_GRACE_MS, pruneLocalStorage, readStorageMark, STORAGE_DB_MARK } from "./prune";
import { saveFile } from "./index";

const saved = { APP_ENV: process.env.APP_ENV, STORAGE_PROVIDER: process.env.STORAGE_PROVIDER, STORAGE_LOCAL_DIR: process.env.STORAGE_LOCAL_DIR };
const TEST_DB = new URL(process.env.DATABASE_URL ?? "").pathname.slice(1);

/** Каждый тест — своя новая папка хранилища (ещё не созданная): метка и сироты не смешиваются между тестами. */
let dir: string;
beforeEach(async () => {
  dir = path.join(await testTempDir("senim-prune-"), "storage");
  setEnv({ APP_ENV: "dev", STORAGE_PROVIDER: "local", STORAGE_LOCAL_DIR: dir });
});
afterEach(() => {
  setEnv(saved);
  resetEnvCache();
});

/** «Позже» на два срока: все файлы теста уже старше срока ожидания. */
const LATER = () => Date.now() + 2 * PRUNE_GRACE_MS;

async function orphan(key: string) {
  const full = path.join(dir, ...key.split("/"));
  await mkdir(path.dirname(full), { recursive: true });
  await writeFile(full, "orphan");
  return full;
}
const exists = (full: string) => stat(full).then(() => true, () => false);

describe("pruneLocalStorage", () => {
  it("метка совпадает с базой: удаляет файлы без записи StoredFile, файлы записей (и уменьшенные копии) и метка остаются", async () => {
    expect(await markLocalStorageIfNew()).toBe("created");
    const client = await makeClient();
    const photo = await saveFile({
      purpose: "PORTFOLIO",
      bytes: new Uint8Array(await sharp({ create: { width: 64, height: 48, channels: 3, background: "#ccc" } }).jpeg().toBuffer()),
      uploadedById: client.id,
    });
    const pdf = await saveFile({ purpose: "DOCUMENT", bytes: new TextEncoder().encode("%PDF-1.7\n%%EOF\n") });
    const stale = await orphan("document/2020/01/stale.pdf");

    const out = await pruneLocalStorage({ now: LATER() });

    expect(out.plan).toBe("prune");
    expect(await exists(stale)).toBe(false);
    expect(photo.previewKey).not.toBeNull();
    for (const key of [photo.storageKey, photo.previewKey ?? "", pdf.storageKey]) {
      expect((await readFile(path.join(env().STORAGE_LOCAL_DIR, key))).length).toBeGreaterThan(0);
    }
    expect(await readStorageMark(dir)).toBe(TEST_DB);
  });

  it("нет метки — отказ, ничего не удалено", async () => {
    const stale = await orphan("document/2020/01/no-mark.pdf");
    expect(await pruneLocalStorage({ now: LATER() })).toMatchObject({ plan: "refuse-no-mark", root: dir, database: TEST_DB });
    expect(await exists(stale)).toBe(true);
  });

  it("метка чужой базы — отказ, ничего не удалено", async () => {
    await mkdir(dir, { recursive: true });
    await writeFile(path.join(dir, STORAGE_DB_MARK), "senim\n");
    const stale = await orphan("document/2020/01/foreign.pdf");
    expect(await pruneLocalStorage({ now: LATER() })).toMatchObject({ plan: "refuse-foreign-db", root: dir, database: TEST_DB, mark: "senim" });
    expect(await exists(stale)).toBe(true);
  });

  it("метка пишется только в новую папку: в непустую без метки — нет, чистка затем отказывает", async () => {
    await orphan("document/2020/01/old.pdf");
    expect(await markLocalStorageIfNew()).toBe("not-empty");
    expect(await readStorageMark(dir)).toBeNull();
    expect((await pruneLocalStorage({ now: LATER() })).plan).toBe("refuse-no-mark");
  });

  it("APP_ENV=prod: отказ, метка не пишется, ничего не удалено и база не читается", async () => {
    const stale = await orphan("document/2020/01/prod.pdf");
    setEnv({ APP_ENV: "prod" });
    expect(await markLocalStorageIfNew()).toBe("refuse-prod");
    expect(await pruneLocalStorage({ now: LATER() })).toEqual({ plan: "refuse-prod" });
    expect(await exists(stale)).toBe(true);
    expect(await readStorageMark(dir)).toBeNull();
  });

  it("APP_ENV не задан — отказ; STORAGE_PROVIDER=s3 — пропуск", async () => {
    const stale = await orphan("document/2020/01/keep.pdf");
    setEnv({ APP_ENV: undefined });
    expect(await pruneLocalStorage({ now: LATER() })).toEqual({ plan: "refuse-no-app-env" });
    setEnv({ APP_ENV: "staging", STORAGE_PROVIDER: "s3" });
    expect(await pruneLocalStorage({ now: LATER() })).toEqual({ plan: "skip-not-local" });
    expect(await exists(stale)).toBe(true);
  });
});
