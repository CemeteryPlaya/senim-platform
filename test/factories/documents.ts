import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import sharp from "sharp";
import type { CurrentUser } from "@/modules/identity";
import { registerDocumentsPort, type DocumentsPort } from "@/modules/deal-core";
import { completeSigning, documentsPort, signByHand, startSigning } from "@/modules/documents";
import { storage } from "@/modules/files";
import { sha256Hex } from "@/platform/crypto";
import { db } from "@/platform/db";
import { setEnv } from "./identity";

/**
 * Фабрики для тестов documents: настоящий порт документов (PDF) вместо временного адаптера deal-core,
 * локальное хранилище во временной папке и подпись сторон через настоящий сервис (mock ЭЦП).
 */

const registry = globalThis as unknown as { senimDocumentsPort?: DocumentsPort };

/** Включить порт documents и локальное хранилище; вернуть уборку. */
export async function useDocuments(): Promise<() => Promise<void>> {
  const dir = await mkdtemp(path.join(os.tmpdir(), "senim-documents-"));
  setEnv({ STORAGE_PROVIDER: "local", STORAGE_LOCAL_DIR: dir, SIGNATURE_PROVIDER: "mock" });
  registerDocumentsPort(documentsPort);
  return async () => {
    delete registry.senimDocumentsPort;
    await rm(dir, { recursive: true, force: true });
  };
}

/**
 * Для тестов сида (src/demo): хранилище во временной папке (сид загружает фото, сканы и PDF через files);
 * сид сам регистрирует порты (src/ports.ts) — после файла порт документов снимается.
 */
export async function useSeedStorage(): Promise<() => Promise<void>> {
  const dir = await mkdtemp(path.join(os.tmpdir(), "senim-seed-"));
  setEnv({ STORAGE_PROVIDER: "local", STORAGE_LOCAL_DIR: dir, SIGNATURE_PROVIDER: "mock" });
  return async () => {
    delete registry.senimDocumentsPort;
    await rm(dir, { recursive: true, force: true });
  };
}

/** Рисунок подписи как с холста: PNG 300×100 с росчерком. */
export async function signaturePng(): Promise<Uint8Array> {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="300" height="100"><path d="M10 70 C 60 10, 110 90, 160 40 S 260 60, 290 30" stroke="#151a22" stroke-width="4" fill="none"/></svg>`;
  return new Uint8Array(await sharp(Buffer.from(svg)).png().toBuffer());
}

/** Фото сдачи с настоящими байтами в хранилище (как после files.finalizeUpload), ещё не прикреплённое. */
export async function storedPhoto(user: CurrentUser): Promise<string> {
  const bytes = new Uint8Array(await sharp({ create: { width: 64, height: 48, channels: 3, background: { r: 200, g: 180, b: 150 } } }).jpeg().toBuffer());
  const provider = await storage();
  const storageKey = `delivery/test/${Math.random().toString(36).slice(2)}.jpg`;
  await provider.put(storageKey, bytes, "image/jpeg");
  const file = await db.storedFile.create({
    data: { storageKey, provider: provider.name, purpose: "DELIVERY", contentType: "image/jpeg", size: bytes.length, sha256: sha256Hex(bytes), uploadedById: user.id },
  });
  return file.id;
}

/** Подпись ЭЦП стороной (mock: QR → «я подписал»). */
export async function signEcp(user: CurrentUser, documentId: string) {
  const session = await startSigning(user, documentId, "EGOV_QR");
  return completeSigning(user, { documentId, sessionId: session.sessionId });
}

/** Собственноручная подпись напечатанным именем (клавиатурная альтернатива холсту). */
export const signTyped = (user: CurrentUser, documentId: string) => signByHand(user, { documentId, typedName: user.fullName ?? "Подписант" });

export const latestDocument = (dealId: string, kind: "CONTRACT" | "ACCEPTANCE_ACT" | "MONEY_STATEMENT" | "RELEASE_RECEIPT") =>
  db.document.findFirstOrThrow({ where: { dealId, kind, status: { not: "SUPERSEDED" } }, orderBy: { version: "desc" } });
