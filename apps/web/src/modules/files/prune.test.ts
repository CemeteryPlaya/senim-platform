import { mkdir, mkdtemp, readdir, rm, utimes, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { databaseName, localPrunePlan, markStorageIfNew, pruneLocalFiles, PRUNE_GRACE_MS, readStorageMark, STORAGE_DB_MARK } from "./prune";

const NOW = Date.UTC(2026, 10, 19, 12);
const OLD = NOW - PRUNE_GRACE_MS - 60_000;

let root: string;
beforeEach(async () => {
  root = await mkdtemp(path.join(tmpdir(), "senim-prune-"));
});
afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

/** Файл хранилища по ключу (как в StoredFile.storageKey) с временем изменения `mtime`. */
async function put(key: string, mtime = OLD, size = 10) {
  const full = path.join(root, ...key.split("/"));
  await mkdir(path.dirname(full), { recursive: true });
  await writeFile(full, new Uint8Array(size));
  await utimes(full, mtime / 1000, mtime / 1000);
}

async function keys(dir = root, prefix = ""): Promise<string[]> {
  const out: string[] = [];
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const key = prefix ? `${prefix}/${entry.name}` : entry.name;
    if (entry.isDirectory()) out.push(`${key}/`, ...(await keys(path.join(dir, entry.name), key)));
    else out.push(key);
  }
  return out.sort();
}

describe("pruneLocalFiles", () => {
  it("удаляет файлы без ссылки в StoredFile (storageKey и previewKey) и пустые папки после них", async () => {
    await put("document/2026/11/offer.pdf");
    await put("delivery/2026/11/photo.jpg");
    await put("delivery/2026/11/photo-preview.jpg");
    await put("document/2026/10/orphan.pdf", OLD, 650);
    await put("kyc_id/2026/09/orphan.jpg", OLD, 100);

    const result = await pruneLocalFiles({
      root,
      referenced: new Set(["document/2026/11/offer.pdf", "delivery/2026/11/photo.jpg", "delivery/2026/11/photo-preview.jpg"]),
      now: NOW,
    });

    expect(result).toEqual({ removed: 2, removedBytes: 750, kept: 3 });
    expect(await keys()).toEqual(
      ["delivery/", "delivery/2026/", "delivery/2026/11/", "delivery/2026/11/photo-preview.jpg", "delivery/2026/11/photo.jpg", "document/", "document/2026/", "document/2026/11/", "document/2026/11/offer.pdf"].sort(),
    );
  });

  it("не трогает свежие файлы без ссылки: загрузка ещё может быть подтверждена (токен загрузки живёт час)", async () => {
    await put("uploads/in-flight", NOW - 60_000);
    await put("document/2026/11/just-written.pdf", NOW - PRUNE_GRACE_MS + 60_000);

    expect(await pruneLocalFiles({ root, referenced: new Set(), now: NOW })).toEqual({ removed: 0, removedBytes: 0, kept: 2 });
    expect(await keys()).toContain("uploads/in-flight");
  });

  it("корень сохраняется, даже если опустел; нет папки — нечего удалять", async () => {
    await put("message/2026/11/orphan.jpg");
    expect(await pruneLocalFiles({ root, referenced: new Set(), now: NOW })).toEqual({ removed: 1, removedBytes: 10, kept: 0 });
    expect(await readdir(root)).toEqual([]);

    const missing = path.join(root, "missing");
    expect(await pruneLocalFiles({ root: missing, referenced: new Set(), now: NOW })).toEqual({ removed: 0, removedBytes: 0, kept: 0 });
  });
});

describe("метка владельца папки хранилища", () => {
  it("пишется в новую (нет папки) и в пустую папку — имя базы", async () => {
    const fresh = path.join(root, "new", "storage-e2e");
    expect(await markStorageIfNew(fresh, "senim_v2web_e2e")).toBe("created");
    expect(await readStorageMark(fresh)).toBe("senim_v2web_e2e");
    expect(await markStorageIfNew(root, "senim_v2web_e2e")).toBe("not-empty"); // в root уже есть папка new
    const empty = path.join(root, "empty");
    await mkdir(empty);
    expect(await markStorageIfNew(empty, "senim_v2web_e2e")).toBe("created");
  });

  it("не пишется в непустую папку без метки и не перезаписывает существующую", async () => {
    await put("document/2026/11/a.pdf");
    expect(await markStorageIfNew(root, "senim_v2web_e2e")).toBe("not-empty");
    expect(await readStorageMark(root)).toBeNull();

    const marked = path.join(root, "marked");
    expect(await markStorageIfNew(marked, "senim_dev")).toBe("created");
    expect(await markStorageIfNew(marked, "senim_v2web_e2e")).toBe("exists");
    expect(await readStorageMark(marked)).toBe("senim_dev");
  });

  it("файл метки не считается сиротой", async () => {
    await markStorageIfNew(root, "senim_v2web_e2e");
    await utimes(path.join(root, STORAGE_DB_MARK), OLD / 1000, OLD / 1000);
    expect(await pruneLocalFiles({ root, referenced: new Set(), now: NOW })).toEqual({ removed: 0, removedBytes: 0, kept: 1 });
    expect(await readStorageMark(root)).toBe("senim_v2web_e2e");
  });

  it("имя базы — из DATABASE_URL без параметров", () => {
    expect(databaseName("postgresql://postgres:postgres@localhost:5442/senim_v2web_e2e?schema=public")).toBe("senim_v2web_e2e");
    expect(databaseName("postgresql://u:p@h:5432/senim")).toBe("senim");
  });
});

describe("localPrunePlan", () => {
  it("чистит только при явном APP_ENV dev или staging и локальном хранилище", () => {
    expect(localPrunePlan({ appEnv: "dev", storageProvider: "local" })).toBe("prune");
    expect(localPrunePlan({ appEnv: "staging", storageProvider: "local" })).toBe("prune");
    expect(localPrunePlan({ appEnv: "dev", storageProvider: undefined })).toBe("prune"); // по умолчанию local, как в env.ts
  });

  it("при APP_ENV=prod — отказ при любом хранилище", () => {
    expect(localPrunePlan({ appEnv: "prod", storageProvider: "local" })).toBe("refuse-prod");
    expect(localPrunePlan({ appEnv: "prod", storageProvider: "s3" })).toBe("refuse-prod");
    expect(localPrunePlan({ appEnv: "prod", storageProvider: undefined })).toBe("refuse-prod");
  });

  it("APP_ENV не задан — отказ: забытая переменная не должна стирать файлы", () => {
    expect(localPrunePlan({ appEnv: undefined, storageProvider: "local" })).toBe("refuse-no-app-env");
    expect(localPrunePlan({ appEnv: "", storageProvider: "local" })).toBe("refuse-no-app-env");
  });

  it("новые файлы не в local (s3, vercel-blob) — пропуск", () => {
    expect(localPrunePlan({ appEnv: "staging", storageProvider: "s3" })).toBe("skip-not-local");
    expect(localPrunePlan({ appEnv: "dev", storageProvider: "vercel-blob" })).toBe("skip-not-local");
  });
});
