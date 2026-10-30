import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { resetEnvCache } from "@/platform/env";
import { isAppError } from "@/platform/errors";
import { makeClient } from "../../../test/factories";
import { createUpload, fileUrl, readLocalDownload, receiveLocalUpload, storage } from "./index";

let dir: string;
beforeAll(async () => {
  dir = await mkdtemp(path.join(tmpdir(), "senim-local-"));
  process.env.STORAGE_PROVIDER = "local";
  process.env.STORAGE_LOCAL_DIR = dir;
  resetEnvCache();
});
afterAll(async () => {
  await rm(dir, { recursive: true, force: true });
});

const stream = (bytes: Uint8Array) => new Blob([new Uint8Array(bytes)]).stream();
const code = async (p: Promise<unknown>) => {
  const e = await p.catch((err: unknown) => err);
  return isAppError(e) ? e.code : e;
};

function tokenFrom(url: string) {
  return new URL(url, "http://x").searchParams.get("token")!;
}

describe("приём загрузки на local (PUT /api/files/upload)", () => {
  it("кладёт байты во временный ключ из токена", async () => {
    const client = await makeClient();
    const { target } = await createUpload(client, { purpose: "REQUEST_ROOM", contentType: "image/jpeg", size: 3 });
    if (target.kind !== "http") throw new Error("ожидалась http-цель");
    const token = tokenFrom(target.url);
    await receiveLocalUpload(client, { token, body: stream(new Uint8Array([1, 2, 3])) });
    const key = JSON.parse(Buffer.from(token.split(".")[0]!, "base64url").toString()).stagingKey as string;
    expect(Array.from((await (await storage()).get(key))!)).toEqual([1, 2, 3]);
  });

  it("чужой, испорченный токен и пустое тело отклоняются", async () => {
    const client = await makeClient();
    const { target } = await createUpload(client, { purpose: "REQUEST_ROOM", contentType: "image/jpeg", size: 3 });
    if (target.kind !== "http") throw new Error("ожидалась http-цель");
    const token = tokenFrom(target.url);
    expect(await code(receiveLocalUpload(await makeClient(), { token, body: stream(new Uint8Array([1])) }))).toBe("FORBIDDEN");
    expect(await code(receiveLocalUpload(client, { token: `${token}x`, body: stream(new Uint8Array([1])) }))).toBe("VALIDATION");
    expect(await code(receiveLocalUpload(client, { token, body: null }))).toBe("VALIDATION");
  });
});

describe("скачивание по подписанной ссылке (GET /api/files/<ключ>)", () => {
  it("отдаёт байты и тип по расширению; без верной подписи — null", async () => {
    await (await storage()).put("stage_report/2026/10/a.jpg", new Uint8Array([9, 9]), "image/jpeg");
    const url = new URL(await fileUrl({ provider: "local", storageKey: "stage_report/2026/10/a.jpg" }), "http://x");
    const query = { key: "stage_report/2026/10/a.jpg", exp: url.searchParams.get("exp")!, sig: url.searchParams.get("sig")! };

    const ok = await readLocalDownload(query);
    expect(ok && Array.from(ok.bytes)).toEqual([9, 9]);
    expect(ok?.contentType).toBe("image/jpeg");
    expect(await readLocalDownload({ ...query, sig: "0".repeat(64) })).toBeNull();
    expect(await readLocalDownload({ ...query, key: "stage_report/2026/10/b.jpg" })).toBeNull();
  });

  it("временные загрузки по ссылке не отдаются", async () => {
    await (await storage()).put("uploads/x", new Uint8Array([1]), "image/jpeg");
    const url = new URL(await fileUrl({ provider: "local", storageKey: "uploads/x" }), "http://x");
    expect(await readLocalDownload({ key: "uploads/x", exp: url.searchParams.get("exp")!, sig: url.searchParams.get("sig")! })).toBeNull();
  });
});
