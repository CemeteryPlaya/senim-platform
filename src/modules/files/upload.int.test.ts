import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import sharp from "sharp";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { db } from "@/platform/db";
import { resetEnvCache } from "@/platform/env";
import { isAppError } from "@/platform/errors";
import { makeClient, makeExecutor } from "../../../test/factories";
import { attachFiles, createUpload, discardUpload, fileUrl, findSimilar, finalizeUpload, storage } from "./index";

let dir: string;
beforeAll(async () => {
  dir = await mkdtemp(path.join(tmpdir(), "senim-upload-"));
  process.env.STORAGE_PROVIDER = "local";
  process.env.STORAGE_LOCAL_DIR = dir;
  resetEnvCache();
});
afterAll(async () => {
  await rm(dir, { recursive: true, force: true });
});

const scene = (fill: string, x: number) =>
  sharp(Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="640" height="480"><rect width="100%" height="100%" fill="#eee"/><rect x="${x}" y="80" width="260" height="300" fill="${fill}"/><circle cx="500" cy="120" r="60" fill="#333"/></svg>`))
    .jpeg()
    .withExifMerge({ IFD3: { GPSLatitudeRef: "N", GPSLatitude: "51/1 10/1 0/1" } })
    .toBuffer();

/** Как браузер: createUpload → PUT байтов по цели → finalizeUpload. Для local цель — наш маршрут, здесь кладём напрямую. */
async function upload(user: Awaited<ReturnType<typeof makeClient>>, purpose: "REQUEST_ROOM" | "PORTFOLIO", bytes: Uint8Array, contentType = "image/jpeg") {
  const { token, target } = await createUpload(user, { purpose, contentType, size: bytes.length });
  expect(target.kind).toBe("http");
  const stagingKey = JSON.parse(Buffer.from(token.split(".")[0]!, "base64url").toString()).stagingKey as string;
  await (await storage()).put(stagingKey, bytes, contentType);
  return { token, stagingKey, result: await finalizeUpload(user, { token }) };
}

const code = async (p: Promise<unknown>) => {
  const e = await p.catch((err: unknown) => err);
  return isAppError(e) ? e.code : e;
};

describe("загрузка по подписанной цели", () => {
  it("сжимает фото, убирает EXIF, считает sha256 и dHash и записывает StoredFile", async () => {
    const client = await makeClient();
    const { result, stagingKey } = await upload(client, "REQUEST_ROOM", new Uint8Array(await scene("#7a5", 40)));

    const file = await db.storedFile.findUniqueOrThrow({ where: { id: result.id } });
    expect(file).toMatchObject({ provider: "local", purpose: "REQUEST_ROOM", contentType: "image/jpeg", uploadedById: client.id, width: 640, height: 480 });
    expect(file.storageKey).toMatch(/^request_room\/\d{4}\/\d{2}\/[\w-]+\.jpg$/);
    expect(file.sha256).toMatch(/^[0-9a-f]{64}$/);
    expect(file.phash).toMatch(/^[0-9a-f]{16}$/);

    const stored = (await (await storage()).get(file.storageKey))!;
    expect(stored.length).toBe(file.size);
    expect((await sharp(Buffer.from(stored)).metadata()).exif).toBeUndefined();
    expect(await (await storage()).get(stagingKey)).toBeNull();
    expect(result.url).toMatch(/^\/api\/files\/request_room\/.+\?exp=\d+&sig=[0-9a-f]+$/);
  });

  it("фото iPhone в HEIC принимается: сохраняется JPEG без EXIF, повёрнутый по irot", async () => {
    const client = await makeClient();
    const heic = new Uint8Array(await readFile(path.join(process.cwd(), "test/fixtures/heic/rotated-exif-gps.heic")));
    const { result } = await upload(client, "REQUEST_ROOM", heic, "image/heic");

    const file = await db.storedFile.findUniqueOrThrow({ where: { id: result.id } });
    expect(file).toMatchObject({ contentType: "image/jpeg", width: 96, height: 128 });
    expect(file.storageKey).toMatch(/\.jpg$/);
    expect(file.phash).toMatch(/^[0-9a-f]{16}$/);
    const stored = Buffer.from((await (await storage()).get(file.storageKey))!);
    expect((await sharp(stored).metadata()).exif).toBeUndefined();
    expect(stored.includes(Buffer.from("Phone"))).toBe(false);
  });

  it("повторный finalize того же токена возвращает тот же файл (идемпотентно)", async () => {
    const client = await makeClient();
    const { token, result } = await upload(client, "REQUEST_ROOM", new Uint8Array(await scene("#a55", 40)));
    const again = await finalizeUpload(client, { token });
    expect(again.id).toBe(result.id);
    expect(await db.storedFile.count()).toBe(1);
  });

  it("тип проверяется по байтам: текст под видом JPEG отклонён", async () => {
    const client = await makeClient();
    const bytes = new TextEncoder().encode("<script>alert(1)</script>");
    expect(await code(upload(client, "REQUEST_ROOM", bytes))).toBe("VALIDATION");
    expect(await db.storedFile.count()).toBe(0);
  });

  it("PDF принимается только для документов", async () => {
    const client = await makeClient();
    expect(await code(createUpload(client, { purpose: "REQUEST_ROOM", contentType: "application/pdf", size: 100 }))).toBe("VALIDATION");
    const pdf = new TextEncoder().encode("%PDF-1.7\n1 0 obj<<>>endobj\n%%EOF");
    expect(await code(upload(client, "REQUEST_ROOM", pdf))).toBe("VALIDATION");
  });

  it("лимит размера: и при создании цели, и по фактическим байтам", async () => {
    const client = await makeClient();
    expect(await code(createUpload(client, { purpose: "REQUEST_ROOM", contentType: "image/jpeg", size: 50 * 1024 * 1024 }))).toBe("VALIDATION");
    // браузер заявил 100 байт, а прислал больше лимита
    const { token } = await createUpload(client, { purpose: "REQUEST_ROOM", contentType: "image/jpeg", size: 100 });
    const stagingKey = JSON.parse(Buffer.from(token.split(".")[0]!, "base64url").toString()).stagingKey as string;
    await (await storage()).put(stagingKey, new Uint8Array(26 * 1024 * 1024), "image/jpeg");
    const error = await finalizeUpload(client, { token }).catch((e: unknown) => e);
    expect(isAppError(error) && error.message).toMatch(/больше 25 МБ/);
    expect(await (await storage()).get(stagingKey)).toBeNull();
  });

  it("назначение ограничено ролью: заказчик не загружает в портфолио", async () => {
    const client = await makeClient();
    expect(await code(createUpload(client, { purpose: "PORTFOLIO", contentType: "image/jpeg", size: 100 }))).toBe("FORBIDDEN");
  });

  it("чужой токен не завершить", async () => {
    const client = await makeClient();
    const other = await makeClient();
    const { token } = await createUpload(client, { purpose: "REQUEST_ROOM", contentType: "image/jpeg", size: 100 });
    expect(await code(finalizeUpload(other, { token }))).toBe("FORBIDDEN");
    expect(await code(finalizeUpload(client, { token: "мусор" }))).toBe("VALIDATION");
  });

  it("незагруженный файл — понятная ошибка", async () => {
    const client = await makeClient();
    const { token } = await createUpload(client, { purpose: "REQUEST_ROOM", contentType: "image/jpeg", size: 100 });
    expect(await code(finalizeUpload(client, { token }))).toBe("VALIDATION");
  });
});

describe("прикрепление и удаление", () => {
  it("прикрепляет свои файлы нужного назначения в порядке списка", async () => {
    const client = await makeClient();
    const a = (await upload(client, "REQUEST_ROOM", new Uint8Array(await scene("#111", 10)))).result;
    const b = (await upload(client, "REQUEST_ROOM", new Uint8Array(await scene("#999", 300)))).result;
    const request = await db.request.create({ data: { clientId: client.id, mode: "TENDER" } });

    await db.$transaction((tx) => attachFiles(tx, { fileIds: [b.id, a.id], uploadedById: client.id, owner: { requestId: request.id } }));

    const files = await db.storedFile.findMany({ where: { requestId: request.id }, orderBy: { sortOrder: "asc" } });
    expect(files.map((f) => f.id)).toEqual([b.id, a.id]);
    // уже прикреплён — второй раз нельзя, в том числе к другой заявке
    const other = await db.request.create({ data: { clientId: client.id, mode: "TENDER" } });
    expect(await code(db.$transaction((tx) => attachFiles(tx, { fileIds: [a.id], uploadedById: client.id, owner: { requestId: other.id } })))).toBe("CONFLICT");
    // и удалить прикреплённый нельзя
    expect(await code(discardUpload(client, a.id))).toBe("CONFLICT");
  });

  it("чужой файл или файл другого назначения не прикрепить", async () => {
    const client = await makeClient();
    const intruder = await makeClient();
    const a = (await upload(client, "REQUEST_ROOM", new Uint8Array(await scene("#111", 10)))).result;
    const request = await db.request.create({ data: { clientId: intruder.id, mode: "TENDER" } });
    expect(await code(db.$transaction((tx) => attachFiles(tx, { fileIds: [a.id], uploadedById: intruder.id, owner: { requestId: request.id } })))).toBe("CONFLICT");
    expect(await code(db.$transaction((tx) => attachFiles(tx, { fileIds: [a.id], uploadedById: client.id, owner: { disputeId: "x" } })))).toBe("CONFLICT");
  });

  it("неприкреплённый свой файл удаляется вместе с объектом в хранилище", async () => {
    const client = await makeClient();
    const a = (await upload(client, "REQUEST_ROOM", new Uint8Array(await scene("#111", 10)))).result;
    const key = (await db.storedFile.findUniqueOrThrow({ where: { id: a.id } })).storageKey;
    expect(await code(discardUpload(await makeClient(), a.id))).toBe("FORBIDDEN");
    await discardUpload(client, a.id);
    expect(await db.storedFile.count()).toBe(0);
    expect(await (await storage()).get(key)).toBeNull();
  });
});

describe("поиск повторов по dHash", () => {
  it("находит то же фото после пережатия у другого исполнителя и не находит другое", async () => {
    const first = await makeExecutor();
    const second = await makeExecutor();
    const original = new Uint8Array(await scene("#3b2f2a", 40));
    const recompressed = new Uint8Array(await sharp(Buffer.from(original)).resize({ width: 320 }).jpeg({ quality: 30 }).toBuffer());
    const theirs = (await upload(first, "PORTFOLIO", original)).result;
    const mine = (await upload(second, "PORTFOLIO", recompressed)).result;
    const unrelated = (await upload(second, "PORTFOLIO", new Uint8Array(await scene("#ffffff", 360)))).result;

    const phash = (await db.storedFile.findUniqueOrThrow({ where: { id: mine.id } })).phash!;
    const similar = await findSimilar(phash, 6, { excludeUploadedById: second.id });

    expect(similar.map((s) => s.id)).toEqual([theirs.id]);
    expect(similar[0]).toMatchObject({ uploadedById: first.id, purpose: "PORTFOLIO" });
    expect(similar[0]!.distance).toBeLessThanOrEqual(6);
    expect(similar.map((s) => s.id)).not.toContain(unrelated.id);
  });

  it("некорректный хэш — ошибка проверки, а не ошибка SQL", async () => {
    expect(await code(findSimilar("zz'; drop table", 6))).toBe("VALIDATION");
  });
});

describe("fileUrl", () => {
  it("static — публичный путь в public/, local — подписанная ссылка", async () => {
    expect(await fileUrl({ provider: "static", storageKey: "demo/portfolio/kitchen-sage.svg" })).toBe("/demo/portfolio/kitchen-sage.svg");
    expect(await fileUrl({ provider: "local", storageKey: "a/b.jpg" })).toMatch(/^\/api\/files\/a\/b\.jpg\?exp=\d+&sig=/);
  });

  it.each([
    ["stage_report/2026/10/a.jpg", 15 * 60],
    ["dispute/2026/10/a.jpg", 15 * 60],
    ["message/2026/10/a.jpg", 15 * 60],
    ["document/2026/10/a.pdf", 15 * 60],
    ["portfolio/2026/10/a.jpg", 60 * 60],
    ["visualization/2026/10/a.jpg", 60 * 60],
    ["request_room/2026/10/a.jpg", 60 * 60],
  ])("ссылка на %s живёт %i с", async (storageKey, ttl) => {
    const exp = Number(new URL(await fileUrl({ provider: "local", storageKey }), "http://x").searchParams.get("exp"));
    expect(exp - Date.now() / 1000).toBeGreaterThan(ttl - 5);
    expect(exp - Date.now() / 1000).toBeLessThanOrEqual(ttl);
  });
});
