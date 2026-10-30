import path from "node:path";
import { ru } from "@/i18n/ru";
import { env } from "@/platform/env";
import { fail } from "@/platform/errors";
import { createLocalStorage } from "./providers/local";
import { createStaticStorage } from "./providers/static";
import type { StorageName, StorageProvider } from "./storage";

const remote = new Map<"s3" | "vercel-blob", Promise<StorageProvider>>();

async function s3() {
  const e = env();
  if (!e.S3_ENDPOINT || !e.S3_REGION || !e.S3_BUCKET || !e.S3_ACCESS_KEY_ID || !e.S3_SECRET_ACCESS_KEY) {
    return fail.unavailable(ru.files.errors.s3NotConfigured);
  }
  const { s3StorageFromConfig } = await import("./providers/s3");
  return s3StorageFromConfig({
    endpoint: e.S3_ENDPOINT,
    region: e.S3_REGION,
    bucket: e.S3_BUCKET,
    accessKeyId: e.S3_ACCESS_KEY_ID,
    secretAccessKey: e.S3_SECRET_ACCESS_KEY,
  });
}

async function blob() {
  const token = env().BLOB_READ_WRITE_TOKEN;
  if (!token) return fail.unavailable(ru.files.errors.blobNotConnected);
  const { blobStorageFromToken } = await import("./providers/blob");
  return blobStorageFromToken(token);
}

function cached(name: "s3" | "vercel-blob", make: () => Promise<StorageProvider>) {
  let p = remote.get(name);
  if (!p) {
    p = make();
    p.catch(() => remote.delete(name)); // ошибку настройки не кэшируем
    remote.set(name, p);
  }
  return p;
}

/**
 * Провайдер по имени из StoredFile.provider: файл читается тем, чем записан,
 * даже если сейчас для новых файлов выбран другой (демо-файлы static рядом с local или blob).
 * SDK S3 и Blob загружаются лениво — без них local работает.
 */
export async function storageByName(name: string): Promise<StorageProvider> {
  switch (name as StorageName) {
    case "local":
      return createLocalStorage(env().STORAGE_LOCAL_DIR);
    case "static":
      return createStaticStorage(path.join(process.cwd(), "public"));
    case "s3":
      return cached("s3", s3);
    case "vercel-blob":
      return cached("vercel-blob", blob);
    default:
      throw new Error(`Неизвестный провайдер хранилища: ${name}`);
  }
}

/** Хранилище для новых файлов (STORAGE_PROVIDER). */
export function storage(): Promise<StorageProvider> {
  return storageByName(env().STORAGE_PROVIDER);
}

/** Срок жизни ссылки для экрана: хватает на просмотр страницы и открытие фото. */
const SCREEN_URL_TTL_SEC = 60 * 60;

/**
 * Адрес файла для экрана (<img src>, ссылка на PDF). Права проверяет экран:
 * он уже загрузил сущность-владельца по правилам своего модуля (или вызвал canReadFile).
 */
export async function fileUrl(
  file: { provider: string; storageKey: string },
  opts: { expiresInSec?: number; fileName?: string } = {},
): Promise<string> {
  const provider = await storageByName(file.provider);
  return provider.downloadUrl(file.storageKey, { expiresInSec: opts.expiresInSec ?? SCREEN_URL_TTL_SEC, fileName: opts.fileName });
}
