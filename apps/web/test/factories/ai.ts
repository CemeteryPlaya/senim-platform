import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import sharp from "sharp";
import type { RequestStatus } from "@/generated/prisma/enums";
import type { CurrentUser } from "@/modules/identity";
import { attachFiles, saveFile } from "@/modules/files";
import { db } from "@/platform/db";
import { resetEnvCache } from "@/platform/env";

/**
 * Фабрики для тестов ai-модуля. Заявка — чужой модуль, поэтому пишется прямо в БД;
 * фото помещения сохраняется через files (как при загрузке заказчиком).
 */

/** Окружение ИИ для теста: флаг, мок-провайдер, локальное хранилище во временной папке. */
export async function useAiEnv(overrides: Record<string, string> = {}) {
  const dir = await mkdtemp(path.join(tmpdir(), "senim-ai-"));
  Object.assign(process.env, {
    AI_ENABLED: "true",
    AI_PROVIDER: "mock",
    AI_MAX_VISUALIZATIONS_PER_REQUEST: "2",
    STORAGE_PROVIDER: "local",
    STORAGE_LOCAL_DIR: dir,
    ...overrides,
  });
  resetEnvCache();
  return dir;
}

export async function makeKitchenType() {
  return db.furnitureType.upsert({ where: { slug: "kitchen" }, create: { slug: "kitchen", name: "Кухня" }, update: {} });
}

export async function makeRequest(client: CurrentUser, status: RequestStatus = "DRAFT") {
  return db.request.create({ data: { clientId: client.id, mode: "TENDER", status } });
}

/** Фото помещения, прикреплённое к заявке. */
export async function makeRoomPhoto(client: CurrentUser, requestId: string) {
  const bytes = await sharp({ create: { width: 800, height: 600, channels: 3, background: "#d9d3c7" } }).jpeg().toBuffer();
  const file = await saveFile({ purpose: "REQUEST_ROOM", bytes: new Uint8Array(bytes), uploadedById: client.id });
  await attachFiles(db, { fileIds: [file.id], uploadedById: client.id, owner: { requestId } });
  return file;
}
