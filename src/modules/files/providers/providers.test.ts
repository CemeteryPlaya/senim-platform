import { mkdtemp, rm, writeFile, mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { isAppError } from "@/platform/errors";
import { verifyDownload } from "../signing";
import { createBlobStorage, type BlobSdk } from "./blob";
import { createLocalStorage } from "./local";
import { createS3Storage, type S3Deps } from "./s3";
import { createStaticStorage } from "./static";

const SIGN = { now: 1_800_000_000_000, secret: "s" };
const bytes = (s: string) => new TextEncoder().encode(s);

let dir: string;
beforeAll(async () => {
  dir = await mkdtemp(path.join(tmpdir(), "senim-files-"));
});
afterAll(async () => {
  await rm(dir, { recursive: true, force: true });
});

function queryOf(url: string) {
  const u = new URL(url, "http://x");
  return {
    key: decodeURIComponent(u.pathname.replace(/^\/api\/files\//, "")),
    exp: u.searchParams.get("exp") ?? "",
    sig: u.searchParams.get("sig") ?? "",
    name: u.searchParams.get("name") ?? undefined,
  };
}

describe("local", () => {
  const storage = () => createLocalStorage(path.join(dir, "local"), () => SIGN);

  it("кладёт, читает и удаляет файл; отсутствующий — null", async () => {
    const s = storage();
    await s.put("request_room/2026/10/a.jpg", bytes("photo"), "image/jpeg");
    expect(new TextDecoder().decode((await s.get("request_room/2026/10/a.jpg"))!)).toBe("photo");
    await s.delete("request_room/2026/10/a.jpg");
    expect(await s.get("request_room/2026/10/a.jpg")).toBeNull();
  });

  it("не выходит за пределы своей папки", async () => {
    await expect(storage().get("../outside.txt")).rejects.toThrow();
    await expect(storage().put("../../x", bytes("x"), "text/plain")).rejects.toThrow();
  });

  it("ссылка на скачивание подписана HMAC и проверяется", async () => {
    const url = await storage().downloadUrl("stage_report/2026/10/b.jpg", { expiresInSec: 300 });
    expect(url.startsWith("/api/files/stage_report/2026/10/b.jpg?")).toBe(true);
    expect(verifyDownload(queryOf(url), SIGN)).toBe(true);
  });

  it("цель загрузки — наш маршрут с токеном", async () => {
    const target = await storage().uploadTarget!("uploads/x", { contentType: "image/jpeg", maxBytes: 10, expiresInSec: 60, token: "t.k" });
    expect(target).toEqual({ kind: "http", url: "/api/files/upload?token=t.k", method: "PUT", headers: { "content-type": "image/jpeg" } });
  });
});

describe("static (public/)", () => {
  const storage = () => createStaticStorage(path.join(dir, "public"));

  beforeAll(async () => {
    await mkdir(path.join(dir, "public", "demo", "portfolio"), { recursive: true });
    await writeFile(path.join(dir, "public", "demo", "portfolio", "kitchen.svg"), "<svg/>");
  });

  it("читает файл из public/ по ключу и отдаёт публичный адрес", async () => {
    const s = storage();
    expect(new TextDecoder().decode((await s.get("demo/portfolio/kitchen.svg"))!)).toBe("<svg/>");
    expect(await s.downloadUrl("demo/portfolio/kitchen.svg", { expiresInSec: 60 })).toBe("/demo/portfolio/kitchen.svg");
    expect(await s.get("demo/portfolio/none.svg")).toBeNull();
  });

  it("только чтение: запись и удаление запрещены, загрузки нет", async () => {
    const s = storage();
    const put = await s.put("demo/x.svg", bytes("x"), "image/svg+xml").catch((e: unknown) => e);
    expect(isAppError(put) && put.code).toBe("FORBIDDEN");
    const del = await s.delete("demo/portfolio/kitchen.svg").catch((e: unknown) => e);
    expect(isAppError(del) && del.code).toBe("FORBIDDEN");
    expect(s.uploadTarget).toBeUndefined();
  });

  it("не выходит за пределы public/", async () => {
    await expect(storage().get("../secret.txt")).rejects.toThrow();
  });
});

describe("s3 (на моке клиента)", () => {
  function fake() {
    const sent: { name: string; input: Record<string, unknown> }[] = [];
    const objects = new Map<string, Uint8Array>();
    const deps: S3Deps = {
      bucket: "senim",
      client: {
        async send(command) {
          const name = command.constructor.name;
          const input: Record<string, unknown> = Object.fromEntries(Object.entries(command.input));
          sent.push({ name, input });
          const key = String(input.Key);
          if (name === "PutObjectCommand") objects.set(key, input.Body as Uint8Array);
          if (name === "DeleteObjectCommand") objects.delete(key);
          if (name === "GetObjectCommand") {
            const body = objects.get(key);
            if (!body) throw Object.assign(new Error("NoSuchKey"), { name: "NoSuchKey" });
            return { Body: { transformToByteArray: async () => body } };
          }
          return {};
        },
      },
      presign: async (command, opts) => `https://s3.example/${command.constructor.name}/${String((command.input as { Key: string }).Key)}?ttl=${opts.expiresIn}`,
    };
    return { storage: createS3Storage(deps), sent };
  }

  it("put/get/delete идут в нужный бакет с ключом и типом", async () => {
    const { storage, sent } = fake();
    await storage.put("deal/2026/10/a.pdf", bytes("pdf"), "application/pdf");
    expect(sent[0]).toMatchObject({ name: "PutObjectCommand", input: { Bucket: "senim", Key: "deal/2026/10/a.pdf", ContentType: "application/pdf" } });
    expect(new TextDecoder().decode((await storage.get("deal/2026/10/a.pdf"))!)).toBe("pdf");
    await storage.delete("deal/2026/10/a.pdf");
    expect(await storage.get("deal/2026/10/a.pdf")).toBeNull();
  });

  it("ссылка на скачивание — подписанный GET со сроком, без обращения к сети", async () => {
    const { storage, sent } = fake();
    expect(await storage.downloadUrl("k.pdf", { expiresInSec: 120 })).toBe("https://s3.example/GetObjectCommand/k.pdf?ttl=120");
    expect(sent).toHaveLength(0);
  });

  it("имя файла попадает в Content-Disposition ответа", async () => {
    let signed: Record<string, unknown> = {};
    const storage = createS3Storage({
      bucket: "senim",
      client: { send: async () => ({}) },
      presign: async (command) => {
        signed = Object.fromEntries(Object.entries(command.input));
        return "u";
      },
    });
    await storage.downloadUrl("k.pdf", { expiresInSec: 1, fileName: "Договор.pdf" });
    expect(signed).toMatchObject({ Bucket: "senim", Key: "k.pdf" });
    expect(String(signed.ResponseContentDisposition)).toBe(
      "attachment; filename=\"file.pdf\"; filename*=UTF-8''%D0%94%D0%BE%D0%B3%D0%BE%D0%B2%D0%BE%D1%80.pdf",
    );
  });

  it("цель загрузки — подписанный PUT с типом в заголовке", async () => {
    const { storage } = fake();
    const target = await storage.uploadTarget!("uploads/x", { contentType: "image/jpeg", maxBytes: 10, expiresInSec: 600, token: "t" });
    expect(target).toEqual({ kind: "http", url: "https://s3.example/PutObjectCommand/uploads/x?ttl=600", method: "PUT", headers: { "content-type": "image/jpeg" } });
  });
});

describe("vercel-blob (на моке SDK)", () => {
  function fake() {
    const calls: { fn: string; args: unknown[] }[] = [];
    const objects = new Map<string, Uint8Array>();
    let now = 1_000_000;
    const sdk: BlobSdk = {
      put: async (pathname, body, opts) => {
        calls.push({ fn: "put", args: [pathname, opts] });
        objects.set(pathname, new Uint8Array(body));
      },
      get: async (pathname, opts) => {
        calls.push({ fn: "get", args: [pathname, opts] });
        const body = objects.get(pathname);
        return body ? new Blob([new Uint8Array(body)]).stream() : null;
      },
      del: async (pathname, opts) => {
        calls.push({ fn: "del", args: [pathname, opts] });
        objects.delete(pathname);
      },
      clientToken: async (opts) => {
        calls.push({ fn: "clientToken", args: [opts] });
        return "client-token";
      },
      signedToken: async (opts) => {
        calls.push({ fn: "signedToken", args: [opts] });
        return { delegationToken: "d", clientSigningToken: "c", validUntil: opts.validUntil };
      },
      presignGet: async (_signed, opts) => `https://blob.example/${opts.pathname}?until=${opts.validUntil}`,
      now: () => now,
    };
    return { storage: createBlobStorage("rw-token", sdk), calls, tick: (ms: number) => (now += ms) };
  }

  it("пишет и читает приватные объекты с токеном хранилища", async () => {
    const { storage, calls } = fake();
    await storage.put("a/b.jpg", bytes("x"), "image/jpeg");
    expect(calls[0]).toEqual({ fn: "put", args: ["a/b.jpg", { access: "private", contentType: "image/jpeg", token: "rw-token", addRandomSuffix: false, allowOverwrite: true }] });
    expect(new TextDecoder().decode((await storage.get("a/b.jpg"))!)).toBe("x");
    await storage.delete("a/b.jpg");
    expect(await storage.get("a/b.jpg")).toBeNull();
  });

  it("цель загрузки — клиентский токен, ограниченный ключом, типом и размером", async () => {
    const { storage, calls } = fake();
    const target = await storage.uploadTarget!("uploads/x", { contentType: "image/jpeg", maxBytes: 5000, expiresInSec: 600, token: "t" });
    expect(target).toEqual({ kind: "vercel-blob", pathname: "uploads/x", clientToken: "client-token", contentType: "image/jpeg" });
    expect(calls[0]!.args[0]).toEqual({
      token: "rw-token",
      pathname: "uploads/x",
      allowedContentTypes: ["image/jpeg"],
      maximumSizeInBytes: 5000,
      validUntil: 1_000_000 + 600_000,
      addRandomSuffix: false,
      allowOverwrite: true,
    });
  });

  it("ссылки на скачивание подписываются одним токеном чтения, пока он не устарел", async () => {
    const { storage, calls, tick } = fake();
    expect(await storage.downloadUrl("a.jpg", { expiresInSec: 60 })).toBe("https://blob.example/a.jpg?until=1060000");
    await storage.downloadUrl("b.jpg", { expiresInSec: 60 });
    expect(calls.filter((c) => c.fn === "signedToken")).toHaveLength(1);
    tick(2 * 3600 * 1000);
    await storage.downloadUrl("c.jpg", { expiresInSec: 60 });
    expect(calls.filter((c) => c.fn === "signedToken")).toHaveLength(2);
  });
});
