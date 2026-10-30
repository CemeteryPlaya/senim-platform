import "server-only";

// Публичный API ядра сделки. Ядро не знает про мебель: шаблоны этапов приходят из вертикали.
// Статусные машины — ./transitions.ts (ADR-002). Контракты для других модулей — ./contracts.ts.
export { planStages, type PlannedStage, type StageTemplate } from "./stage-plan";
export type {
  CancelDealHooks,
  CreateDeal,
  CreateDealInput,
  OnDealCancelled,
  OnDocumentSigned,
  ResolveDispute,
  ResolveDisputeInput,
} from "./contracts";
export { DEAL_TRANSITIONS, PAYMENT_TRANSITIONS, STAGE_TRANSITIONS } from "./transitions";

// Контракты (фаза A)
export { createDeal, onDocumentSigned } from "./service";
export { resolveDispute } from "./dispute";

// Действия сторон
export {
  acceptStage,
  afterSigning,
  cancelDeal,
  confirmStagePayment,
  handleRailWebhook,
  leaveReview,
  markStagePaid,
  requestRework,
  startStage,
  submitStage,
} from "./service";
export { openDispute, submitDisputePosition } from "./dispute";

// Чтения для экранов
export { getDealView, listDeals, type DealListItem, type DealView } from "./queries";
export type { NextAction, NextStep } from "./next-step";

// Схемы входа для Server Actions экранов
export {
  cancelDealSchema,
  dealRefSchema,
  disputePositionSchema,
  openDisputeSchema,
  resolveDisputeSchema,
  reviewSchema,
  reworkSchema,
  stageRefSchema,
  submitStageSchema,
} from "./schemas";

export { jobHandlers } from "./jobs";
