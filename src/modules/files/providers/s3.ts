import { DeleteObjectCommand, GetObjectCommand, PutObjectCommand, S3Client } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { contentDisposition } from "../disposition";
import type { StorageProvider } from "../storage";

type S3Command = PutObjectCommand | GetObjectCommand | DeleteObjectCommand;

/** Зависимости провайдера: клиент и подпись подменяются в тестах. */
export type S3Deps = {
  bucket: string;
  client: { send(command: S3Command): Promise<unknown> };
  presign(command: GetObjectCommand | PutObjectCommand, opts: { expiresIn: number }): Promise<string>;
};

export type S3Config = {
  endpoint: string;
  region: string;
  bucket: string;
  accessKeyId: string;
  secretAccessKey: string;
};

function isNotFound(e: unknown): boolean {
  const err = e as { name?: string; $metadata?: { httpStatusCode?: number } };
  return err?.name === "NoSuchKey" || err?.name === "NotFound" || err?.$metadata?.httpStatusCode === 404;
}

/** Любое S3-совместимое хранилище (в том числе облако в РК): path-style адреса, подписанные GET/PUT. */
export function createS3Storage(deps: S3Deps): StorageProvider {
  const { bucket, client, presign } = deps;
  return {
    name: "s3",
    async put(key, body, contentType) {
      await client.send(new PutObjectCommand({ Bucket: bucket, Key: key, Body: body, ContentType: contentType }));
    },
    async get(key) {
      try {
        const out = (await client.send(new GetObjectCommand({ Bucket: bucket, Key: key }))) as {
          Body?: { transformToByteArray(): Promise<Uint8Array> };
        };
        return out.Body ? await out.Body.transformToByteArray() : null;
      } catch (e) {
        if (isNotFound(e)) return null;
        throw e;
      }
    },
    async delete(key) {
      await client.send(new DeleteObjectCommand({ Bucket: bucket, Key: key }));
    },
    async downloadUrl(key, opts) {
      const command = new GetObjectCommand({
        Bucket: bucket,
        Key: key,
        ResponseContentDisposition: opts.fileName ? contentDisposition(opts.fileName) : undefined,
      });
      return presign(command, { expiresIn: opts.expiresInSec });
    },
    async uploadTarget(key, opts) {
      // Тип подписан: браузер обязан прислать тот же Content-Type. Размер проверяет finalizeUpload.
      const command = new PutObjectCommand({ Bucket: bucket, Key: key, ContentType: opts.contentType });
      const url = await presign(command, { expiresIn: opts.expiresInSec });
      return { kind: "http", url, method: "PUT", headers: { "content-type": opts.contentType } };
    },
  };
}

export function s3StorageFromConfig(config: S3Config): StorageProvider {
  const client = new S3Client({
    endpoint: config.endpoint,
    region: config.region,
    forcePathStyle: true,
    credentials: { accessKeyId: config.accessKeyId, secretAccessKey: config.secretAccessKey },
  });
  return createS3Storage({
    bucket: config.bucket,
    client: { send: (command) => client.send(command) },
    presign: (command, opts) => getSignedUrl(client, command, opts),
  });
}
