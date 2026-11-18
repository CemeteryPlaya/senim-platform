import { mkdir, readFile, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import sharp from "sharp";
import { afterEach, describe, expect, it } from "vitest";
import { env, resetEnvCache } from "@/platform/env";
import { makeClient } from "../../../test/factories";
import { setEnv } from "../../../test/factories/identity";
import { PRUNE_GRACE_MS, pruneLocalStorage } from "./prune";
import { saveFile } from "./index";

const saved = { APP_ENV: process.env.APP_ENV, STORAGE_PROVIDER: process.env.STORAGE_PROVIDER };
afterEach(() => {
  setEnv(saved);
  resetEnvCache();
});

/** «Позже» на два срока: все файлы теста уже старше срока ожидания. */
const LATER = () => Date.now() + 2 * PRUNE_GRACE_MS;

async function orphan(key: string) {
  const full = path.join(env().STORAGE_LOCAL_DIR, ...key.split("/"));
  await mkdir(path.dirname(full), { recursive: true });
  await writeFile(full, "orphan");
  return full;
}
const exists = (full: string) => stat(full).then(() => true, () => false);

describe("pruneLocalStorage", () => {
  it("APP_ENV=dev: удаляет файлы без записи StoredFile, файлы записей (и уменьшенные копии) остаются", async () => {
    setEnv({ APP_ENV: "dev", STORAGE_PROVIDER: "local" });
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
    const root = env().STORAGE_LOCAL_DIR;
    expect(photo.previewKey).not.toBeNull();
    for (const key of [photo.storageKey, photo.previewKey ?? "", pdf.storageKey]) {
      expect((await readFile(path.join(root, key))).length).toBeGreaterThan(0);
    }
  });

  it("APP_ENV=prod: отказ, ничего не удалено и база не читается", async () => {
    const stale = await orphan("document/2020/01/prod.pdf");
    setEnv({ APP_ENV: "prod" });
    expect(await pruneLocalStorage({ now: LATER() })).toEqual({ plan: "refuse-prod" });
    expect(await exists(stale)).toBe(true);
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
