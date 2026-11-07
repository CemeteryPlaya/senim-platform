import type { FilePurpose } from "@/generated/prisma/enums";
import type { CurrentUser } from "@/modules/identity";
import { createDeal, onDocumentSigned, payForDeal, registerRequestsPort, startWork, submitReady } from "@/modules/deal-core";
import { requestsPort } from "@/modules/requests";
import { db, transaction } from "@/platform/db";
import { resetEnvCache } from "@/platform/env";
import { makeClient, makeExecutor, makeOperator } from "../factories";

/**
 * Фабрики сделок для тестов deal-core и payments (ADR-009). Сделка создаётся настоящим createDeal;
 * документы — записью без PDF (порт documents не зарегистрирован; PDF — useDocuments из ./documents), подпись —
 * как это сделает documents: документ SIGNED → хук onDocumentSigned в той же транзакции.
 * Порт заявок — как на сервере (src/ports.ts): оферта закрывает заявку, отмена — отменяет. Регистрация здесь,
 * а не в setup-файле: импорт модулей там опередил бы vi.mock("next/headers") тестов маршрутов.
 */
registerRequestsPort(requestsPort);

export type Executor = CurrentUser & { executor: NonNullable<CurrentUser["executor"]> };
export type DealFixture = { dealId: string; requestId: string; offerId: string; client: CurrentUser; executor: Executor };

/** Байтерек (Астана): адрес заказа в тестах с GPS. */
export const ADDRESS = { lat: 51.128207, lng: 71.430411 };
export const PRICE = 100_000_00n; // 100 000 ₸

/** Временно меняет PAYMENT_PROVIDER (провайдер новой сделки). */
export async function withProvider<T>(provider: "mock" | "manual", fn: () => Promise<T>): Promise<T> {
  const prev = process.env.PAYMENT_PROVIDER;
  process.env.PAYMENT_PROVIDER = provider;
  resetEnvCache();
  try {
    return await fn();
  } finally {
    if (prev === undefined) delete process.env.PAYMENT_PROVIDER;
    else process.env.PAYMENT_PROVIDER = prev;
    resetEnvCache();
  }
}

/** Заявка с адресом, отклик мастера и сделка (оферта) через настоящий createDeal. */
export async function makeDeal(
  opts: { priceTiyn?: bigint; provider?: "mock" | "manual"; client?: CurrentUser; executor?: Executor; address?: { lat: number; lng: number } | null } = {},
): Promise<DealFixture> {
  const client = opts.client ?? (await makeClient());
  const executor = opts.executor ?? (await makeExecutor());
  const address = opts.address === undefined ? ADDRESS : opts.address;
  const priceTiyn = opts.priceTiyn ?? PRICE;
  const request = await db.request.create({
    data: { clientId: client.id, mode: "TENDER", status: "CONTRACTING", addressLat: address?.lat ?? null, addressLng: address?.lng ?? null },
  });
  const offer = await db.offer.create({
    data: { requestId: request.id, executorId: executor.executor.id, priceTiyn, durationDays: 30, warrantyMonths: 12, measurementTerms: "FREE", status: "ACCEPTED" },
  });
  const { dealId } = await withProvider(opts.provider ?? "mock", () =>
    transaction((tx) => createDeal(tx, { requestId: request.id, offerId: offer.id, priceTiyn, title: "Тестовый заказ" })),
  );
  return { dealId, requestId: request.id, offerId: offer.id, client, executor };
}

async function signLatest(dealId: string, kind: "CONTRACT" | "ACCEPTANCE_ACT") {
  const doc = await db.document.findFirstOrThrow({ where: { dealId, kind }, orderBy: { version: "desc" } });
  await transaction(async (tx) => {
    await tx.document.update({ where: { id: doc.id }, data: { status: "SIGNED", signedAt: new Date() } });
    await onDocumentSigned(tx, doc.id);
  });
  return doc.id;
}

export const signContract = (dealId: string) => signLatest(dealId, "CONTRACT");
export const signAct = (dealId: string) => signLatest(dealId, "ACCEPTANCE_ACT");

/** Фото, загруженное пользователем (как это сделает модуль files), ещё не прикреплённое. */
export async function makePhoto(user: CurrentUser, purpose: FilePurpose = "DELIVERY") {
  const file = await db.storedFile.create({
    data: {
      storageKey: `test/${purpose}/${Math.random().toString(36).slice(2)}.jpg`,
      provider: "local",
      purpose,
      contentType: purpose === "BANK_DOCUMENT" ? "application/pdf" : "image/jpeg",
      size: 1024,
      sha256: "0".repeat(64),
      uploadedById: user.id,
    },
  });
  return file.id;
}

export const dealOf = (dealId: string) => db.deal.findUniqueOrThrow({ where: { id: dealId } });
export const journalOf = (dealId: string) => db.moneyTransaction.findMany({ where: { dealId }, orderBy: { seq: "asc" } });

/** Сделка на нужном шаге настоящим путём: подпись оферты → оплата → начало → сдача. */
export async function dealAt(step: "SIGNED" | "PAID_HOLD" | "IN_PROGRESS" | "READY", opts: Parameters<typeof makeDeal>[0] = {}): Promise<DealFixture> {
  const f = await makeDeal(opts);
  await signContract(f.dealId);
  if (step === "SIGNED") return f;
  await payForDeal(f.client, { dealId: f.dealId });
  if ((opts.provider ?? "mock") === "manual") await confirmPending(f.dealId, "HOLD");
  if (step === "PAID_HOLD") return f;
  await startWork(f.executor, { dealId: f.dealId });
  if (step === "IN_PROGRESS") return f;
  await submitReady(f.executor, { dealId: f.dealId, photoIds: [await makePhoto(f.executor)], ...ADDRESS, accuracyM: 10 });
  return f;
}

let operator: CurrentUser | null = null;

/** manual: оператор подтверждает ждущие операции типа банковским документом. */
export async function confirmPending(dealId: string, type: "HOLD" | "RELEASE" | "SPLIT_MASTER" | "SPLIT_PLATFORM" | "REFUND") {
  const { confirmManualOperation } = await import("@/modules/payments");
  const { onMoneySettled } = await import("@/modules/deal-core");
  operator = operator && (await db.user.findUnique({ where: { id: operator.id } })) ? operator : await makeOperator();
  const op = await db.moneyTransaction.findFirstOrThrow({ where: { dealId, type, status: "PENDING" } });
  await confirmManualOperation(operator, { transactionId: op.id, bankDocNumber: `П-${op.seq}`, bankDocDate: new Date(), bankDocFileId: await makePhoto(operator, "BANK_DOCUMENT") }, onMoneySettled);
}
