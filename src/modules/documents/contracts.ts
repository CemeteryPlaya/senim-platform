import type { CurrentUser } from "@/modules/identity";
import type { Tx } from "@/platform/db";

/**
 * Межмодульные контракты documents (фаза A): сигнатуры, которые documents-engineer
 * экспортирует из index.ts. Меняются только через интегратора.
 */

export type CreatedDocument = { documentId: string; sha256: string };

/** deal-core → documents: PDF договора по сделке; при изменении условий — новая версия. */
export type CreateContract = (tx: Tx, dealId: string) => Promise<CreatedDocument>;

/** deal-core → documents: PDF акта этапа после приёмки. */
export type CreateStageAct = (tx: Tx, stageId: string) => Promise<CreatedDocument>;

/**
 * Завершает подпись стороны: сервер проверяет CMS (verify) и хэш документа.
 * Когда подписали обе стороны, в той же транзакции вызывается onFullySigned
 * (экран передаёт deal-core.onDocumentSigned).
 */
export type CompleteSigning = (
  user: CurrentUser,
  input: { documentId: string; sessionId: string },
  hooks: { onFullySigned: (tx: Tx, documentId: string) => Promise<void> },
) => Promise<{ fullySigned: boolean }>;
