import "server-only";

// Публичный API ядра сделки (ТЗ п. 9, ADR-009). Ядро не знает про мебель. Статусная машина — ./transitions.ts,
// деньги — журнал payments (статус двигают подтверждённые операции через onMoneySettled).
// Контракты для других модулей — ./contracts.ts; порт документов — ./ports.ts (registerDocumentsPort).

export type { CreateDeal, CreateDealInput, OnDocumentSigned, ResolveDispute, ResolveDisputeInput } from "./contracts";
export { DEAL_STATUSES, DEAL_TRANSITIONS, DISPUTABLE, checkTransition, type DealContext, type DealTransition, type Refusal, type Who } from "./transitions";

// Контракты: requests → createDeal; documents → onDocumentSigned (или onContractSigned / onActSigned); operator → resolveDispute
export { createDeal, onActSigned, onContractSigned, onDocumentSigned } from "./service";
export { resolveDispute } from "./dispute";
export { registerDocumentsPort, registerRequestsPort, type CreatedDocument, type DocumentsPort, type RequestsPort } from "./ports";
// Какие подписи нужны оферте и акту — одна таблица для documents (полностью подписан) и deal-core («Что дальше»)
export { isFullySigned, isSignable, missingOf, partiesDone, requiredSignatures, type Requirement, type SignedParties, type SigningFlags } from "./signatures";
export { signingFlags } from "./signing-flags";

// Действия сторон
export { addProgressReport, cancelDeal, leaveReview, payForDeal, startWork, submitReady, type CancelResult, type PayResult, type ReadyResult } from "./service";
export { openDispute, submitDisputePosition } from "./dispute";
// Согласие сторон на передачу данных банку-партнёру (P3): отметка до подписи оферты и оплаты
export { BANK_CONSENT_MISSING, bankConsentSchema, bankConsentState, giveBankConsent, type BankConsentState } from "./bank-consent";

// Деньги: хук итога операции (payments → deal-core), «изменились деньги», исполнение ждущих операций сейчас
export { onMoneyChanged, onMoneySettled, processDealMoney } from "./money";

// Чтения для экранов и документов
export { dealDocumentData, dealNumbersOf, dealPartyOf, getDealView, listDeals, type DealDocumentData, type DealListItem, type DealView } from "./queries";
export { nextStep, type NextAction, type NextStep } from "./next-step";
export { daysLeft, plannedReadyAt } from "./schedule";
export { financeOf, getExecutorFinance, monthOf, type ExecutorFinance, type FinanceRow, type MonthEarnings, type MonthKey } from "./finance";

// Схемы входа для Server Actions экранов
export {
  cancelDealSchema,
  createDealSchema,
  dealRefSchema,
  disputePositionSchema,
  openDisputeSchema,
  progressReportSchema,
  resolveDisputeSchema,
  reviewSchema,
  submitReadySchema,
} from "./schemas";

// Публичная витрина (Фаза 2): фундамент — согласия сторон и обезличенная проекция под флагом publicShowcase
export { getPublicDealView, grantPublicConsent, revokePublicConsent, type PublicDealView } from "./public-view";

