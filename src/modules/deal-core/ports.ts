import type { DocumentKind } from "@/generated/prisma/enums";
import { sha256Hex } from "@/platform/crypto";
import type { Tx } from "@/platform/db";

/**
 * Зависимости deal-core от других модулей — в одном месте.
 *
 * companies — прямой импорт (companies не импортирует deal-core).
 * documents — порт: deal-core не импортирует documents (documents сам читает данные сделки через
 * deal-core.dealDocumentData и вызывает deal-core.onContractSigned / onActSigned). Реализацию порта
 * регистрирует точка сборки (src/instrumentation.ts для сервера Next, src/jobs.ts для задач):
 *   registerDocumentsPort({ createContract, createAcceptanceAct })  // из @/modules/documents
 * Пока documents не умеет новые виды документов, работает временный адаптер ниже.
 */
export { applyPortfolioConsent, executorDisplayOf, executorDisplays, maskContacts, recalculateRating, sanitizeExecutorText } from "@/modules/companies";
// INTEGRATOR: заменить на files.attachFiles, когда files узнает владельцев dealId (DELIVERY) и progressReportId (PROGRESS_REPORT).
export { attachOwnFiles } from "./attach";

export type CreatedDocument = { documentId: string; sha256: string };

export type DocumentsPort = {
  /** Оферта (DocumentKind.CONTRACT) по сделке — при createDeal, в той же транзакции. */
  createContract: (tx: Tx, dealId: string) => Promise<CreatedDocument>;
  /** Акт приёмки (ACCEPTANCE_ACT) с фото и GPS сдачи — при переходе в READY, в той же транзакции. */
  createAcceptanceAct: (tx: Tx, dealId: string) => Promise<CreatedDocument>;
};

/**
 * INTEGRATOR: временный адаптер до реализации documents (DocumentKind.CONTRACT и ACCEPTANCE_ACT).
 * Создаёт запись документа без PDF: файл-заготовка (provider «pending») и хэш условий сделки.
 * documents-engineer заменяет его настоящим PDF через registerDocumentsPort.
 */
async function placeholder(tx: Tx, dealId: string, kind: DocumentKind, prefix: string): Promise<CreatedDocument> {
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

const placeholderPort: DocumentsPort = {
  createContract: (tx, dealId) => placeholder(tx, dealId, "CONTRACT", "Д"),
  createAcceptanceAct: (tx, dealId) => placeholder(tx, dealId, "ACCEPTANCE_ACT", "А"),
};

// В globalThis, как клиент Prisma: перезагрузка модуля в dev (HMR) не сбрасывает регистрацию из instrumentation.
const registry = globalThis as unknown as { senimDocumentsPort?: DocumentsPort };

export function registerDocumentsPort(port: DocumentsPort): void {
  registry.senimDocumentsPort = port;
}

export const documents = (): DocumentsPort => registry.senimDocumentsPort ?? placeholderPort;
