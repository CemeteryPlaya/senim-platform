import "server-only";

// Публичный API payments: PaymentRail (manual | escrow-simulator | bank), операции по счёту сделки
// с идемпотентными ключами, вебхуки, сверка и банк-симулятор. Деньги клиентов не проходят через счёт платформы.

export type * from "./rail";
export { railFor } from "./rails";
export { PLATFORM_FEE_PERCENT } from "./fees";
export { paymentModeOf, railModeOf, RAIL_MODES } from "./modes";
export { activeRailMode, setActiveRailMode, RAIL_SETTING_KEY } from "./settings";
export {
  ensureEscrowAccount,
  escrowAvailable,
  executeOperation,
  isFullyFunded,
  pendingOperationKeys,
  receiveWebhook,
  requestOperation,
  stagesWithTranche,
  type OperationRequest,
  type SettledHook,
  type SettledOperation,
  type WebhookOutcome,
} from "./operations";
export { JOB_RESEND_PENDING, paymentJobHandlers, RESEND_AFTER_MINUTES, resendPendingOperations } from "./resend";
export { reconcile, type Reconcile } from "./reconcile";
export type { ReconciliationRow } from "./reconcile-entries";
export {
  getSimulatorAccount,
  simulatorAccountSchema,
  simulatorDeposit,
  simulatorDepositSchema,
  simulatorRedeliver,
} from "./simulator";
export type { SignedDelivery } from "./rails/escrow-simulator";
export { SIGNATURE_HEADER, TIMESTAMP_HEADER } from "./webhook-signature";

// Задачи payments собирает src/jobs.ts через paymentJobHandlers(deal-core.onPaymentSettled).
