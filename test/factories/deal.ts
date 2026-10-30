import type { StageStatus } from "@/generated/prisma/enums";
import type { CurrentUser } from "@/modules/identity";
import { afterSigning, createDeal, onDocumentSigned, type StageTemplate } from "@/modules/deal-core";
import type { RailMode } from "@/modules/payments";
import { db, transaction } from "@/platform/db";
import { resetEnvCache } from "@/platform/env";
import { makeClient, makeExecutor } from "../factories";

/**
 * Фабрики сделок для тестов deal-core и payments. Шаблоны этапов — обезличенные:
 * ядро не знает про мебель, мебельные шаблоны живут в verticals/furniture.
 */
export const TEMPLATES = {
  /** Аванс 50% до начала, этап без оплаты, остаток после приёмки. */
  advance: {
    key: "test-advance",
    name: "Аванс",
    description: "",
    stages: [
      { title: "Аванс", description: "", sharePercent: 50, paymentDue: "ON_START" },
      { title: "Работа", description: "", sharePercent: 0, paymentDue: "ON_ACCEPTANCE" },
      { title: "Сдача", description: "", sharePercent: 50, paymentDue: "ON_ACCEPTANCE" },
    ],
  },
  /** Один этап с оплатой после приёмки. */
  single: {
    key: "test-single",
    name: "Один этап",
    description: "",
    stages: [{ title: "Работа целиком", description: "", sharePercent: 100, paymentDue: "ON_ACCEPTANCE" }],
  },
} as const satisfies Record<string, StageTemplate>;

export type DealFixture = {
  dealId: string;
  requestId: string;
  client: CurrentUser;
  executor: CurrentUser & { executor: NonNullable<CurrentUser["executor"]> };
};

/** Заявка в CONTRACTING, принятый отклик и сделка через настоящий createDeal. */
export async function makeDeal(opts: { template?: StageTemplate; total?: number; rail?: RailMode } = {}): Promise<DealFixture> {
  const client = await makeClient();
  const executor = await makeExecutor();
  const total = opts.total ?? 100_000;
  const request = await db.request.create({ data: { clientId: client.id, mode: "TENDER", status: "CONTRACTING" } });
  const offer = await db.offer.create({
    data: {
      requestId: request.id,
      executorId: executor.executor.id,
      price: total,
      durationDays: 30,
      warrantyMonths: 12,
      measurementTerms: "FREE",
      status: "ACCEPTED",
    },
  });
  const { dealId } = await withRail(opts.rail ?? "manual", () =>
    transaction((tx) =>
      createDeal(tx, {
        requestId: request.id,
        offerId: offer.id,
        clientId: client.id,
        executorId: executor.executor.id,
        title: "Тестовый заказ",
        totalAmount: total,
        template: opts.template ?? TEMPLATES.advance,
      }),
    ),
  );
  return { dealId, requestId: request.id, client, executor };
}

/** Временно меняет PAYMENT_RAIL (режим новой сделки). */
export async function withRail<T>(rail: RailMode, fn: () => Promise<T>): Promise<T> {
  const prev = process.env.PAYMENT_RAIL;
  process.env.PAYMENT_RAIL = rail;
  resetEnvCache();
  try {
    return await fn();
  } finally {
    if (prev === undefined) delete process.env.PAYMENT_RAIL;
    else process.env.PAYMENT_RAIL = prev;
    resetEnvCache();
  }
}

/** Как documents: обе подписи есть → документ SIGNED → хук deal-core в той же транзакции. */
export async function signDocument(documentId: string) {
  await transaction(async (tx) => {
    await tx.document.update({ where: { id: documentId }, data: { status: "SIGNED", signedAt: new Date() } });
    await onDocumentSigned(tx, documentId);
  });
  await afterSigning(documentId);
}

export async function signContract(dealId: string) {
  const doc = await db.document.findFirstOrThrow({ where: { dealId, kind: "CONTRACT" }, orderBy: { version: "desc" } });
  await signDocument(doc.id);
}

export async function signAct(stageId: string) {
  const doc = await db.document.findFirstOrThrow({ where: { stageId, kind: "STAGE_ACT" }, orderBy: { version: "desc" } });
  await signDocument(doc.id);
}

/** Фото этапа, загруженное пользователем (как это сделает модуль files). */
export async function makeStagePhoto(user: CurrentUser, purpose: "STAGE_REPORT" | "DISPUTE" = "STAGE_REPORT") {
  const file = await db.storedFile.create({
    data: {
      storageKey: `test/${purpose}/${Math.random().toString(36).slice(2)}.jpg`,
      provider: "local",
      purpose,
      contentType: "image/jpeg",
      size: 1024,
      sha256: "0".repeat(64),
      uploadedById: user.id,
    },
  });
  return file.id;
}

export const stagesOf = (dealId: string) =>
  db.stage.findMany({ where: { dealId }, orderBy: { order: "asc" }, include: { payment: true } });

export const dealOf = (dealId: string) => db.deal.findUniqueOrThrow({ where: { id: dealId } });

/** Принудительно ставит статус этапа (для перебора «каждый статус × действие»). */
export async function forceStageStatus(stageId: string, status: StageStatus, extra: { autoAcceptAt?: Date | null } = {}) {
  await db.stage.update({ where: { id: stageId }, data: { status, ...extra } });
}
