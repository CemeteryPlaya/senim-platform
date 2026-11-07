import type { StorageProvider } from "../storage";

type SignedToken = { delegationToken: string; clientSigningToken: string; validUntil: number };

/** Нужные нам функции @vercel/blob; в тестах подменяются. */
export type BlobSdk = {
  put(pathname: string, body: Uint8Array, opts: { access: "private"; contentType: string; token: string; addRandomSuffix: false; allowOverwrite: true }): Promise<void>;
  get(pathname: string, opts: { access: "private"; token: string }): Promise<ReadableStream<Uint8Array> | null>;
  del(pathname: string, opts: { token: string }): Promise<void>;
  clientToken(opts: {
    token: string;
    pathname: string;
    allowedContentTypes: string[];
    maximumSizeInBytes: number;
    validUntil: number;
    addRandomSuffix: false;
    allowOverwrite: true;
  }): Promise<string>;
  signedToken(opts: { token: string; pathname: "*"; operations: ["get"]; validUntil: number }): Promise<SignedToken>;
  presignGet(signed: SignedToken, opts: { operation: "get"; pathname: string; access: "private"; validUntil: number }): Promise<string>;
  now(): number;
};

/** Токен чтения на всё хранилище живёт час; новую ссылку подписываем им без обращения к API. */
const READ_TOKEN_TTL_MS = 3600_000;
const READ_TOKEN_MARGIN_MS = 15 * 60_000;

/**
 * Vercel Blob для демо. Хранилище приватное: объект доступен только по подписанной ссылке.
 * Браузер загружает напрямую в Blob (`put` из @vercel/blob/client) с клиентским токеном,
 * ограниченным ключом, типом, размером и сроком.
 */
export function createBlobStorage(token: string, sdk: BlobSdk): StorageProvider {
  let readToken: SignedToken | undefined;

  async function readTokenFor(until: number): Promise<SignedToken> {
    if (!readToken || readToken.validUntil - READ_TOKEN_MARGIN_MS < until) {
      readToken = await sdk.signedToken({ token, pathname: "*", operations: ["get"], validUntil: sdk.now() + READ_TOKEN_TTL_MS });
    }
    return readToken;
  }

  return {
    name: "vercel-blob",
    async put(key, body, contentType) {
      await sdk.put(key, body, { access: "private", contentType, token, addRandomSuffix: false, allowOverwrite: true });
    },
    async get(key) {
      const stream = await sdk.get(key, { access: "private", token });
      return stream ? new Uint8Array(await new Response(stream).arrayBuffer()) : null;
    },
    async delete(key) {
      await sdk.del(key, { token });
    },
    async downloadUrl(key, opts) {
      // Имя файла у подписанного GET Blob не задаётся; документы скачиваются под ключом.
      const validUntil = sdk.now() + opts.expiresInSec * 1000;
      return sdk.presignGet(await readTokenFor(validUntil), { operation: "get", pathname: key, access: "private", validUntil });
    },
    async uploadTarget(key, opts) {
      const clientToken = await sdk.clientToken({
        token,
        pathname: key,
        allowedContentTypes: [opts.contentType],
        maximumSizeInBytes: opts.maxBytes,
        validUntil: sdk.now() + opts.expiresInSec * 1000,
        addRandomSuffix: false,
        allowOverwrite: true,
      });
      return { kind: "vercel-blob", pathname: key, clientToken, contentType: opts.contentType };
    },
  };
}

/** Настоящий SDK. Импорт ленивый: без Blob (local, s3) пакет не загружается. */
export async function blobStorageFromToken(token: string): Promise<StorageProvider> {
  const [{ put, get, del, issueSignedToken, presignUrl }, { generateClientTokenFromReadWriteToken }] = await Promise.all([
    import("@vercel/blob"),
    import("@vercel/blob/client"),
  ]);
  return createBlobStorage(token, {
    put: async (pathname, body, opts) => {
      await put(pathname, Buffer.from(body), opts);
    },
    get: async (pathname, opts) => {
      const result = await get(pathname, opts);
      return result?.statusCode === 200 ? result.stream : null;
    },
    del: (pathname, opts) => del(pathname, opts),
    clientToken: (opts) => generateClientTokenFromReadWriteToken(opts),
    signedToken: (opts) => issueSignedToken(opts),
    presignGet: async (signed, opts) => (await presignUrl(signed, opts)).presignedUrl,
    now: () => Date.now(),
  });
}
