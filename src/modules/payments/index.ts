import "server-only";

// Публичный API payments (ADR-009): журнал денег — единственный источник правды; провайдеры за интерфейсом
// PaymentProvider (mock, manual; freedompay — точка подключения в ./providers). Деньги клиентов не проходят
// через счета платформы: HOLD резервирует их в банке. Итог операции двигает сделку через хук владельца
// (SettledHook — deal-core.onMoneySettled), поэтому payments не импортирует deal-core.

export { computeDealMoney, computeSplit, kztToTiyn, GUARANTEE_PERCENT, MAX_PRICE_TIYN, PROTECTION_PERCENT, type DealMoney, type Split } from "./money";
export { partyEstimate, type PartyEstimate } from "./estimate";
export type * from "./provider";
export { moneyKey, RETRIABLE_TYPES, type RetriableType } from "./keys";

// Журнал: запись, итог, проекции
export { recordOperation, settle, trySettle, moneyFactsOf, moneyHistory, moneyView, ledgerEntries, LEDGER_INCLUDE, toLedgerEntry, type BankConfirmation, type Outcome, type RecordInput } from "./ledger";
export { moneyFacts, moneyHistoryOf, projectMoney, retryCheck, type RetryCheck, type LedgerEntry, type MoneyBlock, type MoneyFacts, type MoneyHistoryItem, type MoneyView } from "./projection";

// Провайдеры и исполнение
export { isTestProvider, newDealProviderKind, providerFor, providerKindOf } from "./providers";
export { mockProvider, signMockWebhook } from "./providers/mock";
export {
  confirmManualOperation,
  confirmManualSchema,
  failManualOperation,
  failManualSchema,
  listPendingManualOperations,
  type PendingManualOperation,
} from "./providers/manual";
export { enqueueExecution, executeDealOperations, JOB_EXECUTE_DEAL, type SettledHook } from "./execute";
export { assertPayoutIbanChangeable, hasPendingPayout } from "./payout-lock";
export { listRetriableOperations, retryFailedOperation, retryOperationSchema, type FailedOperation } from "./retry";
export { receiveWebhook, type WebhookOutcome } from "./webhook";
export { JOB_POLL_PENDING, pollPendingOperations } from "./poll";
export { paymentJobHandlers } from "./jobs";

// Отчёт оператора
export { platformIncomeReport, type IncomeReport, type IncomeRow } from "./report";
