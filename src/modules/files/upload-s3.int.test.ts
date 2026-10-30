import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { resetEnvCache } from "@/platform/env";
import { isAppError } from "@/platform/errors";
import { makeClient } from "../../../test/factories";
import { createUpload, finalizeUpload } from "./index";

/** S3 в памяти: какие команды ушли и какие объекты лежат. Подменяем только сеть — провайдер настоящий. */
const s3 = vi.hoisted(() => ({ sent: [] as string[], objects: new Map<string, Uint8Array>() }));

vi.mock("./providers/s3", async (importOriginal) => {
  const real = await importOriginal<typeof import("./providers/s3")>();
  return {
    ...real,
    s3StorageFromConfig: () =>
      real.createS3Storage({
        bucket: "senim",
        presign: async (command) => `https://s3.example/${String((command.input as { Key: string }).Key)}`,
        client: {
          async send(command) {
            const name = command.constructor.name;
            const key = String((command.input as { Key: string }).Key);
            s3.sent.push(`${name} ${key}`);
            const body = s3.objects.get(key);
            const missing = () => Object.assign(new Error("NotFound"), { name: "NotFound", $metadata: { httpStatusCode: 404 } });
            if (name === "HeadObjectCommand") {
              if (!body) throw missing();
              return { ContentLength: body.length };
            }
            if (name === "GetObjectCommand") {
              if (!body) throw missing();
              return { Body: { transformToByteArray: async () => body } };
            }
            if (name === "DeleteObjectCommand") s3.objects.delete(key);
            return {};
          },
        },
      }),
  };
});

const S3_ENV = { STORAGE_PROVIDER: "s3", S3_ENDPOINT: "https://s3.example", S3_REGION: "kz", S3_BUCKET: "senim", S3_ACCESS_KEY_ID: "k", S3_SECRET_ACCESS_KEY: "s" };
const saved: Record<string, string | undefined> = {};

beforeAll(() => {
  for (const [k, v] of Object.entries(S3_ENV)) {
    saved[k] = process.env[k];
    process.env[k] = v;
  }
  resetEnvCache();
});
afterAll(() => {
  for (const [k, v] of Object.entries(saved)) {
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
  resetEnvCache();
});

describe("загрузка в S3: размер по HEAD до чтения", () => {
  it("объект больше лимита назначения не читается в память и удаляется", async () => {
    const client = await makeClient();
    const { token } = await createUpload(client, { purpose: "REQUEST_ROOM", contentType: "image/jpeg", size: 100 });
    const stagingKey = JSON.parse(Buffer.from(token.split(".")[0]!, "base64url").toString()).stagingKey as string;
    // браузер заявил 100 байт, а по подписанному PUT залил 26 МБ
    s3.objects.set(stagingKey, new Uint8Array(26 * 1024 * 1024));

    const error = await finalizeUpload(client, { token }).catch((e: unknown) => e);

    expect(isAppError(error) && error.message).toMatch(/больше 25 МБ/);
    expect(s3.sent).toContain(`HeadObjectCommand ${stagingKey}`);
    expect(s3.sent).not.toContain(`GetObjectCommand ${stagingKey}`);
    expect(s3.sent).toContain(`DeleteObjectCommand ${stagingKey}`);
    expect(s3.objects.has(stagingKey)).toBe(false);
  });

  it("незагруженный объект — понятная ошибка без чтения", async () => {
    const client = await makeClient();
    const { token } = await createUpload(client, { purpose: "REQUEST_ROOM", contentType: "image/jpeg", size: 100 });
    const error = await finalizeUpload(client, { token }).catch((e: unknown) => e);
    expect(isAppError(error) && error.code).toBe("VALIDATION");
  });
});
