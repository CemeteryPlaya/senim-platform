import type { DocumentKind } from "@/generated/prisma/enums";
import { sha256Hex } from "@/platform/crypto";
import type { Tx } from "@/platform/db";
import { logger } from "@/platform/logger";

/**
 * Зависимости deal-core от других модулей — в одном месте.
 *
 * companies — прямой импорт (companies не импортирует deal-core).
 * documents — порт: deal-core не импортирует documents (documents сам читает данные сделки через
 * deal-core.dealDocumentData и вызывает deal-core.onContractSigned / onActSigned). Реализацию порта
 * регистрирует точка сборки src/ports.ts (registerPorts) — её зовут instrumentation (сервер Next), src/jobs.ts
 * (задачи) и сид. requests — тоже порт: requests импортирует deal-core (createDeal).
 */
export { applyPortfolioConsent, executorDisplayOf, executorDisplays, maskContacts, recalculateRating, sanitizeExecutorText } from "@/modules/companies";
// Фото сдачи, «Хода работ» и спора прикрепляет files: свой файл, нужного назначения, ещё ничей.
export { attachFiles as attachOwnFiles } from "@/modules/files";

export type CreatedDocument = { documentId: string; sha256: string };

export type DocumentsPort = {
  /** Оферта (DocumentKind.CONTRACT) по сделке — при createDeal, в той же транзакции. */
  createContract: (tx: Tx, dealId: string) => Promise<CreatedDocument>;
  /** Акт приёмки (ACCEPTANCE_ACT) с фото и GPS сдачи — при переходе в READY, в той же транзакции. */
  createAcceptanceAct: (tx: Tx, dealId: string) => Promise<CreatedDocument>;
};

/**
 * Порт заявок: deal-core сообщает requests о судьбе сделки (requests импортирует deal-core — обратный импорт дал бы цикл).
 * Оба вызова — в транзакции перехода сделки и идемпотентны (повтор и заявка не в том статусе ничего не меняют).
 */
export type RequestsPort = {
  /** Оферта заключена (Deal.signedAt): заявка CONTRACTING → CLOSED. */
  onContractSigned: (tx: Tx, dealId: string) => Promise<void>;
  /** Сделка закончилась без выплаты мастеру — отмена до или после оплаты, полный возврат по спору: заявка → CANCELLED. */
  onDealCancelled: (tx: Tx, dealId: string) => Promise<void>;
};

/**
 * Без регистрации (точка сборки src/ports.ts не вызвана — юнит-тесты, скрипты): оферта и акт — запись документа
 * без PDF (хэш условий сделки), заявка не трогается (предупреждение в журнал).
 */
async function documentWithoutPdf(tx: Tx, dealId: string, kind: DocumentKind, prefix: string): Promise<CreatedDocument> {
  const deal = await tx.deal.findUniqueOrThrow({
    where: { id: dealId },
    select: { number: true, priceTiyn: true, buyerTotalTiyn: true, payoutTiyn: true, readyAt: true, readyLat: true, readyLng: true },
  });
  const version = (await tx.document.count({ where: { dealId, kind } })) + 1;
  const sha256 = sha256Hex(JSON.stringify({ kind, dealId, version, ...deal, priceTiyn: String(deal.priceTiyn), buyerTotalTiyn: String(deal.buyerTotalTiyn), payoutTiyn: String(deal.payoutTiyn) }));
  const file = await tx.storedFile.create({
    data: { storageKey: `pending/${dealId}/${kind}-v${version}`, provider: "pending", purpose: "DOCUMENT", contentType: "application/pdf", size: 0, sha256 },
  });
  const doc = await tx.document.create({
    data: { dealId, kind, version, number: `${prefix}-${String(deal.number).padStart(4, "0")}${version > 1 ? `/${version}` : ""}`, fileId: file.id, sha256 },
  });
  return { documentId: doc.id, sha256 };
}

const unregisteredDocuments: DocumentsPort = {
  createContract: (tx, dealId) => documentWithoutPdf(tx, dealId, "CONTRACT", "Д"),
  createAcceptanceAct: (tx, dealId) => documentWithoutPdf(tx, dealId, "ACCEPTANCE_ACT", "А"),
};

const unregisteredRequests = (event: keyof RequestsPort) => async (_tx: Tx, dealId: string) => {
  logger.warn("deal-core.requests-port.unregistered", { event, dealId });
};

// В globalThis, как клиент Prisma: перезагрузка модуля в dev (HMR) не сбрасывает регистрацию из instrumentation.
const registry = globalThis as unknown as { senimDocumentsPort?: DocumentsPort; senimRequestsPort?: RequestsPort };

export function registerDocumentsPort(port: DocumentsPort): void {
  registry.senimDocumentsPort = port;
}

export function registerRequestsPort(port: RequestsPort): void {
  registry.senimRequestsPort = port;
}

export const documents = (): DocumentsPort => registry.senimDocumentsPort ?? unregisteredDocuments;

export const requests = (): RequestsPort =>
  registry.senimRequestsPort ?? { onContractSigned: unregisteredRequests("onContractSigned"), onDealCancelled: unregisteredRequests("onDealCancelled") };
