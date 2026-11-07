import type { CurrentUser } from "@/modules/identity";
import type { Tx } from "@/platform/db";

/**
 * Межмодульные контракты documents (ADR-009). Порт для deal-core — DocumentsPort из @/modules/deal-core
 * (createContract, createAcceptanceAct); его реализация — documentsPort из index.ts.
 */

export type CreatedDocument = { documentId: string; sha256: string };

/** deal-core → documents: оферта по сделке; при изменении данных — новая версия. */
export type CreateContract = (tx: Tx, dealId: string) => Promise<CreatedDocument>;

/** deal-core → documents: акт приёмки с фото и GPS сдачи — при переходе в READY. */
export type CreateAcceptanceAct = (tx: Tx, dealId: string) => Promise<CreatedDocument>;

/**
 * Экран → documents: подпись ЭЦП. Сервер проверяет CMS (verify), хэш и ИИН подписанта; когда есть все
 * требуемые подписи — документ SIGNED и deal-core.onDocumentSigned в той же транзакции.
 */
export type CompleteSigning = (user: CurrentUser, input: { documentId: string; sessionId: string }) => Promise<{ fullySigned: boolean }>;
