import type { DisputeDecision } from "@/generated/prisma/enums";
import type { CurrentUser } from "@/modules/identity";
import type { Tx } from "@/platform/db";
import type { StageTemplate } from "./stage-plan";

/**
 * Межмодульные контракты deal-core (фаза A): сигнатуры функций, которые
 * deal-core-engineer экспортирует из index.ts. Меняются только через интегратора.
 */

/** requests → deal-core: заказчик согласился с итоговой ценой после замера. */
export type CreateDealInput = {
  requestId: string;
  offerId: string;
  clientId: string;
  executorId: string; // ExecutorProfile.id
  title: string;
  totalAmount: number; // ₸, итоговая цена после замера
  template: StageTemplate; // из verticals/furniture
};

/**
 * Создаёт сделку в транзакции перехода заявки в CONTRACTING.
 * Режим оплаты deal-core берёт сам из payments.activeRailMode().
 */
export type CreateDeal = (tx: Tx, input: CreateDealInput) => Promise<{ dealId: string }>;

/**
 * documents вызывает, когда документ подписали обе стороны (в той же транзакции).
 * Экран передаёт эту функцию в documents.completeSigning как onFullySigned — без циклического импорта.
 */
export type OnDocumentSigned = (tx: Tx, documentId: string) => Promise<void>;

/** operator → deal-core: решение по спору. */
export type ResolveDisputeInput = {
  disputeId: string;
  decision: DisputeDecision;
  decisionAmount?: number; // ₸ в пользу исполнителя при PARTIAL
  rationale: string;
};

export type ResolveDispute = (operator: CurrentUser, input: ResolveDisputeInput) => Promise<void>;
