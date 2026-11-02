// Клиентская точка входа deal-core: только чистые функции без server-only.
// Её можно импортировать из клиентских компонентов и скриптов вне Next (сид).
export { daysLeft, plannedReadyAt, type ScheduleInput } from "./schedule";
export { nextStep, type NextAction, type NextStep, type NextStepInput } from "./next-step";
export { DEAL_STATUSES, DEAL_TRANSITIONS, DISPUTABLE, checkTransition, type DealContext, type DealTransition, type Refusal, type Who } from "./transitions";
export { isFullySigned, isSignable, missingOf, partiesDone, requiredSignatures, type Requirement, type SignedParties, type SigningFlags } from "./signatures";
