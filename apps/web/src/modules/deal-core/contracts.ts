import type { DisputeOutcome } from "@/generated/prisma/enums";
import type { Actor } from "@/modules/audit";
import type { CurrentUser } from "@/modules/identity";
import type { Tx } from "@/platform/db";

/**
 * Межмодульные контракты deal-core (ADR-009): сигнатуры функций, которые другие модули вызывают у deal-core.
 * Меняются только через интегратора.
 */

/** requests → deal-core: акцепт цены в торге фиксирует X и порождает оферту (сделку в CREATED). */
export type CreateDealInput = {
  requestId: string;
  offerId: string;
  /** Цена X по итогу торга, тиыны (bigint или строка цифр). */
  priceTiyn: bigint | string;
  title: string;
  /** Кто принял цену (аудит «deal.created»); по умолчанию — система. */
  actor?: Actor;
};

/**
 * Создаёт сделку в транзакции акцепта цены: снимок денег computeDealMoney(X), провайдер из env
 * (resolvePaymentProvider), признак демо — от покупателя; оферта — через порт documents.createContract.
 */
export type CreateDeal = (tx: Tx, input: CreateDealInput) => Promise<{ dealId: string }>;

/**
 * documents → deal-core: документ подписан полностью (в той же транзакции). Экран передаёт эту функцию
 * в documents.completeSigning как onFullySigned — без циклического импорта. Разбирает вид документа:
 * оферта → onContractSigned, акт приёмки → onActSigned. Повтор по уже обработанному документу ничего не меняет.
 */
export type OnDocumentSigned = (tx: Tx, documentId: string) => Promise<void>;

/** operator → deal-core: решение по спору (ADR-009 раздел 3). */
export type ResolveDisputeInput = {
  disputeId: string;
  outcome: DisputeOutcome;
  /** Доля мастера Y из цены X, тиыны — только при PARTIAL_SPLIT. */
  masterShareTiyn?: bigint | string;
  rationale: string;
};

export type ResolveDispute = (operator: CurrentUser, input: ResolveDisputeInput) => Promise<void>;
