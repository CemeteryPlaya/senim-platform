import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import sharp from "sharp";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { db } from "@/platform/db";
import { resetEnvCache } from "@/platform/env";
import { runDueJobs } from "@/platform/jobs";
import { enqueueDailyJobs, jobHandlers } from "@/jobs";
import { makeClient } from "../../../test/factories";
import { ORPHAN_AGE_MS } from "./cleanup";
import { saveFile, storage } from "./index";

let dir: string;
beforeAll(async () => {
  dir = await mkdtemp(path.join(tmpdir(), "senim-cleanup-"));
  process.env.STORAGE_PROVIDER = "local";
  process.env.STORAGE_LOCAL_DIR = dir;
  resetEnvCache();
});
afterAll(async () => {
  await rm(dir, { recursive: true, force: true });
});

const jpeg = () => sharp({ create: { width: 64, height: 48, channels: 3, background: "#cccccc" } }).jpeg().toBuffer();
const age = (id: string, ms: number) => db.storedFile.update({ where: { id }, data: { createdAt: new Date(Date.now() - ms) } });

describe("files.cleanupOrphans", () => {
  it("удаляет только неприкреплённые файлы старше суток — запись и байты", async () => {
    const client = await makeClient();
    const old = await saveFile({ purpose: "REQUEST_ROOM", bytes: await jpeg(), uploadedById: client.id });
    const fresh = await saveFile({ purpose: "REQUEST_ROOM", bytes: await jpeg(), uploadedById: client.id });
    const attached = await saveFile({ purpose: "REQUEST_ROOM", bytes: await jpeg(), uploadedById: client.id });
    const request = await db.request.create({ data: { clientId: client.id, mode: "TENDER" } });
    await db.storedFile.update({ where: { id: attached.id }, data: { requestId: request.id } });
    await age(old.id, ORPHAN_AGE_MS + 60_000);
    await age(attached.id, ORPHAN_AGE_MS + 60_000);

    await enqueueDailyJobs();
    await enqueueDailyJobs(); // повтор за те же сутки не ставит вторую задачу
    expect(await db.job.count({ where: { kind: "files.cleanupOrphans" } })).toBe(1);
    await runDueJobs(jobHandlers);
    expect(await db.job.findFirstOrThrow({ where: { kind: "files.cleanupOrphans" } })).toMatchObject({ status: "DONE" });

    const left = (await db.storedFile.findMany({ select: { id: true } })).map((f) => f.id).sort();
    expect(left).toEqual([fresh.id, attached.id].sort());
    expect(await (await storage()).get(old.storageKey)).toBeNull();
    expect(await (await storage()).get(attached.storageKey)).not.toBeNull();
  });

  it("saveFile в транзакции: откат не оставляет записи файла", async () => {
    await db
      .$transaction(async (tx) => {
        await saveFile({ purpose: "DOCUMENT", bytes: new TextEncoder().encode("%PDF-1.7\n%%EOF\n"), tx });
        throw new Error("сбой после сохранения");
      })
      .catch(() => undefined);
    expect(await db.storedFile.count()).toBe(0);
  });
});
